/**
 * Unit Tests for Google Auth Module
 *
 * Tests the Google-specific configuration functions and
 * RFC9728 discovery helpers.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { clearAll, initPool } from "../helpers/db-mock";

vi.mock("../../src/db/connection", async () => {
    return await import("../helpers/db-mock");
});

// Mock vault-resolver
vi.mock("../../src/lib/vault-resolver", () => ({
    resolveSecret: vi.fn().mockImplementation(async (key: string) => {
        const secrets: Record<string, string> = {
            GOOGLE_CLIENT_ID: "test-client-id",
            GOOGLE_CLIENT_SECRET: "test-client-secret",
        };
        return secrets[key] || process.env[key] || "";
    }),
}));

import {
    isGoogleConfiguredAsync,
    getGoogleClientIdAsync,
    getGoogleClientSecretAsync,
    buildGoogleWwwAuthenticate,
    buildGoogleResourceMetadata,
} from "../../src/lib/google-auth";

describe("Google Auth Module", () => {
    beforeEach(() => {
        clearAll();
        initPool();
        vi.clearAllMocks();
    });

    describe("Configuration", () => {
        it("isGoogleConfiguredAsync should return true when configured", async () => {
            expect(await isGoogleConfiguredAsync("api-key")).toBe(true);
        });

        it("getGoogleClientIdAsync should return client ID", async () => {
            expect(await getGoogleClientIdAsync("api-key")).toBe("test-client-id");
        });

        it("getGoogleClientSecretAsync should return client secret", async () => {
            expect(await getGoogleClientSecretAsync("api-key")).toBe("test-client-secret");
        });
    });

    describe("RFC9728 Discovery Helpers", () => {
        const createMockContext = (url: string, headers: Record<string, string> = {}) => ({
            req: {
                url,
                header: (name: string) => headers[name],
            },
        });

        it("buildGoogleWwwAuthenticate should include resource_metadata URL", () => {
            const ctx = createMockContext("http://localhost:3001/mcp/gmail");
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = buildGoogleWwwAuthenticate(ctx as any, "/mcp/gmail");
            expect(result).toContain("Bearer");
            expect(result).toContain("scope=\"google\"");
            expect(result).toContain("resource_metadata=");
            expect(result).toContain("/mcp/gmail/.well-known/oauth-protected-resource");
        });

        it("buildGoogleResourceMetadata should return proper structure", () => {
            const ctx = createMockContext("http://localhost:3001/mcp/gmail");
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = buildGoogleResourceMetadata(ctx as any, "/mcp/gmail") as {
                resource: string;
                authorization_servers: string[];
                scopes_supported: string[];
            };
            expect(result.resource).toContain("/mcp/gmail");
            expect(result.authorization_servers).toHaveLength(1);
            expect(result.authorization_servers[0]).toContain("/google");
            expect(result.scopes_supported).toEqual(["google"]);
        });

        it("should use https for non-localhost", () => {
            const ctx = createMockContext(
                "https://api.example.com/mcp/gmail",
                { "X-Forwarded-Proto": "https" }
            );
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = buildGoogleResourceMetadata(ctx as any, "/mcp/gmail") as {
                resource: string;
            };
            expect(result.resource).toContain("https://");
        });

        it("should use http for localhost", () => {
            const ctx = createMockContext("http://localhost:3001/mcp/gmail");
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = buildGoogleResourceMetadata(ctx as any, "/mcp/gmail") as {
                resource: string;
            };
            expect(result.resource).toContain("http://localhost");
        });
    });
});
