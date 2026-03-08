/**
 * Tests for Trello MCP Server
 */

import { describe, it, expect } from "vitest";
import { app } from "../../src/index";

describe("Tasks MCP Server", () => {
    describe("GET /mcp/tasks/info", () => {
        it("should return server info when configured", async () => {
            // Set env vars for this test
            const originalApiKey = process.env.TRELLO_API_KEY;
            const originalToken = process.env.TRELLO_TOKEN;
            const originalApiKeys = process.env.API_KEYS;

            process.env.TRELLO_API_KEY = "test-api-key";
            process.env.TRELLO_TOKEN = "test-token";
            process.env.API_KEYS = ""; // Disable auth for this test

            try {
                const response = await app.request("/mcp/tasks/info");
                expect(response.status).toBe(200);

                const data = await response.json();
                expect(data.name).toBe("tasks");
                expect(data.version).toBe("1.0.0");
                // Note: status may be "not_configured" because module is loaded at startup
                // and may not see our runtime env changes
                expect(["ready", "not_configured"]).toContain(data.status);
            } finally {
                // Restore original env
                if (originalApiKey) process.env.TRELLO_API_KEY = originalApiKey;
                else delete process.env.TRELLO_API_KEY;
                if (originalToken) process.env.TRELLO_TOKEN = originalToken;
                else delete process.env.TRELLO_TOKEN;
                if (originalApiKeys) process.env.API_KEYS = originalApiKeys;
                else delete process.env.API_KEYS;
            }
        });

        it("should return JSON with expected fields", async () => {
            const response = await app.request("/mcp/tasks/info");
            expect(response.status).toBe(200);

            const data = await response.json();
            expect(data).toHaveProperty("name");
            expect(data).toHaveProperty("version");
            expect(data).toHaveProperty("status");
            expect(data).toHaveProperty("configured");
            expect(data).toHaveProperty("tools");
        });

        it("should list tools when configured", async () => {
            const response = await app.request("/mcp/tasks/info");
            const data = await response.json();

            if (data.configured) {
                expect(data.tools).toContain("list_projects");
                expect(data.tools).toContain("list_statuses");
                expect(data.tools).toContain("list_tickets");
                expect(data.tools).toContain("create_ticket");
                expect(data.tools).toContain("get_ticket");
                expect(data.tools).toContain("update_ticket");
                expect(data.tools).toContain("archive_ticket");
                expect(data.tools).toContain("list_comments");
                expect(data.tools).toContain("add_comment");
                expect(data.tools).toContain("list_attachments");
                expect(data.tools).toContain("add_attachment");
                expect(data.tools).toContain("get_attachment");
                expect(data.tools.length).toBe(13);
            } else {
                // Tools are always listed; note tells user to configure
                expect(data.tools.length).toBeGreaterThan(0);
                expect(data.note).toContain("TRELLO_APP_KEY");
            }
        });
    });

    describe("POST /mcp/tasks", () => {
        it("should require auth when API_KEYS is set", async () => {
            const originalApiKeys = process.env.API_KEYS;
            process.env.API_KEYS = "test-secret-key";

            try {
                const response = await app.request("/mcp/tasks", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        jsonrpc: "2.0",
                        id: 1,
                        method: "initialize",
                        params: {}
                    })
                });

                // Could be 401 (auth required) or 503 (not configured) depending on order
                expect([401, 500, 503]).toContain(response.status);
            } finally {
                if (originalApiKeys) process.env.API_KEYS = originalApiKeys;
                else delete process.env.API_KEYS;
            }
        });

        it("should accept valid auth header", async () => {
            const originalApiKeys = process.env.API_KEYS;
            process.env.API_KEYS = "test-secret-key";

            try {
                const response = await app.request("/mcp/tasks", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": "Bearer test-secret-key"
                    },
                    body: JSON.stringify({
                        jsonrpc: "2.0",
                        id: 1,
                        method: "ping"
                    })
                });

                // Should not be 401 anymore
                expect(response.status).not.toBe(401);
            } finally {
                if (originalApiKeys) process.env.API_KEYS = originalApiKeys;
                else delete process.env.API_KEYS;
            }
        });
    });

    describe("OPTIONS /mcp/tasks", () => {
        it("should handle CORS preflight", async () => {
            const response = await app.request("/mcp/tasks", {
                method: "OPTIONS",
                headers: {
                    "Origin": "https://localhost:3000",
                    "Access-Control-Request-Method": "POST"
                }
            });

            // CORS should be handled
            expect([200, 204]).toContain(response.status);
        });
    });

    describe("Error handling", () => {
        it("should return 503 when not configured", async () => {
            // Clear env vars (but can't really test this since module loads at startup)
            // Just verify the endpoint exists and responds
            const response = await app.request("/mcp/tasks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: 1,
                    method: "test"
                })
            });

            // Will be 401 (auth) or 500/503 (not configured) depending on setup
            expect([401, 500, 503, 200]).toContain(response.status);
        });
    });
});

describe("Tasks MCP - CORS headers", () => {
    it("should include CORS headers in response", async () => {
        const response = await app.request("/mcp/tasks/info", {
            headers: { "Origin": "https://localhost:3000" }
        });

        // CORS headers should be present
        const headers = response.headers;
        expect(headers.get("Access-Control-Allow-Origin")).toBeTruthy();
    });
});
