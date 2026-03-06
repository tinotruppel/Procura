/**
 * Trello-specific OAuth module
 *
 * Thin wrapper around oauth-session.ts for Trello-specific:
 *   - Configuration (TRELLO_APP_KEY)
 *   - Token retrieval (Trello tokens are long-lived, no refresh needed)
 *
 * All session management (encryption, DB storage, caching) is handled
 * by the generic oauth-session module.
 */

import {
    storeRefreshToken as storeToken,
    getRefreshTokenBySession,
    isValidSession as checkSession,
    hasConnected as checkConnected,
    deleteTokensByUser as deleteTokens,
} from "./oauth-session";

const PROVIDER = "trello";

// =============================================================================
// Configuration
// =============================================================================

export function isTrelloConfigured(): boolean {
    return !!process.env.TRELLO_APP_KEY;
}

export function getTrelloAppKey(): string {
    return process.env.TRELLO_APP_KEY || "";
}

// =============================================================================
// Provider-bound wrappers
// =============================================================================

/**
 * Store a Trello user token (encrypted) and return a session token.
 * Reuses oauth-session's refresh_token column since Trello tokens are long-lived.
 */
export function storeUserToken(keyId: string, userToken: string): Promise<string> {
    return storeToken(keyId, PROVIDER, userToken);
}

export function isValidSession(sessionToken: string): Promise<boolean> {
    return checkSession(sessionToken, PROVIDER);
}

export function hasConnected(keyId: string): Promise<boolean> {
    return checkConnected(keyId, PROVIDER);
}

export function deleteTokensByUser(keyId: string): Promise<void> {
    return deleteTokens(keyId, PROVIDER);
}

// =============================================================================
// Trello Token Retrieval (no refresh needed — tokens are long-lived)
// =============================================================================

/**
 * Get Trello user token for the current session.
 * Unlike Google, Trello tokens don't expire, so no refresh logic is needed.
 */
export async function getTokenForSession(sessionToken: string): Promise<string> {
    if (!isTrelloConfigured()) {
        throw new Error("Trello not configured. Set TRELLO_APP_KEY.");
    }

    const token = await getRefreshTokenBySession(sessionToken, PROVIDER);
    if (!token) {
        throw new Error("Invalid or expired session. Please reconnect your Trello account.");
    }

    return token;
}
