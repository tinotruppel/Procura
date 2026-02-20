/**
 * Shared Google OAuth2 authentication module
 * Used by Google Docs, Sheets, and other Google Workspace tools
 * 
 * Supports both:
 * - Chrome Extension: uses chrome.identity.launchWebAuthFlow
 * - PWA/Web: uses popup-based OAuth flow
 */

import { isExtension } from "@/platform";

// Helper type for Chrome identity API
declare const chrome: {
    identity: {
        launchWebAuthFlow: (options: { url: string; interactive: boolean }) => Promise<string>;
        getRedirectURL: () => string;
    };
};

// Token cache per scope set
interface CachedToken {
    token: string;
    expiry: number;
    scopes: string;
}

let cachedToken: CachedToken | null = null;

/**
 * Available Google OAuth2 scopes
 */
const GoogleScopes = {
    // Google Docs
    DOCUMENTS: "https://www.googleapis.com/auth/documents",
    // Google Sheets
    SPREADSHEETS: "https://www.googleapis.com/auth/spreadsheets",
    // Google Drive
    DRIVE_FILE: "https://www.googleapis.com/auth/drive.file",
    DRIVE_METADATA: "https://www.googleapis.com/auth/drive.metadata",
} as const;

/**
 * Predefined scope sets for different tools
 */
export const ScopeSets = {
    DOCS: [GoogleScopes.DOCUMENTS, GoogleScopes.DRIVE_FILE, GoogleScopes.DRIVE_METADATA],
    SHEETS: [GoogleScopes.SPREADSHEETS, GoogleScopes.DRIVE_FILE, GoogleScopes.DRIVE_METADATA],
    // All scopes for tools that need both
    ALL: [GoogleScopes.DOCUMENTS, GoogleScopes.SPREADSHEETS, GoogleScopes.DRIVE_FILE, GoogleScopes.DRIVE_METADATA],
} as const;

/**
 * Clear the token cache (useful for testing)
 */
/**
 * Get OAuth2 access token using the appropriate method for the platform
 * 
 * @param clientId - Google OAuth client ID
 * @param scopes - Array of OAuth scopes to request
 * @param interactive - Whether to show auth UI (default: true)
 */
export async function getGoogleAccessToken(
    clientId: string,
    scopes: readonly string[],
    interactive: boolean = true
): Promise<string> {
    // eslint-disable-next-line sonarjs/no-alphabetical-sort -- safe: OAuth scopes are ASCII strings
    const scopeKey = [...scopes].sort().join(" ");

    // Return cached token if still valid (with 5 min buffer) and scopes match
    if (cachedToken && cachedToken.scopes === scopeKey && Date.now() < cachedToken.expiry - 300000) {
        return cachedToken.token;
    }

    // Use appropriate OAuth flow based on platform
    if (isExtension()) {
        return getTokenViaExtension(clientId, scopeKey, interactive);
    } else {
        return getTokenViaPopup(clientId, scopeKey);
    }
}

/**
 * Chrome Extension OAuth flow using chrome.identity
 */
async function getTokenViaExtension(
    clientId: string,
    scopeKey: string,
    interactive: boolean
): Promise<string> {
    try {
        const redirectUrl = chrome.identity.getRedirectURL();

        const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        authUrl.searchParams.set("client_id", clientId);
        authUrl.searchParams.set("redirect_uri", redirectUrl);
        authUrl.searchParams.set("response_type", "token");
        authUrl.searchParams.set("scope", scopeKey);

        console.log(`[Google OAuth] Raw Extension Redirect URL: ${redirectUrl}`);
        console.log(`[Google OAuth] Full Auth URL Launching: ${authUrl.toString()}`);

        const responseUrl = await chrome.identity.launchWebAuthFlow({
            url: authUrl.toString(),
            interactive,
        });

        // Extract token from response URL
        const url = new URL(responseUrl);
        const hashParams = new URLSearchParams(url.hash.substring(1));
        const token = hashParams.get("access_token");
        const expiresIn = parseInt(hashParams.get("expires_in") || "3600", 10);

        if (!token) {
            throw new Error("No access token in response");
        }

        // Cache the token
        cachedToken = {
            token,
            expiry: Date.now() + expiresIn * 1000,
            scopes: scopeKey,
        };

        return token;
    } catch (error) {
        throw new Error(`Failed to get auth token: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
}

/**
 * PWA/Web OAuth flow using popup window
 */
async function getTokenViaPopup(
    clientId: string,
    scopeKey: string
): Promise<string> {
    return new Promise((resolve, reject) => {
        // Calculate popup position (center of screen)
        const width = 500;
        const height = 600;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;

        // Build OAuth URL with our callback page as redirect
        const redirectUri = `${window.location.origin}/oauth-callback.html`;

        const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        authUrl.searchParams.set("client_id", clientId);
        authUrl.searchParams.set("redirect_uri", redirectUri);
        authUrl.searchParams.set("response_type", "token");
        authUrl.searchParams.set("scope", scopeKey);
        authUrl.searchParams.set("prompt", "consent");

        // Open popup
        const popup = window.open(
            authUrl.toString(),
            "google-oauth",
            `width=${width},height=${height},left=${left},top=${top},popup=true`
        );

        if (!popup) {
            reject(new Error("Popup could not be opened. Please disable your popup blocker."));
            return;
        }

        const timeoutId = setTimeout(() => {
            clearInterval(pollInterval);
            window.removeEventListener("message", messageHandler);
            if (!popup.closed) {
                popup.close();
            }
            reject(new Error("OAuth timeout - please try again."));
        }, 300000);

        // Listen for message from popup
        const messageHandler = (event: MessageEvent) => {
            // Verify origin
            if (event.origin !== window.location.origin) {
                return;
            }

            if (event.data?.type === "GOOGLE_OAUTH_SUCCESS") {
                window.removeEventListener("message", messageHandler);
                clearInterval(pollInterval);
                clearTimeout(timeoutId);

                const { accessToken, expiresIn } = event.data;

                // Cache the token
                cachedToken = {
                    token: accessToken,
                    expiry: Date.now() + expiresIn * 1000,
                    scopes: scopeKey,
                };

                resolve(accessToken);
            } else if (event.data?.type === "GOOGLE_OAUTH_ERROR") {
                window.removeEventListener("message", messageHandler);
                clearInterval(pollInterval);
                clearTimeout(timeoutId);
                reject(new Error(event.data.error || "OAuth failed"));
            }
        };

        window.addEventListener("message", messageHandler);

        // Poll to check if popup was closed without completing
        const pollInterval = setInterval(() => {
            if (popup.closed) {
                clearInterval(pollInterval);
                window.removeEventListener("message", messageHandler);
                clearTimeout(timeoutId);
                reject(new Error("Authentication cancelled"));
            }
        }, 500);
    });
}

/**
 * Create authorization headers for Google API requests
 */
export function createAuthHeaders(token: string): { Authorization: string; "Content-Type": string } {
    return {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
    };
}
