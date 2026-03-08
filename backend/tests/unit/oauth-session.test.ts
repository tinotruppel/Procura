/**
 * Unit Tests for OAuth Session Manager
 *
 * Tests the pure functions in oauth-session.ts:
 * - Token encryption/decryption (BYOK via vault-crypto)
 * - Access token caching (in-memory)
 * - Auth header creation
 *
 * Note: DB-backed functions (storeRefreshToken, getRefreshTokenBySession, etc.)
 * are tested indirectly via google-oauth.test.ts integration tests.
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
    encryptToken,
    decryptToken,
    getCachedAccessToken,
    cacheAccessToken,
    clearTokenCache,
    createAuthHeaders,
} from "../../src/lib/oauth-session";

// Test API key (simulates user's BYOK key)
const TEST_API_KEY = "test-api-key-for-byok-encryption-12345";
const DIFFERENT_API_KEY = "different-api-key-for-testing-67890";

describe("OAuth Session Manager", () => {
    beforeEach(() => {
        clearTokenCache();
    });

    // =========================================================================
    // Encryption (BYOK)
    // =========================================================================

    describe("encryptToken / decryptToken", () => {
        it("should encrypt and decrypt a token using API key", () => {
            const original = "my-secret-refresh-token";
            const encrypted = encryptToken(TEST_API_KEY, original);
            expect(encrypted).not.toBe(original);
            // BYOK format is JSON with s, i, t, c fields
            const parsed = JSON.parse(encrypted);
            expect(parsed).toHaveProperty("s");
            expect(parsed).toHaveProperty("i");
            expect(parsed).toHaveProperty("t");
            expect(parsed).toHaveProperty("c");
            const decrypted = decryptToken(TEST_API_KEY, encrypted);
            expect(decrypted).toBe(original);
        });

        it("should produce different ciphertexts for same input (random salt+IV)", () => {
            const token = "same-token";
            const enc1 = encryptToken(TEST_API_KEY, token);
            const enc2 = encryptToken(TEST_API_KEY, token);
            expect(enc1).not.toBe(enc2);
            expect(decryptToken(TEST_API_KEY, enc1)).toBe(token);
            expect(decryptToken(TEST_API_KEY, enc2)).toBe(token);
        });

        it("should encrypt empty string", () => {
            const encrypted = encryptToken(TEST_API_KEY, "");
            const decrypted = decryptToken(TEST_API_KEY, encrypted);
            expect(decrypted).toBe("");
        });

        it("should handle long tokens", () => {
            const longToken = "x".repeat(2048);
            const encrypted = encryptToken(TEST_API_KEY, longToken);
            expect(decryptToken(TEST_API_KEY, encrypted)).toBe(longToken);
        });

        it("should handle unicode content", () => {
            const unicodeToken = "token-mit-überzeichen-🔐";
            const encrypted = encryptToken(TEST_API_KEY, unicodeToken);
            expect(decryptToken(TEST_API_KEY, encrypted)).toBe(unicodeToken);
        });

        it("should fail to decrypt with wrong API key", () => {
            const encrypted = encryptToken(TEST_API_KEY, "secret");
            expect(() => decryptToken(DIFFERENT_API_KEY, encrypted)).toThrow();
        });

        it("should throw on invalid JSON format", () => {
            expect(() => decryptToken(TEST_API_KEY, "not-json")).toThrow();
        });

        it("should throw on tampered ciphertext", () => {
            const encrypted = encryptToken(TEST_API_KEY, "test");
            const parsed = JSON.parse(encrypted);
            parsed.c = "ff".repeat(parsed.c.length / 2); // tamper ciphertext
            expect(() => decryptToken(TEST_API_KEY, JSON.stringify(parsed))).toThrow();
        });
    });

    // =========================================================================
    // Access Token Cache
    // =========================================================================

    describe("getCachedAccessToken / cacheAccessToken", () => {
        it("should return null for uncached session", () => {
            expect(getCachedAccessToken("nonexistent")).toBeNull();
        });

        it("should cache and retrieve access token", () => {
            cacheAccessToken("session-1", "access-token-1", 3600);
            expect(getCachedAccessToken("session-1")).toBe("access-token-1");
        });

        it("should return null for expired token", () => {
            cacheAccessToken("session-2", "expired-token", 0);
            expect(getCachedAccessToken("session-2")).toBeNull();
        });

        it("should return null when within 5-minute buffer", () => {
            // Token expires in 4 minutes = within 5-minute safety buffer
            cacheAccessToken("session-buffered", "buffer-token", 240);
            expect(getCachedAccessToken("session-buffered")).toBeNull();
        });

        it("should cache multiple sessions independently", () => {
            cacheAccessToken("session-a", "token-a", 3600);
            cacheAccessToken("session-b", "token-b", 3600);
            expect(getCachedAccessToken("session-a")).toBe("token-a");
            expect(getCachedAccessToken("session-b")).toBe("token-b");
        });

        it("should overwrite cached token", () => {
            cacheAccessToken("session-overwrite", "old-token", 3600);
            cacheAccessToken("session-overwrite", "new-token", 3600);
            expect(getCachedAccessToken("session-overwrite")).toBe("new-token");
        });

        it("should clear all cached tokens", () => {
            cacheAccessToken("session-x", "token-x", 3600);
            cacheAccessToken("session-y", "token-y", 3600);
            clearTokenCache();
            expect(getCachedAccessToken("session-x")).toBeNull();
            expect(getCachedAccessToken("session-y")).toBeNull();
        });
    });

    // =========================================================================
    // Auth Headers
    // =========================================================================

    describe("createAuthHeaders", () => {
        it("should create Bearer auth headers", () => {
            const headers = createAuthHeaders("my-token");
            expect(headers.Authorization).toBe("Bearer my-token");
            expect(headers["Content-Type"]).toBe("application/json");
        });

        it("should include exact token in header", () => {
            const headers = createAuthHeaders("ya29.a0AV5...");
            expect(headers.Authorization).toBe("Bearer ya29.a0AV5...");
        });
    });
});
