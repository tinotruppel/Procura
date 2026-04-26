/**
 * MCP OAuth Authentication Module
 * Implements OAuth 2.1 with PKCE for MCP server authentication.
 * Based on RFC9728 (Protected Resource Metadata) and RFC8414 (Authorization Server Metadata).
 */

// ============================================================================
// Types
// ============================================================================

interface ProtectedResourceMetadata {
    resource: string;
    authorization_servers?: string[];
    scopes_supported?: string[];
}

interface AuthServerMetadata {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    registration_endpoint?: string;
    scopes_supported?: string[];
    response_types_supported?: string[];
    code_challenge_methods_supported?: string[];
}

interface OAuthTokens {
    access_token: string;
    token_type: string;
    expires_in?: number;
    refresh_token?: string;
    scope?: string;
}

/**
 * Dynamic Client Registration Response (RFC7591)
 */
interface ClientRegistration {
    client_id: string;
    client_secret?: string;
    client_id_issued_at?: number;
    client_secret_expires_at?: number;
}

// Cache registered clients by server URL
const registeredClients = new Map<string, ClientRegistration>();

/**
 * Register a client dynamically with the authorization server (RFC7591)
 */
async function registerClient(
    registrationEndpoint: string,
    redirectUri: string,
    serverUrl: string
): Promise<ClientRegistration> {
    // Check if already registered
    const cached = registeredClients.get(serverUrl);
    if (cached) {
        console.log("[OAuth] Using cached client registration:", cached.client_id);
        return cached;
    }

    console.log("[OAuth] Registering client at:", registrationEndpoint);

    const response = await fetch(registrationEndpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            redirect_uris: [redirectUri],
            token_endpoint_auth_method: "none", // PKCE flow, no client secret
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            client_name: "Procura",
            client_uri: "https://github.com/procura",
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("[OAuth] Client registration failed:", response.status, errorText);
        throw new Error(`Client registration failed: ${response.status} - ${errorText}`);
    }

    const registration: ClientRegistration = await response.json();
    console.log("[OAuth] Client registered successfully:", registration.client_id);

    // Cache for future use
    registeredClients.set(serverUrl, registration);

    return registration;
}

// ============================================================================
// PKCE Utilities
// ============================================================================

/**
 * Generate a random code verifier for PKCE
 */
function generateCodeVerifier(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return base64UrlEncode(array);
}

/**
 * Generate code challenge from verifier (S256 method)
 */
async function generateCodeChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return base64UrlEncode(new Uint8Array(digest));
}

/**
 * Base64 URL encode (without padding)
 */
function base64UrlEncode(data: Uint8Array): string {
    const base64 = btoa(String.fromCharCode(...data));
    /* eslint-disable sonarjs/slow-regex -- safe: simple replacement patterns on short OAuth tokens */
    return base64
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    /* eslint-enable sonarjs/slow-regex */
}

/**
 * Generate a random state parameter
 */
function generateState(): string {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return base64UrlEncode(array);
}

// ============================================================================
// OAuth Discovery
// ============================================================================

/**
 * Fetch Protected Resource Metadata (RFC9728)
 */
async function fetchResourceMetadata(url: string): Promise<ProtectedResourceMetadata> {
    const response = await fetch(url, {
        headers: { "Accept": "application/json" },
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch resource metadata: ${response.status}`);
    }

    return response.json();
}

/**
 * Fetch Authorization Server Metadata (RFC8414)
 * Falls back to constructing endpoints from base URL if discovery fails
 */
async function fetchAuthServerMetadata(issuer: string): Promise<AuthServerMetadata> {
    const baseUrl = issuer.replace(/\/$/, "");

    // Try OAuth 2.0 well-known endpoint first
    const oauthUrl = `${baseUrl}/.well-known/oauth-authorization-server`;
    console.log("[OAuth] Trying RFC8414 discovery:", oauthUrl);

    let response = await fetch(oauthUrl, {
        headers: { "Accept": "application/json" },
    });

    if (!response.ok) {
        // Fallback to OpenID Connect discovery
        const oidcUrl = `${baseUrl}/.well-known/openid-configuration`;
        console.log("[OAuth] Trying OIDC discovery:", oidcUrl);
        response = await fetch(oidcUrl, {
            headers: { "Accept": "application/json" },
        });
    }

    if (response.ok) {
        return response.json();
    }

    // Final fallback: Construct standard OAuth endpoints from base URL
    // This is for providers like GitHub that don't support RFC8414
    console.log("[OAuth] Discovery failed, constructing endpoints from base URL:", baseUrl);
    return {
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/authorize`,
        token_endpoint: `${baseUrl}/access_token`,
    };
}

// ============================================================================
// OAuth Flow
// ============================================================================

interface PendingAuth {
    codeVerifier: string;
    state: string;
    redirectUri: string;
    tokenEndpoint: string;
    serverUrl: string;
    clientId: string;
}

// Store pending auth sessions
const pendingAuths = new Map<string, PendingAuth>();

/**
 * Start OAuth authorization flow
 * Returns the authorization URL to open in a new tab
 * @param serverUrl - The MCP server URL
 * @param metadataUrl - Either resource metadata URL or direct auth server metadata URL
 * @param scope - Optional scope from WWW-Authenticate
 * @param useDirectAuthServer - If true, metadataUrl points directly to auth server metadata
 */
async function startOAuthFlow(
    serverUrl: string,
    metadataUrl: string,
    scope?: string,
    useDirectAuthServer?: boolean,
    apiKey?: string
): Promise<string> {
    console.log("[OAuth] Starting flow", { serverUrl, metadataUrl, useDirectAuthServer });

    let authMetadata: AuthServerMetadata;
    // eslint-disable-next-line sonarjs/no-dead-store -- scopes is reassigned in both if branches
    let scopes = scope || "";

    if (useDirectAuthServer) {
        // metadataUrl is already the auth server metadata URL
        console.log("[OAuth] Fetching auth server metadata directly:", metadataUrl);
        const response = await fetch(metadataUrl, {
            headers: { "Accept": "application/json" },
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch auth server metadata: ${response.status}`);
        }

        authMetadata = await response.json();
        console.log("[OAuth] Auth metadata:", authMetadata);

        scopes = scope || authMetadata.scopes_supported?.join(" ") || "";
    } else {
        // Standard flow: fetch resource metadata first
        const resourceMetadata = await fetchResourceMetadata(metadataUrl);

        if (!resourceMetadata.authorization_servers?.length) {
            throw new Error("No authorization servers found in resource metadata");
        }

        const authServerUrl = resourceMetadata.authorization_servers[0];
        authMetadata = await fetchAuthServerMetadata(authServerUrl);
        scopes = scope || resourceMetadata.scopes_supported?.join(" ") || "";
    }

    // Generate PKCE parameters
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateState();

    // Build redirect URI
    const redirectUri = `${window.location.origin}/oauth/callback`;
    console.log("[OAuth] Redirect URI:", redirectUri);

    // Dynamic Client Registration if endpoint available
    let clientId: string;
    if (authMetadata.registration_endpoint) {
        const registration = await registerClient(
            authMetadata.registration_endpoint,
            redirectUri,
            serverUrl
        );
        clientId = registration.client_id;
    } else {
        // Fallback client_id
        clientId = window.location.origin;
    }
    console.log("[OAuth] Using client_id:", clientId);

    // Store pending auth
    pendingAuths.set(state, {
        codeVerifier,
        state,
        redirectUri,
        tokenEndpoint: authMetadata.token_endpoint,
        serverUrl,
        clientId, // Store for token exchange
    });

    // Build authorization URL
    const params = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        resource: serverUrl,
    });

    if (scopes) {
        params.set("scope", scopes);
    }

    const apiKeySuffix = apiKey ? `&api_key=${encodeURIComponent(apiKey)}` : "";
    const authUrl = `${authMetadata.authorization_endpoint}?${params.toString()}${apiKeySuffix}`;
    console.log("[OAuth] Auth URL:", authUrl);
    return authUrl;
}

/**
 * Complete OAuth flow - exchange code for tokens
 */
async function completeOAuthFlow(
    authorizationCode: string,
    state: string
): Promise<{ accessToken: string; serverUrl: string }> {
    const pending = pendingAuths.get(state);
    if (!pending) {
        throw new Error("No pending authorization found for this state");
    }

    pendingAuths.delete(state);

    console.log("[OAuth] Exchanging code for token at:", pending.tokenEndpoint);

    // Exchange code for tokens
    const response = await fetch(pending.tokenEndpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
            grant_type: "authorization_code",
            code: authorizationCode,
            redirect_uri: pending.redirectUri,
            client_id: pending.clientId,
            code_verifier: pending.codeVerifier,
            resource: pending.serverUrl,
        }).toString(),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token exchange failed: ${error}`);
    }

    const tokens: OAuthTokens = await response.json();

    return {
        accessToken: tokens.access_token,
        serverUrl: pending.serverUrl,
    };
}

/**
 * Launch OAuth flow using window.open popup.
 * Works in both Extension and PWA contexts.
 */
export async function launchOAuthPopup(
    serverUrl: string,
    metadataUrl: string,
    scope?: string,
    useDirectAuthServer?: boolean,
    apiKey?: string
): Promise<string> {
    console.log("[OAuth] launchOAuthPopup called");
    const authUrl = await startOAuthFlow(serverUrl, metadataUrl, scope, useDirectAuthServer, apiKey);
    console.log("[OAuth] Auth URL:", authUrl);

    return new Promise((resolve, reject) => {
        const width = 500, height = 700;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;
        const popup = window.open(
            authUrl,
            "oauth-popup",
            `width=${width},height=${height},left=${left},top=${top}`
        );

        if (!popup) {
            reject(new Error("Failed to open popup — check popup blocker"));
            return;
        }

        // Listen for postMessage from the backend callback page
        const onMessage = async (event: MessageEvent) => {
            if (event.data?.type !== "oauth-callback") return;
            cleanup();
            try {
                const { code, state } = event.data as { code: string; state: string };
                const result = await completeOAuthFlow(code, state);
                resolve(result.accessToken);
            } catch (e) {
                reject(e);
            }
        };

        // Monitor popup close (user cancelled)
        const closeCheck = setInterval(() => {
            if (popup.closed) {
                cleanup();
                reject(new Error("OAuth popup closed by user"));
            }
        }, 500);

        const cleanup = () => {
            window.removeEventListener("message", onMessage);
            clearInterval(closeCheck);
        };

        window.addEventListener("message", onMessage);
    });
}
