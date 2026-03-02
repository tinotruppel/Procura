/**
 * API Key Authentication Middleware
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
 * Returns the matched key if valid, or null if invalid.
 * Returns empty string if no API keys are configured (open mode).
 */
export function validateApiKey(c: Context): string | null {
    const config = getConfig();

    // If no API keys configured, allow all (open mode for development)
    if (config.apiKeys.length === 0) {
        return "";
    }

    // Get API key from X-API-Key header
    const providedKey = c.req.header("X-API-Key") || "";
    if (providedKey) {
        const matched = config.apiKeys.find(key => timingSafeCompare(key, providedKey));
        return matched ?? null;
    }

    return null;
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
