/**
 * Unit Tests for OAuth Session Manager
 *
 * Tests the encrypt/decrypt, caching, and auth header helpers.
 * DB-dependent functions are tested implicitly via integration tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/db/connection", async () => {
    return await import("../helpers/db-mock");
});

import {
    encryptToken,
    decryptToken,
    getCachedAccessToken,
    cacheAccessToken,
    clearTokenCache,
    createAuthHeaders,
} from "../../src/lib/oauth-session";

describe("OAuth Session Module", () => {
    beforeEach(() => {
        clearTokenCache();
    });

    describe("Token Encryption / Decryption", () => {
        it("should encrypt and decrypt a token round-trip", () => {
            const apiKey = "test-api-key-for-encryption";
            const plaintext = "refresh-token-abc123";

            const encrypted = encryptToken(apiKey, plaintext);
            expect(typeof encrypted).toBe("string");
            expect(encrypted).not.toBe(plaintext);

            const decrypted = decryptToken(apiKey, encrypted);
            expect(decrypted).toBe(plaintext);
        });

        it("should produce different ciphertexts for the same plaintext (random salt)", () => {
            const apiKey = "test-api-key";
            const plaintext = "my-secret-token";

            const enc1 = encryptToken(apiKey, plaintext);
            const enc2 = encryptToken(apiKey, plaintext);
            expect(enc1).not.toBe(enc2);

            // Both should decrypt to the same value
            expect(decryptToken(apiKey, enc1)).toBe(plaintext);
            expect(decryptToken(apiKey, enc2)).toBe(plaintext);
        });

        it("should fail to decrypt with wrong key", () => {
            const encrypted = encryptToken("correct-key", "secret");
            expect(() => decryptToken("wrong-key", encrypted)).toThrow();
        });

        it("should handle empty string tokens", () => {
            const apiKey = "test-key";
            const encrypted = encryptToken(apiKey, "");
            expect(decryptToken(apiKey, encrypted)).toBe("");
        });

        it("should handle long tokens", () => {
            const apiKey = "test-key";
            const longToken = "x".repeat(10000);
            const encrypted = encryptToken(apiKey, longToken);
            expect(decryptToken(apiKey, encrypted)).toBe(longToken);
        });

        it("encrypted format should be JSON with s, i, t, c fields", () => {
            const encrypted = encryptToken("key", "value");
            const parsed = JSON.parse(encrypted);
            expect(parsed.s).toBeDefined(); // salt
            expect(parsed.i).toBeDefined(); // iv
            expect(parsed.t).toBeDefined(); // tag
            expect(parsed.c).toBeDefined(); // ciphertext
        });
    });

    describe("Access Token Cache", () => {
        it("should return null for uncached session", () => {
            expect(getCachedAccessToken("unknown-session")).toBeNull();
        });

        it("should cache and retrieve access token", () => {
            cacheAccessToken("session-1", "access-token-abc", 3600);
            expect(getCachedAccessToken("session-1")).toBe("access-token-abc");
        });

        it("should return null for expired tokens", () => {
            // Cache with 0 seconds expiry
            cacheAccessToken("session-2", "expired-token", 0);
            // Should return null because token is past expiry (including 5-min buffer)
            expect(getCachedAccessToken("session-2")).toBeNull();
        });

        it("clearTokenCache should remove all cached tokens", () => {
            cacheAccessToken("s1", "t1", 3600);
            cacheAccessToken("s2", "t2", 3600);
            expect(getCachedAccessToken("s1")).toBe("t1");

            clearTokenCache();
            expect(getCachedAccessToken("s1")).toBeNull();
            expect(getCachedAccessToken("s2")).toBeNull();
        });
    });

    describe("createAuthHeaders", () => {
        it("should create Bearer auth headers", () => {
            const headers = createAuthHeaders("my-token");
            expect(headers.Authorization).toBe("Bearer my-token");
            expect(headers["Content-Type"]).toBe("application/json");
        });
    });
});
