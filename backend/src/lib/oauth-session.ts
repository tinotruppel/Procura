/**
 * Generic OAuth Session Manager (provider-agnostic)
 *
 * Reusable session + token logic for any OAuth provider:
 *   - BYOK encryption using the user's API key (via vault-crypto)
 *   - DB-backed session storage (key_id + provider → session_token + refresh_token)
 *   - In-memory access token cache with auto-expiry
 *
 * Used by google-auth.ts, trello-auth.ts (and future providers)
 */

import { randomUUID } from "crypto";
import { getPool } from "../db/connection";
import type { RowDataPacket } from "mysql2/promise";
import { encryptSecret, decryptSecret, type EncryptedPayload } from "./vault-crypto";

// =============================================================================
// At-rest encryption (BYOK via vault-crypto)
// =============================================================================

/**
 * Encrypt a token using the user's API key (BYOK pattern).
 * Returns a compact JSON string stored in the DB column.
 */
export function encryptToken(apiKey: string, plaintext: string): string {
    const payload = encryptSecret(apiKey, plaintext);
    return JSON.stringify({
        s: payload.salt.toString("hex"),
        i: payload.iv.toString("hex"),
        t: payload.tag.toString("hex"),
        c: payload.ciphertext.toString("hex"),
    });
}

/**
 * Decrypt a token using the user's API key (BYOK pattern).
 */
export function decryptToken(apiKey: string, encoded: string): string {
    const parsed = JSON.parse(encoded) as { s: string; i: string; t: string; c: string };
    const payload: EncryptedPayload = {
        salt: Buffer.from(parsed.s, "hex"),
        iv: Buffer.from(parsed.i, "hex"),
        tag: Buffer.from(parsed.t, "hex"),
        ciphertext: Buffer.from(parsed.c, "hex"),
    };
    return decryptSecret(apiKey, payload);
}

// =============================================================================
// DB Token Storage
// =============================================================================

interface OAuthTokenRow extends RowDataPacket {
    session_token: string;
    refresh_token: string;
}

/**
 * Store a refresh token and return the session token for the client.
 * If a session already exists for this user+provider, the refresh token is
 * updated but the EXISTING session token is preserved — so other clients
 * sharing the same session stay authenticated.
 */
export async function storeRefreshToken(
    keyId: string,
    provider: string,
    refreshToken: string,
    apiKey: string,
): Promise<string> {
    const encryptedRefresh = encryptToken(apiKey, refreshToken);
    const now = Date.now();

    const [existing] = await getPool().execute<OAuthTokenRow[]>(
        `SELECT session_token, '' as refresh_token FROM oauth_tokens WHERE key_id = ? AND provider = ?`,
        [keyId, provider]
    );

    if (existing.length > 0) {
        await getPool().execute(
            `UPDATE oauth_tokens SET refresh_token = ?, updated_at = ? WHERE key_id = ? AND provider = ?`,
            [encryptedRefresh, now, keyId, provider]
        );
        return existing[0].session_token;
    }

    const sessionToken = randomUUID();
    await getPool().execute(
        `INSERT INTO oauth_tokens (key_id, provider, session_token, refresh_token, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [keyId, provider, sessionToken, encryptedRefresh, now, now]
    );
    return sessionToken;
}

/**
 * Look up a refresh token by session token. Returns null if not found.
 */
export async function getRefreshTokenBySession(
    sessionToken: string,
    provider: string,
    apiKey: string,
): Promise<string | null> {
    const [rows] = await getPool().execute<OAuthTokenRow[]>(
        `SELECT refresh_token FROM oauth_tokens WHERE session_token = ? AND provider = ?`,
        [sessionToken, provider]
    );
    if (!rows[0]) return null;
    return decryptToken(apiKey, rows[0].refresh_token);
}


/**
 * Check if a session token exists and is valid for the given provider.
 */
export async function isValidSession(
    sessionToken: string,
    provider: string
): Promise<boolean> {
    const [rows] = await getPool().execute<OAuthTokenRow[]>(
        `SELECT 1 as session_token, '' as refresh_token FROM oauth_tokens WHERE session_token = ? AND provider = ?`,
        [sessionToken, provider]
    );
    return rows.length > 0;
}

/**
 * Check if a user has connected a specific provider.
 */
export async function hasConnected(
    keyId: string,
    provider: string
): Promise<boolean> {
    const [rows] = await getPool().execute<OAuthTokenRow[]>(
        `SELECT 1 as session_token, '' as refresh_token FROM oauth_tokens WHERE key_id = ? AND provider = ?`,
        [keyId, provider]
    );
    return rows.length > 0;
}

/**
 * Delete tokens for a user+provider (disconnect).
 */
export async function deleteTokensByUser(
    keyId: string,
    provider: string
): Promise<void> {
    const [rows] = await getPool().execute<OAuthTokenRow[]>(
        `SELECT session_token, '' as refresh_token FROM oauth_tokens WHERE key_id = ? AND provider = ?`,
        [keyId, provider]
    );
    for (const row of rows) {
        accessTokenCache.delete(row.session_token);
    }
    await getPool().execute(
        `DELETE FROM oauth_tokens WHERE key_id = ? AND provider = ?`,
        [keyId, provider]
    );
}

// =============================================================================
// Access Token Cache (in-memory, per-session)
// =============================================================================

const accessTokenCache = new Map<string, { accessToken: string; expiry: number }>();

/**
 * Get a cached access token if still valid (5-min buffer).
 */
export function getCachedAccessToken(sessionToken: string): string | null {
    const cached = accessTokenCache.get(sessionToken);
    if (cached && Date.now() < cached.expiry - 300_000) return cached.accessToken;
    return null;
}

/**
 * Cache a fresh access token.
 */
export function cacheAccessToken(
    sessionToken: string,
    accessToken: string,
    expiresInSeconds: number
): void {
    accessTokenCache.set(sessionToken, {
        accessToken,
        expiry: Date.now() + expiresInSeconds * 1000,
    });
}

/**
 * Clear all cached tokens (for testing).
 */
export function clearTokenCache(): void {
    accessTokenCache.clear();
}

// =============================================================================
// Helpers
// =============================================================================

export function createAuthHeaders(token: string): {
    Authorization: string;
    "Content-Type": string;
} {
    return {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
    };
}
