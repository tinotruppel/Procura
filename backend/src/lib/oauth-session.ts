/**
 * Generic OAuth Session Manager (provider-agnostic)
 *
 * Reusable session + token logic for any OAuth provider:
 *   - AES-256-GCM at-rest encryption for refresh tokens
 *   - DB-backed session storage (user_id + provider → session_token + refresh_token)
 *   - In-memory access token cache with auto-expiry
 *
 * Used by google-auth.ts (and future trello-auth.ts, atlassian-auth.ts, etc.)
 */

import { randomBytes, createCipheriv, createDecipheriv, randomUUID } from "crypto";
import { getPool } from "../db/connection";
import type { RowDataPacket } from "mysql2/promise";

// =============================================================================
// At-rest encryption (AES-256-GCM)
// =============================================================================

function getEncryptionKey(): Buffer {
    const key = process.env.TOKEN_ENCRYPTION_KEY;
    if (!key) throw new Error("TOKEN_ENCRYPTION_KEY not set. Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
    return Buffer.from(key, "hex");
}

export function encryptToken(plaintext: string): string {
    const key = getEncryptionKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptToken(encoded: string): string {
    const key = getEncryptionKey();
    const [ivHex, tagHex, cipherHex] = encoded.split(":");
    if (!ivHex || !tagHex || !cipherHex) throw new Error("Invalid encrypted token format");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"), { authTagLength: 16 });
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return decipher.update(cipherHex, "hex", "utf8") + decipher.final("utf8");
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
    userId: string,
    provider: string,
    refreshToken: string
): Promise<string> {
    const encryptedRefresh = encryptToken(refreshToken);
    const now = Date.now();

    const [existing] = await getPool().execute<OAuthTokenRow[]>(
        `SELECT session_token, '' as refresh_token FROM oauth_tokens WHERE user_id = ? AND provider = ?`,
        [userId, provider]
    );

    if (existing.length > 0) {
        await getPool().execute(
            `UPDATE oauth_tokens SET refresh_token = ?, updated_at = ? WHERE user_id = ? AND provider = ?`,
            [encryptedRefresh, now, userId, provider]
        );
        return existing[0].session_token;
    }

    const sessionToken = randomUUID();
    await getPool().execute(
        `INSERT INTO oauth_tokens (user_id, provider, session_token, refresh_token, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, provider, sessionToken, encryptedRefresh, now, now]
    );
    return sessionToken;
}

/**
 * Look up a refresh token by session token. Returns null if not found.
 */
export async function getRefreshTokenBySession(
    sessionToken: string,
    provider: string
): Promise<string | null> {
    const [rows] = await getPool().execute<OAuthTokenRow[]>(
        `SELECT refresh_token FROM oauth_tokens WHERE session_token = ? AND provider = ?`,
        [sessionToken, provider]
    );
    if (!rows[0]) return null;
    return decryptToken(rows[0].refresh_token);
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
    userId: string,
    provider: string
): Promise<boolean> {
    const [rows] = await getPool().execute<OAuthTokenRow[]>(
        `SELECT 1 as session_token, '' as refresh_token FROM oauth_tokens WHERE user_id = ? AND provider = ?`,
        [userId, provider]
    );
    return rows.length > 0;
}

/**
 * Delete tokens for a user+provider (disconnect).
 */
export async function deleteTokensByUser(
    userId: string,
    provider: string
): Promise<void> {
    const [rows] = await getPool().execute<OAuthTokenRow[]>(
        `SELECT session_token, '' as refresh_token FROM oauth_tokens WHERE user_id = ? AND provider = ?`,
        [userId, provider]
    );
    for (const row of rows) {
        accessTokenCache.delete(row.session_token);
    }
    await getPool().execute(
        `DELETE FROM oauth_tokens WHERE user_id = ? AND provider = ?`,
        [userId, provider]
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
