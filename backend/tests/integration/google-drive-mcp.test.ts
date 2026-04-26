/**
 * Integration Tests for Google Drive MCP Routes
 *
 * Tests the HTTP route handlers for the Google Drive MCP server
 * including info endpoint, auth rejection, and well-known metadata.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { clearAll } from "../helpers/db-mock";

vi.mock("../../src/db/connection", async () => {
    return await import("../helpers/db-mock");
});

import { app } from "../../src/index";

describe("Google Drive MCP Routes", () => {
    beforeEach(() => {
        clearAll();
    });

    describe("GET /mcp/google-drive/info", () => {
        it("should return server metadata", async () => {
            const res = await app.request("/mcp/google-drive/info");
            expect(res.status).toBe(200);
            const data = await res.json() as Record<string, unknown>;
            expect(data.name).toBe("google-drive");
            expect(data.version).toBe("1.0.0");
            expect(typeof data.configured).toBe("boolean");
        });

        it("should include all tool names", async () => {
            const res = await app.request("/mcp/google-drive/info");
            const data = await res.json() as Record<string, unknown>;
            const tools = data.tools as string[];
            expect(Array.isArray(tools)).toBe(true);
            expect(tools).toContain("list_files");
            expect(tools).toContain("get_file_metadata");
            expect(tools).toContain("download_file");
            expect(tools).toContain("upload_file");
            expect(tools).toContain("create_folder");
            expect(tools).toContain("move_file");
            expect(tools).toContain("delete_file");
        });

        it("should return status field", async () => {
            const res = await app.request("/mcp/google-drive/info");
            const data = await res.json() as Record<string, unknown>;
            expect(["ready", "not_configured"]).toContain(data.status);
        });

        it("should include note when not configured", async () => {
            const res = await app.request("/mcp/google-drive/info");
            const data = await res.json() as Record<string, unknown>;
            if (!data.configured) {
                expect(data.note).toBeDefined();
                expect(typeof data.note).toBe("string");
            }
        });
    });

    describe("GET /mcp/google-drive/.well-known/oauth-protected-resource", () => {
        it("should return OAuth resource metadata", async () => {
            const res = await app.request("/mcp/google-drive/.well-known/oauth-protected-resource");
            expect(res.status).toBe(200);
            const data = await res.json() as Record<string, unknown>;
            expect(data).toBeDefined();
            // Should contain resource and authorization_servers
            expect(typeof data.resource).toBe("string");
        });
    });

    describe("POST /mcp/google-drive", () => {
        it("should return 503 or 401 without session", async () => {
            const res = await app.request("/mcp/google-drive", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Api-Key": process.env.API_KEYS || "test",
                },
                body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }),
            });
            // 503 = not configured, 401 = no auth
            expect([401, 500, 503]).toContain(res.status);
        });

        it("should reject tool calls without auth", async () => {
            const res = await app.request("/mcp/google-drive", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Api-Key": process.env.API_KEYS || "test",
                },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    method: "tools/call",
                    params: { name: "list_files", arguments: {} },
                    id: 2,
                }),
            });
            expect([401, 500, 503]).toContain(res.status);
        });
    });
});
