import { describe, it, expect } from "vitest";
import { getMcpMethod, isDiscoveryMethod } from "./mcp-lazy-auth";

describe("mcp-lazy-auth", () => {
    describe("isDiscoveryMethod", () => {
        it("should return true for initialize", () => {
            expect(isDiscoveryMethod("initialize")).toBe(true);
        });

        it("should return true for tools/list", () => {
            expect(isDiscoveryMethod("tools/list")).toBe(true);
        });

        it("should return true for notifications/initialized", () => {
            expect(isDiscoveryMethod("notifications/initialized")).toBe(true);
        });

        it("should return false for tools/call", () => {
            expect(isDiscoveryMethod("tools/call")).toBe(false);
        });

        it("should return false for resources/list", () => {
            expect(isDiscoveryMethod("resources/list")).toBe(false);
        });

        it("should return false for null", () => {
            expect(isDiscoveryMethod(null)).toBe(false);
        });

        it("should return false for undefined", () => {
            expect(isDiscoveryMethod(undefined)).toBe(false);
        });

        it("should return false for empty string", () => {
            expect(isDiscoveryMethod("")).toBe(false);
        });
    });

    describe("getMcpMethod", () => {
        function createMockReq(method: string, body?: unknown) {
            const raw = new Request("http://localhost/mcp/test", {
                method,
                headers: { "Content-Type": "application/json" },
                body: body !== undefined ? JSON.stringify(body) : undefined,
            });
            return { method, raw };
        }

        it("should extract method from JSON-RPC POST body", async () => {
            const req = createMockReq("POST", {
                jsonrpc: "2.0",
                method: "tools/list",
                id: 1,
            });
            expect(await getMcpMethod(req)).toBe("tools/list");
        });

        it("should extract initialize method", async () => {
            const req = createMockReq("POST", {
                jsonrpc: "2.0",
                method: "initialize",
                id: 1,
            });
            expect(await getMcpMethod(req)).toBe("initialize");
        });

        it("should extract tools/call method", async () => {
            const req = createMockReq("POST", {
                jsonrpc: "2.0",
                method: "tools/call",
                id: 1,
                params: { name: "test_tool", arguments: {} },
            });
            expect(await getMcpMethod(req)).toBe("tools/call");
        });

        it("should return null for GET requests", async () => {
            const req = createMockReq("GET");
            expect(await getMcpMethod(req)).toBeNull();
        });

        it("should return null for DELETE requests", async () => {
            const req = createMockReq("DELETE");
            expect(await getMcpMethod(req)).toBeNull();
        });

        it("should return null for invalid JSON body", async () => {
            const raw = new Request("http://localhost/mcp/test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "not-json",
            });
            expect(await getMcpMethod({ method: "POST", raw })).toBeNull();
        });

        it("should return null for missing method field", async () => {
            const req = createMockReq("POST", { jsonrpc: "2.0", id: 1 });
            expect(await getMcpMethod(req)).toBeNull();
        });

        it("should return null for non-string method field", async () => {
            const req = createMockReq("POST", {
                jsonrpc: "2.0",
                method: 42,
                id: 1,
            });
            expect(await getMcpMethod(req)).toBeNull();
        });

        it("should not consume the original request body", async () => {
            const req = createMockReq("POST", {
                jsonrpc: "2.0",
                method: "tools/list",
                id: 1,
            });
            // First call to getMcpMethod
            await getMcpMethod(req);
            // Original body should still be readable
            const body = await req.raw.json();
            expect(body).toHaveProperty("method", "tools/list");
        });
    });
});
