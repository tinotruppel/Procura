/**
 * Integration Tests for Gmail and Google Calendar MCP route handlers
 *
 * Tests the well-known endpoints and error handling for these MCP servers.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { clearAll } from "../helpers/db-mock";

vi.mock("../../src/db/connection", async () => {
    return await import("../helpers/db-mock");
});

import { app } from "../../src/index";

describe("Gmail MCP Routes", () => {
    beforeEach(() => {
        clearAll();
    });

    describe("GET /mcp/gmail/.well-known/oauth-protected-resource", () => {
        it("should return OAuth resource metadata", async () => {
            const res = await app.request("/mcp/gmail/.well-known/oauth-protected-resource");
            expect(res.status).toBe(200);
            const data = await res.json() as Record<string, unknown>;
            expect(data.resource).toBeDefined();
            expect(typeof data.resource).toBe("string");
            expect(data.authorization_servers).toBeDefined();
            expect(Array.isArray(data.authorization_servers)).toBe(true);
        });
    });

    describe("POST /mcp/gmail", () => {
        it("should reject without valid session", async () => {
            const res = await app.request("/mcp/gmail", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Api-Key": process.env.API_KEYS || "test",
                },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    method: "tools/call",
                    params: { name: "search_emails", arguments: { query: "test" } },
                    id: 1,
                }),
            });
            expect([401, 500, 503]).toContain(res.status);
        });
    });
});

describe("Google Calendar MCP Routes", () => {
    beforeEach(() => {
        clearAll();
    });

    describe("GET /mcp/google-calendar/.well-known/oauth-protected-resource", () => {
        it("should return OAuth resource metadata", async () => {
            const res = await app.request("/mcp/google-calendar/.well-known/oauth-protected-resource");
            expect(res.status).toBe(200);
            const data = await res.json() as Record<string, unknown>;
            expect(data.resource).toBeDefined();
            expect(typeof data.resource).toBe("string");
            expect(data.authorization_servers).toBeDefined();
        });
    });

    describe("POST /mcp/google-calendar", () => {
        it("should reject without valid session", async () => {
            const res = await app.request("/mcp/google-calendar", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Api-Key": process.env.API_KEYS || "test",
                },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    method: "tools/call",
                    params: { name: "list_events", arguments: {} },
                    id: 1,
                }),
            });
            expect([401, 500, 503]).toContain(res.status);
        });
    });
});

describe("Google Sheets MCP Routes", () => {
    describe("GET /mcp/google-sheets/.well-known/oauth-protected-resource", () => {
        it("should return OAuth resource metadata", async () => {
            const res = await app.request("/mcp/google-sheets/.well-known/oauth-protected-resource");
            expect(res.status).toBe(200);
            const data = await res.json() as Record<string, unknown>;
            expect(data.resource).toBeDefined();
        });
    });
});

describe("Google Slides MCP Routes", () => {
    describe("GET /mcp/google-slides/.well-known/oauth-protected-resource", () => {
        it("should return OAuth resource metadata", async () => {
            const res = await app.request("/mcp/google-slides/.well-known/oauth-protected-resource");
            expect(res.status).toBe(200);
            const data = await res.json() as Record<string, unknown>;
            expect(data.resource).toBeDefined();
        });
    });
});

describe("Google Docs MCP Routes", () => {
    describe("GET /mcp/google-docs/.well-known/oauth-protected-resource", () => {
        it("should return OAuth resource metadata", async () => {
            const res = await app.request("/mcp/google-docs/.well-known/oauth-protected-resource");
            expect(res.status).toBe(200);
            const data = await res.json() as Record<string, unknown>;
            expect(data.resource).toBeDefined();
        });
    });
});
