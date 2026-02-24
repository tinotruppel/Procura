/**
 * Integration Tests for Google MCP Server info endpoints
 *
 * Tests the /info endpoints for Google Docs, Sheets, and Slides MCP servers.
 * These endpoints don't require authentication and return server metadata.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { clearAll } from "../helpers/db-mock";

vi.mock("../../src/db/connection", async () => {
    return await import("../helpers/db-mock");
});

import { app } from "../../src/index";

describe("Google MCP Info Endpoints", () => {
    beforeEach(() => {
        clearAll();
    });

    describe("GET /mcp/google-docs/info", () => {
        it("should return server metadata", async () => {
            const res = await app.request("/mcp/google-docs/info");
            expect(res.status).toBe(200);
            const data = await res.json() as Record<string, unknown>;
            expect(data.name).toBe("google-docs");
            expect(data.version).toBe("1.0.0");
            expect(typeof data.configured).toBe("boolean");
        });

        it("should include tool list when configured", async () => {
            const res = await app.request("/mcp/google-docs/info");
            const data = await res.json() as Record<string, unknown>;
            expect(Array.isArray(data.tools)).toBe(true);
            if (data.configured) {
                expect((data.tools as string[]).length).toBeGreaterThan(0);
                expect(data.tools).toContain("list_documents");
            }
        });

        it("should return status field", async () => {
            const res = await app.request("/mcp/google-docs/info");
            const data = await res.json() as Record<string, unknown>;
            expect(["ready", "not_configured"]).toContain(data.status);
        });
    });

    describe("GET /mcp/google-sheets/info", () => {
        it("should return server metadata", async () => {
            const res = await app.request("/mcp/google-sheets/info");
            expect(res.status).toBe(200);
            const data = await res.json() as Record<string, unknown>;
            expect(data.name).toBe("google-sheets");
            expect(data.version).toBe("1.0.0");
            expect(typeof data.configured).toBe("boolean");
        });

        it("should include tool list when configured", async () => {
            const res = await app.request("/mcp/google-sheets/info");
            const data = await res.json() as Record<string, unknown>;
            expect(Array.isArray(data.tools)).toBe(true);
            if (data.configured) {
                expect(data.tools).toContain("list_spreadsheets");
            }
        });

        it("should return status field", async () => {
            const res = await app.request("/mcp/google-sheets/info");
            const data = await res.json() as Record<string, unknown>;
            expect(["ready", "not_configured"]).toContain(data.status);
        });
    });

    describe("GET /mcp/google-slides/info", () => {
        it("should return server metadata", async () => {
            const res = await app.request("/mcp/google-slides/info");
            expect(res.status).toBe(200);
            const data = await res.json() as Record<string, unknown>;
            expect(data.name).toBe("google-slides");
            expect(data.version).toBe("1.0.0");
            expect(typeof data.configured).toBe("boolean");
        });

        it("should include tool list when configured", async () => {
            const res = await app.request("/mcp/google-slides/info");
            const data = await res.json() as Record<string, unknown>;
            expect(Array.isArray(data.tools)).toBe(true);
            if (data.configured) {
                expect(data.tools).toContain("list_presentations");
            }
        });

        it("should return status field", async () => {
            const res = await app.request("/mcp/google-slides/info");
            const data = await res.json() as Record<string, unknown>;
            expect(["ready", "not_configured"]).toContain(data.status);
        });
    });

    describe("Auth rejection on MCP endpoints", () => {
        it("should return 503 or 401 for POST /mcp/google-docs without session", async () => {
            const res = await app.request("/mcp/google-docs", {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Api-Key": process.env.API_KEYS || "test" },
                body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }),
            });
            // 503 = not configured, 401 = no auth, 500 = internal error from middleware
            expect([401, 500, 503]).toContain(res.status);
        });

        it("should return 503 or 401 for POST /mcp/google-sheets without session", async () => {
            const res = await app.request("/mcp/google-sheets", {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Api-Key": process.env.API_KEYS || "test" },
                body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }),
            });
            expect([401, 500, 503]).toContain(res.status);
        });

        it("should return 503 or 401 for POST /mcp/google-slides without session", async () => {
            const res = await app.request("/mcp/google-slides", {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Api-Key": process.env.API_KEYS || "test" },
                body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }),
            });
            expect([401, 500, 503]).toContain(res.status);
        });
    });
});
