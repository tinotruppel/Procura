/**
 * Google OAuth Authorization Server (RFC8414 / MCP-compliant)
 *
 * Acts as a standard OAuth 2.1 Authorization Server that proxies to Google OAuth.
 * Any MCP client (Claude Desktop, Cursor, Procura, etc.) can authenticate via
 * the standard OAuth flow — our backend handles the Google integration transparently.
 *
 * Endpoints:
 *   GET  /.well-known/oauth-authorization-server  — RFC8414 metadata
 *   POST /register                                — RFC7591 dynamic client registration
 *   GET  /authorize                               — Authorization endpoint (redirects to Google)
 *   GET  /auth/google/callback                    — Google callback (internal redirect)
 *   POST /token                                   — Token endpoint (returns session token)
 *   GET  /auth/google/status                      — Check connection status
 *   DELETE /auth/google/disconnect                — Remove stored tokens
 */

import { Hono } from "hono";
import { randomBytes, createHash, randomUUID } from "crypto";
import {
    isGoogleConfiguredAsync,
    getGoogleClientIdAsync,
    getGoogleClientSecretAsync,
    storeRefreshToken,
    hasConnected,
    deleteTokensByUser,
} from "../lib/google-auth";
import { createLogger } from "../lib/logger";

const log = createLogger("google-oauth");

// =============================================================================
// In-memory stores (transient, short-lived)
// =============================================================================

interface RegisteredClient {
    clientId: string;
    clientSecret?: string;
    redirectUris: string[];
    clientName?: string;
    createdAt: number;
}

interface PendingAuth {
    clientId: string;
    clientState: string;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    scope: string;
    vaultApiKey: string | undefined;
    createdAt: number;
}

interface AuthCode {
    sessionToken: string;
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    createdAt: number;
}

const registeredClients = new Map<string, RegisteredClient>();
const pendingAuths = new Map<string, PendingAuth>(); // keyed by our internal state
const authCodes = new Map<string, AuthCode>(); // keyed by auth code

const CODE_TTL_MS = 5 * 60 * 1000; // 5 min
const PENDING_TTL_MS = 10 * 60 * 1000; // 10 min

const GOOGLE_SCOPES = [
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/presentations",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/drive.metadata.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar.events",
].join(" ");

/** Periodic cleanup of expired entries */
function cleanupExpiredEntries(): void {
    const now = Date.now();
    for (const [key, entry] of pendingAuths) {
        if (now - entry.createdAt > PENDING_TTL_MS) pendingAuths.delete(key);
    }
    for (const [key, entry] of authCodes) {
        if (now - entry.createdAt > CODE_TTL_MS) authCodes.delete(key);
    }
}
setInterval(cleanupExpiredEntries, 60_000);

// =============================================================================
// Helpers
// =============================================================================

function getBaseUrl(c: { req: { url: string; header: (name: string) => string | undefined } }): string {
    const url = new URL(c.req.url);
    // Behind a reverse proxy (nginx), use X-Forwarded-Proto to get the real protocol
    const proto = c.req.header("X-Forwarded-Proto") || url.protocol.replace(":", "");
    const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    const scheme = isLocalhost ? proto : "https";
    return `${scheme}://${url.host}`;
}

function generateSecureCode(): string {
    return randomBytes(32).toString("base64url");
}

function verifyPkce(codeVerifier: string, codeChallenge: string, method: string): boolean {
    if (method === "S256") {
        const hash = createHash("sha256").update(codeVerifier).digest("base64url");
        return hash === codeChallenge;
    }
    // plain method (not recommended but required by spec)
    return codeVerifier === codeChallenge;
}

// =============================================================================
// Routes
// =============================================================================

export const googleOAuthRoutes = new Hono();

/**
 * GET /.well-known/oauth-authorization-server
 * RFC8414 Authorization Server Metadata
 */
googleOAuthRoutes.get("/.well-known/oauth-authorization-server", (c) => {
    const base = getBaseUrl(c);
    return c.json({
        issuer: `${base}/google`,
        authorization_endpoint: `${base}/google/oauth/authorize`,
        token_endpoint: `${base}/google/oauth/token`,
        registration_endpoint: `${base}/google/oauth/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        code_challenge_methods_supported: ["S256"],
        scopes_supported: ["google"],
    });
});

/**
 * POST /register
 * RFC7591 Dynamic Client Registration
 */
googleOAuthRoutes.post("/oauth/register", async (c) => {
    const body = await c.req.json() as {
        redirect_uris?: string[];
        client_name?: string;
        [key: string]: unknown;
    };

    if (!body.redirect_uris?.length) {
        return c.json({ error: "redirect_uris is required" }, 400);
    }

    const clientId = randomUUID();
    const client: RegisteredClient = {
        clientId,
        redirectUris: body.redirect_uris,
        clientName: body.client_name as string | undefined,
        createdAt: Date.now(),
    };

    registeredClients.set(clientId, client);

    return c.json({
        client_id: clientId,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        redirect_uris: client.redirectUris,
        client_name: client.clientName,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code"],
        response_types: ["code"],
    }, 201);
});

/**
 * GET /authorize
 * Authorization endpoint — validates PKCE, stores pending auth, redirects to Google
 */
googleOAuthRoutes.get("/oauth/authorize", async (c) => {
    const apiKey = c.req.query("api_key") || c.req.header("X-API-Key") || undefined;
    log.info(`authorize: api_key present=${!!apiKey}`);
    const configured = await isGoogleConfiguredAsync(apiKey);
    log.info(`authorize: configured=${configured}`);
    if (!configured) return c.json({ error: "Google OAuth not configured. Store GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in vault or set as environment variables." }, 503);

    const clientId = c.req.query("client_id");
    const redirectUri = c.req.query("redirect_uri");
    const responseType = c.req.query("response_type");
    const codeChallenge = c.req.query("code_challenge");
    const codeChallengeMethod = c.req.query("code_challenge_method") || "S256";
    const state = c.req.query("state") || "";
    const scope = c.req.query("scope") || "google";

    // Validate required params
    if (!clientId || !redirectUri || !codeChallenge) {
        return c.json({ error: "invalid_request", error_description: "Missing client_id, redirect_uri, or code_challenge" }, 400);
    }
    if (responseType !== "code") {
        return c.json({ error: "unsupported_response_type" }, 400);
    }

    // Validate client registration (if registered)
    const client = registeredClients.get(clientId);
    if (client && !client.redirectUris.includes(redirectUri)) {
        return c.json({ error: "invalid_request", error_description: "redirect_uri not registered" }, 400);
    }

    // Validate redirect URI (must be localhost or HTTPS per MCP spec)
    try {
        const uri = new URL(redirectUri);
        const isLocalhost = uri.hostname === "localhost" || uri.hostname === "127.0.0.1";
        const isHttps = uri.protocol === "https:";
        const isChromeExtension = uri.protocol === "chrome-extension:";
        if (!isLocalhost && !isHttps && !isChromeExtension) {
            return c.json({ error: "invalid_request", error_description: "redirect_uri must be localhost or HTTPS" }, 400);
        }
    } catch {
        return c.json({ error: "invalid_request", error_description: "Invalid redirect_uri" }, 400);
    }

    // Generate our internal state to map Google callback back to this pending auth
    const internalState = generateSecureCode();
    pendingAuths.set(internalState, {
        clientId,
        clientState: state,
        redirectUri,
        codeChallenge,
        codeChallengeMethod,
        scope,
        vaultApiKey: apiKey,
        createdAt: Date.now(),
    });

    // Redirect to Google OAuth
    const base = getBaseUrl(c);
    const googleClientId = await getGoogleClientIdAsync(apiKey);
    log.info(`authorize: resolved googleClientId=${googleClientId ? googleClientId.substring(0, 10) + '...' : 'MISSING'}`);
    const googleParams = new URLSearchParams({
        client_id: googleClientId!,
        redirect_uri: `${base}/google/auth/google/callback`,
        response_type: "code",
        scope: GOOGLE_SCOPES,
        access_type: "offline",
        prompt: "consent",
        state: internalState,
    });

    return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${googleParams}`);
});

/**
 * GET /auth/google/callback
 * Google redirects here. Exchanges code → stores tokens → redirects to client redirect_uri with auth code.
 */
googleOAuthRoutes.get("/auth/google/callback", async (c) => {
    const googleCode = c.req.query("code");
    const internalState = c.req.query("state");
    const error = c.req.query("error");

    if (error) return c.text(`Authorization denied: ${error}`, 400);
    if (!googleCode || !internalState) return c.text("Missing authorization code or state", 400);

    const pending = pendingAuths.get(internalState);
    if (!pending) return c.text("Invalid or expired authorization request", 400);
    pendingAuths.delete(internalState);

    // Check TTL
    if (Date.now() - pending.createdAt > PENDING_TTL_MS) {
        return c.text("Authorization request expired", 400);
    }

    const base = getBaseUrl(c);

    try {
        // Resolve Google credentials from vault
        const googleClientId = await getGoogleClientIdAsync(pending.vaultApiKey);
        const googleClientSecret = await getGoogleClientSecretAsync(pending.vaultApiKey);
        log.info(`callback: resolved googleClientId=${googleClientId ? googleClientId.substring(0, 10) + '...' : 'MISSING'}, googleClientSecret present=${!!googleClientSecret}`);

        // Exchange Google code for tokens
        const response = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: googleClientId!,
                client_secret: googleClientSecret!,
                code: googleCode,
                grant_type: "authorization_code",
                redirect_uri: `${base}/google/auth/google/callback`,
            }).toString(),
        });


        if (!response.ok) {
            console.error("Google token exchange failed:", await response.text());
            return redirectWithError(c, pending.redirectUri, pending.clientState, "server_error", "Failed to exchange authorization code with Google");
        }

        const data = (await response.json()) as {
            access_token: string;
            refresh_token?: string;
            expires_in: number;
        };

        if (!data.refresh_token) {
            return redirectWithError(c, pending.redirectUri, pending.clientState, "server_error", "No refresh token from Google. Revoke access at myaccount.google.com and retry.");
        }

        // Get user identity from Google to use as userId
        const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
            headers: { Authorization: `Bearer ${data.access_token}` },
        });
        const userInfo = userInfoRes.ok
            ? (await userInfoRes.json()) as { email?: string; id?: string }
            : { id: randomUUID() };
        const userId = userInfo.email || userInfo.id || randomUUID();

        // Store refresh token (encrypted) and get session token
        const sessionToken = await storeRefreshToken(userId, data.refresh_token, pending.vaultApiKey!);

        // Generate a short-lived auth code that maps to the session token
        const authCode = generateSecureCode();
        authCodes.set(authCode, {
            sessionToken,
            clientId: pending.clientId,
            redirectUri: pending.redirectUri,
            codeChallenge: pending.codeChallenge,
            codeChallengeMethod: pending.codeChallengeMethod,
            createdAt: Date.now(),
        });

        // Send code+state back to opener via postMessage (works for extension + PWA)
        const html = `<!DOCTYPE html><html><head><title>Authenticating...</title></head>
<body><p style="font-family:system-ui;text-align:center;margin-top:40vh;color:#666">Authentication complete. This window will close automatically.</p>
<script>
window.opener.postMessage({type:"oauth-callback",code:${JSON.stringify(authCode)},state:${JSON.stringify(pending.clientState)}},"*");
setTimeout(()=>window.close(),1000);
</script></body></html>`;
        return c.html(html);

    } catch (err) {
        console.error("OAuth callback error:", err);
        return redirectWithError(c, pending.redirectUri, pending.clientState, "server_error", "Internal error during authorization");
    }
});

/**
 * POST /token
 * Token endpoint — validates PKCE code_verifier, returns session token as access_token.
 */
googleOAuthRoutes.post("/oauth/token", async (c) => {
    const contentType = c.req.header("Content-Type") || "";

    let params: URLSearchParams;
    if (contentType.includes("application/x-www-form-urlencoded")) {
        params = new URLSearchParams(await c.req.text());
    } else {
        const body = await c.req.json() as Record<string, string>;
        params = new URLSearchParams(body);
    }

    const grantType = params.get("grant_type");
    const code = params.get("code");
    const codeVerifier = params.get("code_verifier");
    const redirectUri = params.get("redirect_uri");

    if (grantType !== "authorization_code") {
        return c.json({ error: "unsupported_grant_type" }, 400);
    }
    if (!code || !codeVerifier) {
        return c.json({ error: "invalid_request", error_description: "Missing code or code_verifier" }, 400);
    }

    const authCode = authCodes.get(code);
    if (!authCode) {
        return c.json({ error: "invalid_grant", error_description: "Invalid or expired authorization code" }, 400);
    }

    // Single-use: delete immediately
    authCodes.delete(code);

    // Validate TTL
    if (Date.now() - authCode.createdAt > CODE_TTL_MS) {
        return c.json({ error: "invalid_grant", error_description: "Authorization code expired" }, 400);
    }

    // Validate redirect_uri matches
    if (redirectUri && redirectUri !== authCode.redirectUri) {
        return c.json({ error: "invalid_grant", error_description: "redirect_uri mismatch" }, 400);
    }

    // Validate PKCE
    if (!verifyPkce(codeVerifier, authCode.codeChallenge, authCode.codeChallengeMethod)) {
        return c.json({ error: "invalid_grant", error_description: "PKCE verification failed" }, 400);
    }

    return c.json({
        access_token: authCode.sessionToken,
        token_type: "Bearer",
        // No expiry — session token is valid until user disconnects
    });
});

/**
 * GET /auth/google/status?userId=xxx
 */
googleOAuthRoutes.get("/auth/google/status", async (c) => {
    const userId = c.req.query("userId");
    if (!userId) return c.json({ error: "userId query parameter is required" }, 400);
    const apiKey = c.req.header("X-API-Key") || undefined;
    const connected = await hasConnected(userId);
    return c.json({ configured: await isGoogleConfiguredAsync(apiKey), connected });
});

/**
 * DELETE /auth/google/disconnect?userId=xxx
 */
googleOAuthRoutes.delete("/auth/google/disconnect", async (c) => {
    const userId = c.req.query("userId");
    if (!userId) return c.json({ error: "userId query parameter is required" }, 400);
    await deleteTokensByUser(userId);
    return c.json({ disconnected: true });
});

// =============================================================================
// Helpers
// =============================================================================

function redirectWithError(
    c: { redirect: (url: string) => Response },
    redirectUri: string,
    state: string,
    error: string,
    description: string
): Response {
    const url = new URL(redirectUri);
    url.searchParams.set("error", error);
    url.searchParams.set("error_description", description);
    if (state) url.searchParams.set("state", state);
    return c.redirect(url.toString());
}
