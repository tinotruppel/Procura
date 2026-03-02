/**
 * Integration Tests for Google OAuth Authorization Server
 *
 * Tests RFC8414 metadata, dynamic client registration (RFC7591),
 * PKCE authorization flow, and token exchange endpoints.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { clearAll } from "../helpers/db-mock";

// Mock DB for google-auth.ts token storage
vi.mock("../../src/db/connection", async () => {
    return await import("../helpers/db-mock");
});

import { app } from "../../src/index";

describe("Google OAuth Authorization Server", () => {
    beforeEach(() => {
        clearAll();
    });

    // =========================================================================
    // RFC8414 Authorization Server Metadata
    // =========================================================================

    describe("GET /google/.well-known/oauth-authorization-server", () => {
        it("should return metadata with all required fields", async () => {
            const res = await app.request("/google/.well-known/oauth-authorization-server");
            expect(res.status).toBe(200);

            const meta = await res.json() as Record<string, unknown>;
            expect(meta.issuer).toBeDefined();
            expect(meta.authorization_endpoint).toBeDefined();
            expect(meta.token_endpoint).toBeDefined();
            expect(meta.registration_endpoint).toBeDefined();
            expect(meta.response_types_supported).toEqual(["code"]);
            expect(meta.grant_types_supported).toEqual(["authorization_code"]);
            expect(meta.code_challenge_methods_supported).toEqual(["S256"]);
        });

        it("should return consistent base URL in all endpoints", async () => {
            const res = await app.request("/google/.well-known/oauth-authorization-server");
            const meta = await res.json() as Record<string, string>;

            const issuer = meta.issuer;
            expect(meta.authorization_endpoint).toBe(`${issuer}/oauth/authorize`);
            expect(meta.token_endpoint).toBe(`${issuer}/oauth/token`);
            expect(meta.registration_endpoint).toBe(`${issuer}/oauth/register`);
        });
    });

    // =========================================================================
    // RFC7591 Dynamic Client Registration
    // =========================================================================

    describe("POST /oauth/register", () => {
        it("should register a client with valid redirect_uris", async () => {
            const res = await app.request("/google/oauth/register", {
                method: "POST",
                body: JSON.stringify({
                    redirect_uris: ["http://localhost:3000/callback"],
                    client_name: "Test Client",
                }),
                headers: { "Content-Type": "application/json" },
            });
            expect(res.status).toBe(201);

            const body = await res.json() as Record<string, unknown>;
            expect(body.client_id).toBeDefined();
            expect(typeof body.client_id).toBe("string");
            expect(body.redirect_uris).toEqual(["http://localhost:3000/callback"]);
            expect(body.client_name).toBe("Test Client");
            expect(body.token_endpoint_auth_method).toBe("none");
            expect(body.grant_types).toEqual(["authorization_code"]);
            expect(body.response_types).toEqual(["code"]);
        });

        it("should generate unique client_ids", async () => {
            const res1 = await app.request("/google/oauth/register", {
                method: "POST",
                body: JSON.stringify({ redirect_uris: ["http://localhost:3000/cb1"] }),
                headers: { "Content-Type": "application/json" },
            });
            const res2 = await app.request("/google/oauth/register", {
                method: "POST",
                body: JSON.stringify({ redirect_uris: ["http://localhost:3000/cb2"] }),
                headers: { "Content-Type": "application/json" },
            });

            const body1 = await res1.json() as { client_id: string };
            const body2 = await res2.json() as { client_id: string };
            expect(body1.client_id).not.toBe(body2.client_id);
        });

        it("should reject registration without redirect_uris", async () => {
            const res = await app.request("/google/oauth/register", {
                method: "POST",
                body: JSON.stringify({ client_name: "No URIs" }),
                headers: { "Content-Type": "application/json" },
            });
            expect(res.status).toBe(400);
        });

        it("should reject registration with empty redirect_uris", async () => {
            const res = await app.request("/google/oauth/register", {
                method: "POST",
                body: JSON.stringify({ redirect_uris: [] }),
                headers: { "Content-Type": "application/json" },
            });
            expect(res.status).toBe(400);
        });
    });

    // =========================================================================
    // GET /oauth/authorize
    // =========================================================================

    describe("GET /oauth/authorize", () => {
        it("should reject missing required parameters", async () => {
            const res = await app.request("/google/oauth/authorize");
            expect(res.status).toBe(400);

            const body = await res.json() as { error: string };
            expect(body.error).toBe("invalid_request");
        });

        it("should reject non-code response_type", async () => {
            const params = new URLSearchParams({
                client_id: "test-client",
                redirect_uri: "http://localhost:3000/callback",
                response_type: "token",
                code_challenge: "abc123",
            });
            const res = await app.request(`/google/oauth/authorize?${params}`);
            expect(res.status).toBe(400);

            const body = await res.json() as { error: string };
            expect(body.error).toBe("unsupported_response_type");
        });

        it("should reject insecure redirect_uri (non-localhost, non-HTTPS)", async () => {
            const params = new URLSearchParams({
                client_id: "test-client",
                redirect_uri: "http://evil.example.com/callback",
                response_type: "code",
                code_challenge: "abc123",
            });
            const res = await app.request(`/google/oauth/authorize?${params}`);
            expect(res.status).toBe(400);

            const body = await res.json() as { error: string; error_description: string };
            expect(body.error).toBe("invalid_request");
            expect(body.error_description).toContain("redirect_uri");
        });

        it("should accept localhost redirect_uri", async () => {
            const params = new URLSearchParams({
                client_id: "test-client",
                redirect_uri: "http://localhost:3000/callback",
                response_type: "code",
                code_challenge: "abc123",
                code_challenge_method: "S256",
            });
            const res = await app.request(`/google/oauth/authorize?${params}`, { redirect: "manual" });

            // Should redirect to Google OAuth (302)
            expect(res.status).toBe(302);
            const location = res.headers.get("Location") || "";
            expect(location).toContain("accounts.google.com");
            expect(location).toContain("response_type=code");
        });

        it("should accept HTTPS redirect_uri", async () => {
            const params = new URLSearchParams({
                client_id: "test-client",
                redirect_uri: "https://app.example.com/callback",
                response_type: "code",
                code_challenge: "abc123",
            });
            const res = await app.request(`/google/oauth/authorize?${params}`, { redirect: "manual" });
            expect(res.status).toBe(302);
        });

        it("should include client_id and scopes in Google redirect", async () => {
            const params = new URLSearchParams({
                client_id: "test-client",
                redirect_uri: "http://localhost:3000/callback",
                response_type: "code",
                code_challenge: "test-challenge",
                state: "my-state",
            });
            const res = await app.request(`/google/oauth/authorize?${params}`, { redirect: "manual" });
            const location = res.headers.get("Location") || "";

            expect(location).toContain("scope=");
            expect(location).toContain("access_type=offline");
            expect(location).toContain("prompt=consent");
            // State should be our internal state (not the client's state)
            expect(location).toContain("state=");
        });

        it("should reject redirect_uri not registered for client", async () => {
            // First register a client with specific redirect_uri
            const regRes = await app.request("/google/oauth/register", {
                method: "POST",
                body: JSON.stringify({ redirect_uris: ["http://localhost:3000/registered"] }),
                headers: { "Content-Type": "application/json" },
            });
            const { client_id } = await regRes.json() as { client_id: string };

            // Try to authorize with a different redirect_uri
            const params = new URLSearchParams({
                client_id,
                redirect_uri: "http://localhost:3000/other",
                response_type: "code",
                code_challenge: "abc123",
            });
            const res = await app.request(`/google/oauth/authorize?${params}`);
            expect(res.status).toBe(400);
        });
    });

    // =========================================================================
    // POST /oauth/token
    // =========================================================================

    describe("POST /oauth/token", () => {
        it("should reject unsupported grant_type", async () => {
            const res = await app.request("/google/oauth/token", {
                method: "POST",
                body: "grant_type=client_credentials&code=abc&code_verifier=xyz",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
            });
            expect(res.status).toBe(400);

            const body = await res.json() as { error: string };
            expect(body.error).toBe("unsupported_grant_type");
        });

        it("should reject missing code or code_verifier", async () => {
            const res = await app.request("/google/oauth/token", {
                method: "POST",
                body: "grant_type=authorization_code",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
            });
            expect(res.status).toBe(400);

            const body = await res.json() as { error: string };
            expect(body.error).toBe("invalid_request");
        });

        it("should reject invalid authorization code", async () => {
            const res = await app.request("/google/oauth/token", {
                method: "POST",
                body: "grant_type=authorization_code&code=invalid-code&code_verifier=test",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
            });
            expect(res.status).toBe(400);

            const body = await res.json() as { error: string };
            expect(body.error).toBe("invalid_grant");
        });

        it("should accept JSON body in addition to form-urlencoded", async () => {
            const res = await app.request("/google/oauth/token", {
                method: "POST",
                body: JSON.stringify({
                    grant_type: "authorization_code",
                    code: "invalid-code",
                    code_verifier: "test",
                }),
                headers: { "Content-Type": "application/json" },
            });
            expect(res.status).toBe(400);

            const body = await res.json() as { error: string };
            expect(body.error).toBe("invalid_grant");
        });
    });

    // =========================================================================
    // MCP Endpoints — 401 without session
    // =========================================================================

    describe("Google MCP endpoints without auth", () => {
        it("POST /mcp/google-docs should return 401 without Bearer token", async () => {
            const res = await app.request("/mcp/google-docs", {
                method: "POST",
                body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }),
                headers: { "Content-Type": "application/json" },
            });
            expect(res.status).toBe(401);

            const body = await res.json() as { error: string };
            expect(body.error).toContain("authentication");
        });

        it("POST /mcp/google-sheets should return 401 without Bearer token", async () => {
            const res = await app.request("/mcp/google-sheets", {
                method: "POST",
                body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }),
                headers: { "Content-Type": "application/json" },
            });
            expect(res.status).toBe(401);
        });

        it("POST /mcp/google-slides should return 401 without Bearer token", async () => {
            const res = await app.request("/mcp/google-slides", {
                method: "POST",
                body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }),
                headers: { "Content-Type": "application/json" },
            });
            expect(res.status).toBe(401);
        });

        it("should return 401 with invalid Bearer token", async () => {
            const res = await app.request("/mcp/google-docs", {
                method: "POST",
                body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }),
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer invalid-token",
                },
            });
            expect(res.status).toBe(401);
        });
    });
});
