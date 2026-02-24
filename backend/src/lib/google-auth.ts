/**
 * Google-specific OAuth module
 *
 * Thin wrapper around oauth-session.ts for Google-specific:
 *   - Configuration (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)
 *   - Access token refresh via Google's token endpoint
 *
 * All session management (encryption, DB storage, caching) is handled
 * by the generic oauth-session module and reusable for other providers.
 */

import {
    storeRefreshToken as storeToken,
    getRefreshTokenBySession,
    isValidSession as checkSession,
    hasConnected as checkConnected,
    deleteTokensByUser as deleteTokens,
    getCachedAccessToken,
    cacheAccessToken,
} from "./oauth-session";

// Re-export generic functions bound to "google" provider
export { createAuthHeaders, clearTokenCache } from "./oauth-session";

const PROVIDER = "google";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

// =============================================================================
// Configuration
// =============================================================================

export function isGoogleConfigured(): boolean {
    return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function getGoogleClientId(): string {
    return process.env.GOOGLE_CLIENT_ID || "";
}

export function getGoogleClientSecret(): string {
    return process.env.GOOGLE_CLIENT_SECRET || "";
}

// =============================================================================
// Provider-bound wrappers
// =============================================================================

export function storeRefreshToken(userId: string, refreshToken: string): Promise<string> {
    return storeToken(userId, PROVIDER, refreshToken);
}

export function isValidSession(sessionToken: string): Promise<boolean> {
    return checkSession(sessionToken, PROVIDER);
}

export function hasConnected(userId: string): Promise<boolean> {
    return checkConnected(userId, PROVIDER);
}

export function deleteTokensByUser(userId: string): Promise<void> {
    return deleteTokens(userId, PROVIDER);
}

// =============================================================================
// Google Access Token (refresh via Google's token endpoint)
// =============================================================================

export async function getAccessTokenForSession(sessionToken: string): Promise<string> {
    const clientId = getGoogleClientId();
    const clientSecret = getGoogleClientSecret();

    if (!clientId || !clientSecret) {
        throw new Error("Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
    }

    // Return cached token if still valid
    const cached = getCachedAccessToken(sessionToken);
    if (cached) return cached;

    const refreshToken = await getRefreshTokenBySession(sessionToken, PROVIDER);
    if (!refreshToken) {
        throw new Error("Invalid or expired session. Please reconnect your Google account.");
    }

    const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
    });

    const response = await fetch(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to refresh Google token: ${response.status} ${error}`);
    }

    const data = (await response.json()) as {
        access_token: string;
        expires_in: number;
    };

    cacheAccessToken(sessionToken, data.access_token, data.expires_in);
    return data.access_token;
}
