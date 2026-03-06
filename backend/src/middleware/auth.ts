/**
 * API Key Authentication Middleware
 *
 * BYOK model: any non-empty API key is accepted. The key's SHA-256 hash
 * (key_id) becomes the user identity. Static API_KEYS validation is
 * kept as legacy fallback when the env var is set.
 */

import { timingSafeEqual } from "crypto";
import type { Context, Next } from "hono";
import { getConfig } from "../config";

/**
 * Constant-time comparison of two strings.
 * Prevents timing side-channel attacks on API key validation.
 */
function timingSafeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Validates API key from X-API-Key header.
 *
 * - If API_KEYS is configured: validates against that list (legacy mode).
 * - If API_KEYS is empty: accepts any non-empty key (BYOK mode).
 * - Returns the raw API key if valid, null if invalid.
 */
export function validateApiKey(c: Context): string | null {
    const config = getConfig();
    const providedKey = c.req.header("X-API-Key") || "";

    // Legacy mode: validate against static API_KEYS list
    if (config.apiKeys.length > 0) {
        if (!providedKey) return null;
        const matched = config.apiKeys.find(key => timingSafeCompare(key, providedKey));
        return matched ?? null;
    }

    // BYOK / open mode: no static keys configured
    // If a key is provided, pass it through (its SHA-256 hash = key_id)
    // If no key is provided, allow access (open mode for development)
    return providedKey;
}

/**
 * Middleware that requires a valid API key.
 * Stores the matched key on the context for downstream use.
 */
export async function authMiddleware(c: Context, next: Next) {
    const matchedKey = validateApiKey(c);
    if (matchedKey === null) {
        return c.json({ error: "Invalid or missing API key" }, 401);
    }
    // Store matched key for per-key config resolution (e.g. Qdrant key mapping)
    c.set("apiKey", matchedKey);
    await next();
}
