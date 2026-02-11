/**
 * Auth Middleware Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock config before importing auth
const mockConfig = {
    apiKeys: [] as string[],
};

vi.mock("../config", () => ({
    getConfig: () => mockConfig,
}));

import { validateApiKey, authMiddleware } from "./auth";

// Helper to create a minimal Hono Context mock
function createMockContext(authHeader?: string) {
    return {
        req: {
            header: (name: string) => {
                if (name === "Authorization") return authHeader || "";
                return "";
            },
        },
        json: vi.fn().mockReturnValue(new Response()),
    } as unknown as Parameters<typeof validateApiKey>[0];
}

describe("validateApiKey", () => {
    beforeEach(() => {
        mockConfig.apiKeys = [];
    });

    it("allows all requests when no API keys are configured (open mode)", () => {
        const c = createMockContext();
        expect(validateApiKey(c)).toBe(true);
    });

    it("rejects requests without Authorization header", () => {
        mockConfig.apiKeys = ["test-key-123"];
        const c = createMockContext();
        expect(validateApiKey(c)).toBe(false);
    });

    it("rejects requests with invalid Authorization format", () => {
        mockConfig.apiKeys = ["test-key-123"];
        const c = createMockContext("Basic dXNlcjpwYXNz");
        expect(validateApiKey(c)).toBe(false);
    });

    it("rejects requests with wrong API key", () => {
        mockConfig.apiKeys = ["correct-key"];
        const c = createMockContext("Bearer wrong-key");
        expect(validateApiKey(c)).toBe(false);
    });

    it("accepts requests with valid API key", () => {
        mockConfig.apiKeys = ["valid-key-abc"];
        const c = createMockContext("Bearer valid-key-abc");
        expect(validateApiKey(c)).toBe(true);
    });

    it("accepts requests matching any configured key", () => {
        mockConfig.apiKeys = ["key-1", "key-2", "key-3"];
        const c = createMockContext("Bearer key-2");
        expect(validateApiKey(c)).toBe(true);
    });

    it("is case-insensitive for Bearer prefix", () => {
        mockConfig.apiKeys = ["my-key"];
        const c = createMockContext("bearer my-key");
        expect(validateApiKey(c)).toBe(true);
    });

    it("rejects partial key matches (key must match exactly)", () => {
        mockConfig.apiKeys = ["full-key-value"];
        const c = createMockContext("Bearer full-key");
        expect(validateApiKey(c)).toBe(false);
    });

    it("rejects keys that contain the correct key as substring", () => {
        mockConfig.apiKeys = ["secret"];
        const c = createMockContext("Bearer secret-extra");
        expect(validateApiKey(c)).toBe(false);
    });
});

describe("authMiddleware", () => {
    beforeEach(() => {
        mockConfig.apiKeys = [];
    });

    it("calls next() when auth is valid", async () => {
        const c = createMockContext();
        const next = vi.fn();
        await authMiddleware(c as any, next);
        expect(next).toHaveBeenCalled();
    });

    it("returns 401 when auth is invalid", async () => {
        mockConfig.apiKeys = ["required-key"];
        const c = createMockContext();
        const next = vi.fn();
        await authMiddleware(c as any, next);
        expect(next).not.toHaveBeenCalled();
        expect(c.json).toHaveBeenCalledWith(
            { error: "Invalid or missing API key" },
            401
        );
    });
});
