/**
 * CORS Middleware Tests
 */

import { describe, it, expect, vi } from "vitest";

const mockConfig = {
    corsOrigin: "*",
};

vi.mock("../config", () => ({
    getConfig: () => mockConfig,
}));

import { createCorsMiddleware } from "./cors";

describe("createCorsMiddleware", () => {
    it("returns a middleware handler", () => {
        const middleware = createCorsMiddleware();
        expect(typeof middleware).toBe("function");
    });

    it("includes DELETE in allowed methods", async () => {
        const middleware = createCorsMiddleware();

        // Create a minimal Hono-style context for a preflight request
        const headers = new Headers();
        const responseHeaders = new Headers();
        const c = {
            req: {
                raw: new Request("https://api.example.com/test", {
                    method: "OPTIONS",
                    headers: {
                        Origin: "https://example.com",
                        "Access-Control-Request-Method": "DELETE",
                    },
                }),
                header: (name: string) => {
                    if (name === "Origin" || name === "origin") return "https://example.com";
                    if (name === "Access-Control-Request-Method" || name === "access-control-request-method") return "DELETE";
                    return headers.get(name) || undefined;
                },
                method: "OPTIONS",
                valid: () => ({}),
            },
            res: {
                headers: responseHeaders,
            },
            header: (name: string, value: string) => {
                responseHeaders.set(name, value);
            },
            newResponse: (body: null, status: number) => {
                const resp = new Response(body, { status, headers: responseHeaders });
                return resp;
            },
        } as any;

        const next = vi.fn().mockResolvedValue(undefined);
        await middleware(c, next);

        const allowMethods = responseHeaders.get("Access-Control-Allow-Methods");
        expect(allowMethods).toContain("DELETE");
        expect(allowMethods).toContain("GET");
        expect(allowMethods).toContain("PUT");
        expect(allowMethods).toContain("POST");
    });
});
