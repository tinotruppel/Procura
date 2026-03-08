/**
 * Trello OAuth Authorization Server (RFC8414 / MCP-compliant)
 *
 * Acts as a standard OAuth 2.1 Authorization Server that proxies to Trello's
 * token-based authorization. Any MCP client can authenticate via the standard
 * OAuth flow — our backend handles the Trello integration transparently.
 *
 * Note: Trello uses an implicit token flow (token returned in URL fragment),
 * not a standard OAuth 2.0 authorization code flow. Our callback page uses
 * client-side JavaScript to extract the token and POST it back to the server.
 *
 * Endpoints:
 *   GET  /.well-known/oauth-authorization-server  — RFC8414 metadata
 *   POST /register                                — RFC7591 dynamic client registration
 *   GET  /authorize                               — Authorization endpoint (redirects to Trello)
 *   GET  /auth/trello/callback                    — Trello callback (extracts token from fragment)
 *   POST /auth/trello/token-store                 — Receives token from callback page
 *   POST /token                                   — Token endpoint (returns session token)
 *   GET  /auth/trello/status                      — Check connection status
 *   DELETE /auth/trello/disconnect                — Remove stored tokens
 */

import { Hono } from "hono";
import { randomBytes, createHash, randomUUID } from "crypto";
import {
    isTrelloConfiguredAsync,
    getTrelloAppKeyAsync,
    storeUserToken,
    hasConnected,
    deleteTokensByUser,
} from "../lib/trello-auth";
import { createLogger } from "../lib/logger";

const log = createLogger("trello-oauth");

// =============================================================================
// In-memory stores (transient, short-lived)
// =============================================================================

interface RegisteredClient {
    clientId: string;
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
    return codeVerifier === codeChallenge;
}

// =============================================================================
// Routes
// =============================================================================

export const trelloOAuthRoutes = new Hono();

/**
 * GET /.well-known/oauth-authorization-server
 * RFC8414 Authorization Server Metadata
 */
trelloOAuthRoutes.get("/.well-known/oauth-authorization-server", (c) => {
    const base = getBaseUrl(c);
    return c.json({
        issuer: base,
        authorization_endpoint: `${base}/trello/oauth/authorize`,
        token_endpoint: `${base}/trello/oauth/token`,
        registration_endpoint: `${base}/trello/oauth/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        code_challenge_methods_supported: ["S256"],
        scopes_supported: ["trello"],
    });
});

/**
 * POST /oauth/register
 * RFC7591 Dynamic Client Registration
 */
trelloOAuthRoutes.post("/oauth/register", async (c) => {
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
 * GET /oauth/authorize
 * Authorization endpoint — validates PKCE, stores pending auth, redirects to Trello
 */
trelloOAuthRoutes.get("/oauth/authorize", async (c) => {
    const apiKey = c.req.query("api_key") || c.req.header("X-API-Key") || undefined;
    log.info(`authorize: api_key present=${!!apiKey}, api_key length=${apiKey?.length || 0}`);
    const configured = await isTrelloConfiguredAsync(apiKey);
    log.info(`authorize: configured=${configured}`);
    if (!configured) return c.json({ error: "Trello not configured. Store TRELLO_APP_KEY in vault or set as environment variable." }, 503);

    const clientId = c.req.query("client_id");
    const redirectUri = c.req.query("redirect_uri");
    const responseType = c.req.query("response_type");
    const codeChallenge = c.req.query("code_challenge");
    const codeChallengeMethod = c.req.query("code_challenge_method") || "S256";
    const state = c.req.query("state") || "";
    const scope = c.req.query("scope") || "trello";

    if (!clientId || !redirectUri || !codeChallenge) {
        return c.json({ error: "invalid_request", error_description: "Missing client_id, redirect_uri, or code_challenge" }, 400);
    }
    if (responseType !== "code") {
        return c.json({ error: "unsupported_response_type" }, 400);
    }

    const client = registeredClients.get(clientId);
    if (client && !client.redirectUris.includes(redirectUri)) {
        return c.json({ error: "invalid_request", error_description: "redirect_uri not registered" }, 400);
    }

    // Validate redirect URI
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

    // Store pending auth
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

    // Redirect to Trello authorization
    const base = getBaseUrl(c);
    const trelloParams = new URLSearchParams({
        key: await getTrelloAppKeyAsync(apiKey),
        callback_method: "fragment",
        return_url: `${base}/trello/callback?state=${encodeURIComponent(internalState)}`,
        scope: "read,write",
        expiration: "never",
        name: "Procura",
        response_type: "fragment",
    });

    return c.redirect(`https://trello.com/1/authorize?${trelloParams}`);
});

/**
 * GET /auth/trello/callback
 * Trello redirects here with token in URL fragment (#token=...).
 * Since fragments are client-side only, we use JS to extract and POST it.
 */
trelloOAuthRoutes.get("/callback", (c) => {
    const internalState = c.req.query("state") || "";

    // Serve an HTML page that extracts the token from the fragment and POSTs it
    const base = getBaseUrl(c);
    const html = `<!DOCTYPE html><html><head><title>Authenticating...</title></head>
<body>
<p style="font-family:system-ui;text-align:center;margin-top:40vh;color:#666">Connecting to Trello...</p>
<script>
(function() {
    var hash = window.location.hash.substring(1);
    var token = null;
    hash.split("&").forEach(function(part) {
        var kv = part.split("=");
        if (kv[0] === "token") token = kv[1];
    });
    if (!token) {
        document.body.innerHTML = '<p style="font-family:system-ui;text-align:center;margin-top:40vh;color:#c00">Authorization failed: no token received.</p>';
        return;
    }
    fetch(${JSON.stringify(`${base}/trello/token-store`)}, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token, state: ${JSON.stringify(internalState)} })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.code) {
            window.opener.postMessage({ type: "oauth-callback", code: data.code, state: data.clientState }, "*");
            setTimeout(function() { window.close(); }, 1000);
        } else {
            document.body.innerHTML = '<p style="font-family:system-ui;text-align:center;margin-top:40vh;color:#c00">Error: ' + (data.error || 'Unknown error') + '</p>';
        }
    })
    .catch(function(err) {
        document.body.innerHTML = '<p style="font-family:system-ui;text-align:center;margin-top:40vh;color:#c00">Error: ' + err.message + '</p>';
    });
})();
</script>
</body></html>`;
    return c.html(html);
});

/**
 * POST /auth/trello/token-store
 * Receives token from callback page, stores it, returns auth code for PKCE exchange.
 */
trelloOAuthRoutes.post("/token-store", async (c) => {
    const body = await c.req.json() as { token?: string; state?: string };

    if (!body.token || !body.state) {
        return c.json({ error: "Missing token or state" }, 400);
    }

    const pending = pendingAuths.get(body.state);
    if (!pending) {
        return c.json({ error: "Invalid or expired authorization request" }, 400);
    }
    pendingAuths.delete(body.state);

    if (Date.now() - pending.createdAt > PENDING_TTL_MS) {
        return c.json({ error: "Authorization request expired" }, 400);
    }

    try {
        log.info(`token-store: resolving appKey (vaultApiKey present=${!!pending.vaultApiKey})`);
        const appKey = await getTrelloAppKeyAsync(pending.vaultApiKey);
        log.info(`token-store: appKey resolved (length=${appKey.length}), fetching member info...`);

        const memberRes = await fetch(`https://api.trello.com/1/members/me?key=${appKey}&token=${body.token}&fields=username,email`);
        log.info(`token-store: member API status=${memberRes.status}`);

        const memberInfo = memberRes.ok
            ? (await memberRes.json()) as { username?: string; email?: string; id?: string }
            : { id: randomUUID() };
        const userId = memberInfo.email || memberInfo.username || memberInfo.id || randomUUID();
        log.info(`token-store: userId=${userId}`);

        // Store the Trello token (encrypted) and get session token
        const sessionToken = await storeUserToken(userId, body.token, pending.vaultApiKey!);
        log.info(`token-store: sessionToken stored (length=${sessionToken.length})`);

        // Generate auth code for PKCE exchange
        const authCode = generateSecureCode();
        authCodes.set(authCode, {
            sessionToken,
            clientId: pending.clientId,
            redirectUri: pending.redirectUri,
            codeChallenge: pending.codeChallenge,
            codeChallengeMethod: pending.codeChallengeMethod,
            createdAt: Date.now(),
        });

        log.info(`token-store: success, returning authCode`);
        return c.json({ code: authCode, clientState: pending.clientState });
    } catch (err) {
        log.error(`token-store: FAILED`, err instanceof Error ? err.stack || err.message : String(err));
        return c.json({ error: "Failed to store token" }, 500);
    }
});

/**
 * POST /oauth/token
 * Token endpoint — validates PKCE code_verifier, returns session token as access_token.
 */
trelloOAuthRoutes.post("/oauth/token", async (c) => {
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

    authCodes.delete(code);

    if (Date.now() - authCode.createdAt > CODE_TTL_MS) {
        return c.json({ error: "invalid_grant", error_description: "Authorization code expired" }, 400);
    }

    if (redirectUri && redirectUri !== authCode.redirectUri) {
        return c.json({ error: "invalid_grant", error_description: "redirect_uri mismatch" }, 400);
    }

    if (!verifyPkce(codeVerifier, authCode.codeChallenge, authCode.codeChallengeMethod)) {
        return c.json({ error: "invalid_grant", error_description: "PKCE verification failed" }, 400);
    }

    return c.json({
        access_token: authCode.sessionToken,
        token_type: "Bearer",
    });
});

/**
 * GET /auth/trello/status?userId=xxx
 */
trelloOAuthRoutes.get("/status", async (c) => {
    const userId = c.req.query("userId");
    if (!userId) return c.json({ error: "userId query parameter is required" }, 400);
    const apiKey = c.req.header("X-API-Key") || undefined;
    const connected = await hasConnected(userId);
    return c.json({ configured: await isTrelloConfiguredAsync(apiKey), connected });
});

/**
 * DELETE /auth/trello/disconnect?userId=xxx
 */
trelloOAuthRoutes.delete("/disconnect", async (c) => {
    const userId = c.req.query("userId");
    if (!userId) return c.json({ error: "userId query parameter is required" }, 400);
    await deleteTokensByUser(userId);
    return c.json({ disconnected: true });
});
