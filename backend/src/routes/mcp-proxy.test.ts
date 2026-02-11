/**
 * MCP Proxy Route Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock config
const mockConfig = {
    mcpProxyAllowedDomains: [] as string[],
};

vi.mock("../config", () => ({
    getConfig: () => mockConfig,
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { Hono } from "hono";
import { mcpProxyRoutes } from "./mcp-proxy";

const app = new Hono();
app.route("/mcp-proxy", mcpProxyRoutes);

function makeRequest(body: unknown) {
    return app.request("/mcp-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

function mockFetchSuccess(responseBody = '{"result":"ok"}', headers: Record<string, string> = {}) {
    mockFetch.mockResolvedValueOnce(new Response(responseBody, {
        status: 200,
        headers: { "Content-Type": "application/json", ...headers },
    }));
}

describe("MCP Proxy - Header Forwarding", () => {
    beforeEach(() => {
        mockConfig.mcpProxyAllowedDomains = [];
        mockFetch.mockReset();
    });

    it("forwards allowed MCP headers (Authorization, Mcp-Session-Id)", async () => {
        mockFetchSuccess();

        await makeRequest({
            targetUrl: "https://mcp.example.com/api",
            body: { jsonrpc: "2.0", method: "test" },
            headers: {
                "Authorization": "Bearer mcp-server-token",
                "Mcp-Session-Id": "session-123",
            },
        });

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [, options] = mockFetch.mock.calls[0];
        expect(options.headers["Authorization"]).toBe("Bearer mcp-server-token");
        expect(options.headers["Mcp-Session-Id"]).toBe("session-123");
    });

    it("blocks dangerous headers like Cookie", async () => {
        mockFetchSuccess();

        await makeRequest({
            targetUrl: "https://mcp.example.com/api",
            body: { jsonrpc: "2.0", method: "test" },
            headers: {
                "Cookie": "session=stolen",
                "Authorization": "Bearer valid-token",
            },
        });

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [, options] = mockFetch.mock.calls[0];
        expect(options.headers["Cookie"]).toBeUndefined();
        expect(options.headers["Authorization"]).toBe("Bearer valid-token");
    });

    it("blocks X-Forwarded-For header", async () => {
        mockFetchSuccess();

        await makeRequest({
            targetUrl: "https://mcp.example.com/api",
            body: { jsonrpc: "2.0", method: "test" },
            headers: {
                "X-Forwarded-For": "192.168.1.1",
            },
        });

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [, options] = mockFetch.mock.calls[0];
        expect(options.headers["X-Forwarded-For"]).toBeUndefined();
    });

    it("blocks Host and Connection headers", async () => {
        mockFetchSuccess();

        await makeRequest({
            targetUrl: "https://mcp.example.com/api",
            body: { jsonrpc: "2.0", method: "test" },
            headers: {
                "Host": "evil.com",
                "Connection": "keep-alive",
            },
        });

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [, options] = mockFetch.mock.calls[0];
        expect(options.headers["Host"]).toBeUndefined();
        expect(options.headers["Connection"]).toBeUndefined();
    });

    it("always sets default MCP headers regardless of custom headers", async () => {
        mockFetchSuccess();

        await makeRequest({
            targetUrl: "https://mcp.example.com/api",
            body: { jsonrpc: "2.0", method: "test" },
            headers: {},
        });

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [, options] = mockFetch.mock.calls[0];
        expect(options.headers["Content-Type"]).toBe("application/json");
        expect(options.headers["Accept"]).toBe("application/json, text/event-stream");
        expect(options.headers["MCP-Protocol-Version"]).toBe("2024-11-05");
    });
});

describe("MCP Proxy - URL Validation", () => {
    beforeEach(() => {
        mockConfig.mcpProxyAllowedDomains = [];
        mockFetch.mockReset();
    });

    it("rejects non-HTTPS URLs", async () => {
        const res = await makeRequest({
            targetUrl: "http://mcp.example.com/api",
            body: { jsonrpc: "2.0" },
        });
        expect(res.status).toBe(400);
        const json = await res.json() as { error: string };
        expect(json.error).toContain("HTTPS");
    });

    it("rejects requests without targetUrl", async () => {
        const res = await makeRequest({ body: { jsonrpc: "2.0" } });
        expect(res.status).toBe(400);
    });

    it("enforces domain allowlist when configured", async () => {
        mockConfig.mcpProxyAllowedDomains = ["allowed.com"];

        const res = await makeRequest({
            targetUrl: "https://blocked.com/api",
            body: { jsonrpc: "2.0" },
        });
        expect(res.status).toBe(403);
    });

    it("allows subdomains of allowed domains", async () => {
        mockConfig.mcpProxyAllowedDomains = ["example.com"];
        mockFetchSuccess();

        const res = await makeRequest({
            targetUrl: "https://mcp.example.com/api",
            body: { jsonrpc: "2.0" },
        });
        expect(res.status).toBe(200);
    });
});

describe("MCP Proxy - Response Forwarding", () => {
    beforeEach(() => {
        mockConfig.mcpProxyAllowedDomains = [];
        mockFetch.mockReset();
    });

    it("forwards Mcp-Session-Id from response", async () => {
        mockFetchSuccess('{"result":"ok"}', { "Mcp-Session-Id": "new-session" });

        const res = await makeRequest({
            targetUrl: "https://mcp.example.com/api",
            body: { jsonrpc: "2.0" },
        });

        expect(res.headers.get("Mcp-Session-Id")).toBe("new-session");
    });

    it("returns 502 on fetch failure", async () => {
        mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

        const res = await makeRequest({
            targetUrl: "https://mcp.example.com/api",
            body: { jsonrpc: "2.0" },
        });
        expect(res.status).toBe(502);
        const json = await res.json() as { error: string };
        expect(json.error).toContain("Connection refused");
    });
});
