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
 * Validates API key from Authorization header.
 * Returns true if valid or if no API keys are configured (open mode).
 */
export function validateApiKey(c: Context): boolean {
    const config = getConfig();

    // If no API keys configured, allow all (open mode for development)
    if (config.apiKeys.length === 0) {
        return true;
    }

    // Get API key from Authorization header: "Bearer <key>"
    const authHeader = c.req.header("Authorization") || "";
    const prefix = "Bearer ";
    if (authHeader.toLowerCase().startsWith(prefix.toLowerCase())) {
        const providedKey = authHeader.slice(prefix.length).trim();
        if (providedKey) {
            return config.apiKeys.some(key => timingSafeCompare(key, providedKey));
        }
    }

    return false;
}

/**
 * Middleware that requires a valid API key
 */
export async function authMiddleware(c: Context, next: Next) {
    if (!validateApiKey(c)) {
        return c.json({ error: "Invalid or missing API key" }, 401);
    }
    await next();
}
