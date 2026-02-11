import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { mcpDirectoryRoutes, MCP_SERVERS } from "./mcp-directory";

// Test the route in isolation (no middleware overhead)
const app = new Hono();
app.route("/mcp-directory", mcpDirectoryRoutes);

describe("MCP Directory", () => {
    it("should return the server list", async () => {
        const res = await app.request("/mcp-directory");

        expect(res.status).toBe(200);
        const body = await res.json() as { servers: typeof MCP_SERVERS };

        expect(body).toHaveProperty("servers");
        expect(Array.isArray(body.servers)).toBe(true);
        expect(body.servers).toHaveLength(MCP_SERVERS.length);
    });

    it("should include all known MCP servers", async () => {
        const res = await app.request("/mcp-directory");
        const body = await res.json() as { servers: typeof MCP_SERVERS };
        const serverNames = body.servers.map((s) => s.name);

        expect(serverNames).toContain("tasks");
        expect(serverNames).toContain("weather");
        expect(serverNames).toContain("cv-database");
        expect(serverNames).toContain("knowledge-base");
        expect(serverNames).toContain("document-media");
        expect(serverNames).toContain("github");
        expect(serverNames).toContain("image-generation");
    });

    it("should have valid fields for every server entry", async () => {
        const res = await app.request("/mcp-directory");
        const body = await res.json() as { servers: typeof MCP_SERVERS };

        for (const server of body.servers) {
            expect(server.name).toBeTruthy();
            expect(server.title).toBeTruthy();
            expect(server.endpoint).toMatch(/^\/mcp\//);
            expect(server.description).toBeTruthy();
        }
    });

    it("should only respond to GET requests", async () => {
        const post = await app.request("/mcp-directory", { method: "POST" });
        expect(post.status).toBe(404);

        const put = await app.request("/mcp-directory", { method: "PUT" });
        expect(put.status).toBe(404);
    });

    it("should export MCP_SERVERS for reuse", () => {
        expect(Array.isArray(MCP_SERVERS)).toBe(true);
        expect(MCP_SERVERS.length).toBe(7);
    });
});
