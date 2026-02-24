/**
 * Unit Tests for OAuth Session Manager
 *
 * Tests the pure functions in oauth-session.ts:
 * - Token encryption/decryption (AES-256-GCM)
 * - Access token caching (in-memory)
 * - Auth header creation
 *
 * Note: DB-backed functions (storeRefreshToken, getRefreshTokenBySession, etc.)
 * are tested indirectly via google-oauth.test.ts integration tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
    encryptToken,
    decryptToken,
    getCachedAccessToken,
    cacheAccessToken,
    clearTokenCache,
    createAuthHeaders,
} from "../../src/lib/oauth-session";

// Set encryption key for tests
const TEST_KEY = "a".repeat(64); // 32-byte hex key

describe("OAuth Session Manager", () => {
    beforeEach(() => {
        clearTokenCache();
        process.env.TOKEN_ENCRYPTION_KEY = TEST_KEY;
    });

    afterEach(() => {
        delete process.env.TOKEN_ENCRYPTION_KEY;
    });

    // =========================================================================
    // Encryption
    // =========================================================================

    describe("encryptToken / decryptToken", () => {
        it("should encrypt and decrypt a token", () => {
            const original = "my-secret-refresh-token";
            const encrypted = encryptToken(original);
            expect(encrypted).not.toBe(original);
            expect(encrypted.split(":")).toHaveLength(3);
            const decrypted = decryptToken(encrypted);
            expect(decrypted).toBe(original);
        });

        it("should produce different ciphertexts for same input (random IV)", () => {
            const token = "same-token";
            const enc1 = encryptToken(token);
            const enc2 = encryptToken(token);
            expect(enc1).not.toBe(enc2);
            expect(decryptToken(enc1)).toBe(token);
            expect(decryptToken(enc2)).toBe(token);
        });

        it("should encrypt empty string to valid format", () => {
            const encrypted = encryptToken("");
            // Empty plaintext produces empty ciphertext hex, which is falsy → format check throws
            expect(encrypted.split(":")).toHaveLength(3);
        });

        it("should handle long tokens", () => {
            const longToken = "x".repeat(2048);
            const encrypted = encryptToken(longToken);
            expect(decryptToken(encrypted)).toBe(longToken);
        });

        it("should handle unicode content", () => {
            const unicodeToken = "token-mit-überzeichen-🔐";
            const encrypted = encryptToken(unicodeToken);
            expect(decryptToken(encrypted)).toBe(unicodeToken);
        });

        it("should throw on invalid encrypted format", () => {
            expect(() => decryptToken("invalid")).toThrow("Invalid encrypted token format");
        });

        it("should throw on partial format (only 2 parts)", () => {
            expect(() => decryptToken("aa:bb")).toThrow("Invalid encrypted token format");
        });

        it("should throw without encryption key", () => {
            delete process.env.TOKEN_ENCRYPTION_KEY;
            expect(() => encryptToken("test")).toThrow("TOKEN_ENCRYPTION_KEY not set");
        });

        it("should throw on decrypt without encryption key", () => {
            const encrypted = encryptToken("test");
            delete process.env.TOKEN_ENCRYPTION_KEY;
            expect(() => decryptToken(encrypted)).toThrow("TOKEN_ENCRYPTION_KEY not set");
        });

        it("should throw on tampered ciphertext", () => {
            const encrypted = encryptToken("test");
            const parts = encrypted.split(":");
            parts[2] = "ff".repeat(parts[2].length / 2); // tamper ciphertext
            expect(() => decryptToken(parts.join(":"))).toThrow();
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
