/**
 * Integration Tests for MCP Proxy API
 */

import { describe, it, expect } from "vitest";
import { app } from "../../src/index";

describe("MCP Proxy API", () => {
    describe("POST /mcp-proxy", () => {
        it("should reject missing targetUrl", async () => {
            const res = await app.request("/mcp-proxy", {
                method: "POST",
                body: JSON.stringify({ body: {} }),
                headers: { "Content-Type": "application/json" },
            });
            expect(res.status).toBe(400);
        });

        // Note: body is defined as z.unknown() so missing body is allowed at schema level
        // The actual request would fail when forwarding to MCP server

        it("should reject non-HTTPS URLs", async () => {
            const res = await app.request("/mcp-proxy", {
                method: "POST",
                body: JSON.stringify({
                    targetUrl: "http://example.com",
                    body: {},
                }),
                headers: { "Content-Type": "application/json" },
            });
            expect(res.status).toBe(400);

            const json = await res.json() as { error: string };
            expect(json.error).toContain("HTTPS");
        });

        it("should reject invalid URLs", async () => {
            const res = await app.request("/mcp-proxy", {
                method: "POST",
                body: JSON.stringify({
                    targetUrl: "not-a-url",
                    body: {},
                }),
                headers: { "Content-Type": "application/json" },
            });
            expect(res.status).toBe(400);
        });

        // Note: Actual proxy forwarding tests require mock MCP server
        // or are run against a test MCP endpoint
    });

    describe("Other methods", () => {
        it("should reject GET requests", async () => {
            const res = await app.request("/mcp-proxy");
            expect(res.status).toBe(404);
        });
    });
});
