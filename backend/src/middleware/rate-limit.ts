/**
 * Rate Limiting Middleware
 * In-memory rate limiting with automatic eviction of old entries.
 */

import { createHash } from "crypto";
import type { Context, Next } from "hono";
import { getConfig } from "../config";

interface RateLimitEntry {
    requests: number[];
    blockedUntil: number;
    lastAccess: number;
}

/** Maximum number of tracked IPs before eviction kicks in */
const MAX_ENTRIES = 10_000;
/** How many entries to evict when the limit is reached (10%) */
const EVICT_COUNT = 1_000;

const store = new Map<string, RateLimitEntry>();

/**
 * Hash an IP address for privacy (SHA-256 instead of MD5).
 */
function hashIp(ip: string): string {
    return createHash("sha256").update(ip).digest("hex");
}

/**
 * Evict the oldest entries when memory limit is reached.
 * Removes EVICT_COUNT entries with the oldest lastAccess timestamp.
 */
function evictOldEntries(): void {
    if (store.size <= MAX_ENTRIES) return;

    // Sort entries by lastAccess ascending and remove the oldest
    const entries = [...store.entries()]
        .sort((a, b) => a[1].lastAccess - b[1].lastAccess);

    const toRemove = entries.slice(0, EVICT_COUNT);
    for (const [key] of toRemove) {
        store.delete(key);
    }
}

/**
 * Check and update rate limit for an IP address.
 * Returns true if allowed, false if rate limited.
 */
export function checkRateLimit(ip: string): boolean {
    const config = getConfig();
    const maxRequests = config.rateLimit.requests;
    const windowSeconds = config.rateLimit.window;

    const ipHash = hashIp(ip);
    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);

    let entry = store.get(ipHash);

    if (!entry) {
        // Evict before adding new entry
        evictOldEntries();
        entry = { requests: [], blockedUntil: 0, lastAccess: nowMs };
        store.set(ipHash, entry);
    }

    entry.lastAccess = nowMs;

    // Check if currently blocked
    if (entry.blockedUntil > nowSec) {
        return false;
    }

    // Filter requests within window
    entry.requests = entry.requests.filter(t => t > nowSec - windowSeconds);

    // Check limit
    if (entry.requests.length >= maxRequests) {
        entry.blockedUntil = nowSec + windowSeconds;
        return false;
    }

    // Record current request
    entry.requests.push(nowSec);
    return true;
}

/**
 * Rate limiting middleware
 */
export async function rateLimitMiddleware(c: Context, next: Next) {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0].trim()
        || c.req.header("x-real-ip")
        || "unknown";

    if (!checkRateLimit(ip)) {
        const config = getConfig();
        c.header("Retry-After", String(config.rateLimit.window));
        return c.json({ error: "Rate limit exceeded. Try again later." }, 429);
    }

    await next();
}

// ============================================================================
// Test Helpers (exported for tests only, tree-shaken in production)
// ============================================================================

/** Reset the in-memory store (for testing) */
export function resetRateLimitStore(): void {
    store.clear();
}

/** Get the current store size (for testing) */
export function getRateLimitStoreSize(): number {
    return store.size;
}
