/**
 * Tests for http-request.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { httpRequestTool } from "./http-request";

describe("httpRequestTool", () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        global.fetch = originalFetch;
    });

    describe("metadata", () => {
        it("should have correct name", () => {
            expect(httpRequestTool.name).toBe("http_request");
        });

        it("should be enabled by default", () => {
            expect(httpRequestTool.enabledByDefault).toBe(true);
        });

        it("should have default config", () => {
            expect(httpRequestTool.defaultConfig).toEqual({
                timeout: 10000,
                maxResponseSize: 100000,
            });
        });

        it("should have required url parameter", () => {
            expect(httpRequestTool.schema.parameters.required).toContain("url");
        });
    });

    describe("execute - validation", () => {
        it("should reject invalid URL", async () => {
            const result = await httpRequestTool.execute(
                { url: "not-a-valid-url" },
                httpRequestTool.defaultConfig
            );
            expect(result.success).toBe(false);
            expect(result.error).toBe("Invalid URL");
        });

        it("should reject non-http/https URLs", async () => {
            const result = await httpRequestTool.execute(
                { url: "ftp://example.com" },
                httpRequestTool.defaultConfig
            );
            expect(result.success).toBe(false);
            expect(result.error).toBe("Only HTTP and HTTPS URLs allowed");
        });

        it.each([
            ["http://localhost/admin", "localhost"],
            ["http://127.0.0.1/", "127.x loopback"],
            ["http://127.0.0.99/", "127.x loopback variant"],
            ["http://10.0.0.1/", "10.x private"],
            ["http://172.16.0.1/", "172.16.x private"],
            ["http://172.31.255.255/", "172.31.x private"],
            ["http://192.168.1.1/", "192.168.x private"],
            ["http://169.254.169.254/latest/meta-data/", "cloud metadata"],
            ["http://0.0.0.0/", "0.x reserved"],
            ["http://[::1]/", "IPv6 loopback"],
        ])("should block SSRF: %s (%s)", async (url) => {
            const result = await httpRequestTool.execute(
                { url },
                httpRequestTool.defaultConfig
            );
            expect(result.success).toBe(false);
            expect(result.error).toContain("private or reserved");
        });

        it("should allow public IP addresses", async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                statusText: "OK",
                headers: new Headers(),
                text: () => Promise.resolve("ok"),
            });
            global.fetch = mockFetch;

            const result = await httpRequestTool.execute(
                { url: "http://8.8.8.8/dns" },
                httpRequestTool.defaultConfig
            );
            expect(result.success).toBe(true);
        });

        it("should allow 172.x outside private range", async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                statusText: "OK",
                headers: new Headers(),
                text: () => Promise.resolve("ok"),
            });
            global.fetch = mockFetch;

            const result = await httpRequestTool.execute(
                { url: "http://172.32.0.1/" },
                httpRequestTool.defaultConfig
            );
            expect(result.success).toBe(true);
        });
    });

    describe("execute - successful requests", () => {
        it("should make GET request by default", async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                statusText: "OK",
                headers: new Headers({ "content-type": "application/json" }),
                text: () => Promise.resolve('{"data": "test"}'),
            });
            global.fetch = mockFetch;

            const result = await httpRequestTool.execute(
                { url: "https://api.example.com/data" },
                httpRequestTool.defaultConfig
            );

            expect(mockFetch).toHaveBeenCalledWith(
                "https://api.example.com/data",
                expect.objectContaining({ method: "GET" })
            );
            expect(result.success).toBe(true);
            expect(result.data).toEqual({
                status: 200,
                statusText: "OK",
                headers: { "content-type": "application/json" },
                body: '{"data": "test"}',
                truncated: false,
            });
        });

        it("should make POST request with body", async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 201,
                statusText: "Created",
                headers: new Headers(),
                text: () => Promise.resolve("created"),
            });
            global.fetch = mockFetch;

            const result = await httpRequestTool.execute(
                {
                    url: "https://api.example.com/data",
                    method: "POST",
                    body: '{"name": "test"}',
                    headers: { "Content-Type": "application/json" }
                },
                httpRequestTool.defaultConfig
            );

            expect(mockFetch).toHaveBeenCalledWith(
                "https://api.example.com/data",
                expect.objectContaining({
                    method: "POST",
                    body: '{"name": "test"}',
                    headers: { "Content-Type": "application/json" }
                })
            );
            expect(result.success).toBe(true);
        });

        it("should truncate large responses", async () => {
            const largeBody = "x".repeat(150000);
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                statusText: "OK",
                headers: new Headers(),
                text: () => Promise.resolve(largeBody),
            });
            global.fetch = mockFetch;

            const result = await httpRequestTool.execute(
                { url: "https://api.example.com/large" },
                { ...httpRequestTool.defaultConfig, maxResponseSize: 100 }
            );

            expect(result.success).toBe(true);
            expect(result.data?.truncated).toBe(true);
            expect(result.data?.body).toHaveLength(100 + "... [truncated]".length);
        });
    });

    describe("execute - error handling", () => {
        it("should handle network errors", async () => {
            global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

            const result = await httpRequestTool.execute(
                { url: "https://api.example.com/data" },
                httpRequestTool.defaultConfig
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe("Network error");
        });

        it("should return error for 4xx status codes", async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 404,
                statusText: "Not Found",
                headers: new Headers(),
                text: () => Promise.resolve("Resource not found"),
            });
            global.fetch = mockFetch;

            const result = await httpRequestTool.execute(
                { url: "https://api.example.com/missing" },
                httpRequestTool.defaultConfig
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("HTTP 404 Not Found");
            expect(result.error).toContain("Resource not found");
            expect(result.data?.status).toBe(404);
            expect(result.data?.body).toBe("Resource not found");
        });

        it("should return error for 5xx status codes", async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 500,
                statusText: "Internal Server Error",
                headers: new Headers(),
                text: () => Promise.resolve("Server error"),
            });
            global.fetch = mockFetch;

            const result = await httpRequestTool.execute(
                { url: "https://api.example.com/error" },
                httpRequestTool.defaultConfig
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("HTTP 500 Internal Server Error");
            expect(result.error).toContain("Server error");
            expect(result.data?.status).toBe(500);
        });
    });
});
