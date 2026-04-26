/**
 * Integration Tests for Trello OAuth Routes
 *
 * Tests the full OAuth 2.1 flow for Trello MCP authentication including
 * well-known metadata, client registration, PKCE authorization, and token exchange.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { clearAll } from "../helpers/db-mock";

vi.mock("../../src/db/connection", async () => {
    return await import("../helpers/db-mock");
});

// Mock trello-auth to avoid real API calls
vi.mock("../../src/lib/trello-auth", () => ({
    isTrelloConfiguredAsync: vi.fn().mockResolvedValue(true),
    getTrelloAppKeyAsync: vi.fn().mockResolvedValue("mock-trello-app-key"),
    storeUserToken: vi.fn().mockResolvedValue("session-token-abc"),
    hasConnected: vi.fn().mockResolvedValue(false),
    deleteTokensByUser: vi.fn().mockResolvedValue(undefined),
}));

import { app } from "../../src/index";
import { createHash } from "crypto";

describe("Trello OAuth Routes", () => {
    beforeEach(() => {
        clearAll();
    });

    describe("GET /trello/.well-known/oauth-authorization-server", () => {
        it("should return RFC8414 metadata", async () => {
            const res = await app.request("/trello/.well-known/oauth-authorization-server");
            expect(res.status).toBe(200);
            const data = await res.json() as Record<string, unknown>;
            expect(data.issuer).toBeDefined();
            expect(data.authorization_endpoint).toContain("/trello/oauth/authorize");
            expect(data.token_endpoint).toContain("/trello/oauth/token");
            expect(data.registration_endpoint).toContain("/trello/oauth/register");
            expect(data.response_types_supported).toEqual(["code"]);
            expect(data.grant_types_supported).toEqual(["authorization_code"]);
            expect(data.code_challenge_methods_supported).toEqual(["S256"]);
            expect(data.scopes_supported).toEqual(["trello"]);
        });
    });

    describe("POST /trello/oauth/register", () => {
        it("should register a client and return client_id", async () => {
            const res = await app.request("/trello/oauth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    redirect_uris: ["http://localhost:3000/oauth/callback"],
                    client_name: "Test Client",
                }),
            });
            expect(res.status).toBe(201);
            const data = await res.json() as Record<string, unknown>;
            expect(data.client_id).toBeDefined();
            expect(typeof data.client_id).toBe("string");
            expect(data.redirect_uris).toEqual(["http://localhost:3000/oauth/callback"]);
            expect(data.client_name).toBe("Test Client");
            expect(data.token_endpoint_auth_method).toBe("none");
        });

        it("should reject registration without redirect_uris", async () => {
            const res = await app.request("/trello/oauth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ client_name: "Bad Client" }),
            });
            expect(res.status).toBe(400);
            const data = await res.json() as { error: string };
            expect(data.error).toBe("redirect_uris is required");
        });

        it("should reject registration with empty redirect_uris", async () => {
            const res = await app.request("/trello/oauth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ redirect_uris: [] }),
            });
            expect(res.status).toBe(400);
        });
    });

    describe("GET /trello/oauth/authorize", () => {
        it("should reject when missing required params", async () => {
            const res = await app.request("/trello/oauth/authorize");
            expect(res.status).toBe(400);
            const data = await res.json() as { error: string };
            expect(data.error).toBe("invalid_request");
        });

        it("should reject unsupported response_type", async () => {
            const params = new URLSearchParams({
                client_id: "test-client",
                redirect_uri: "http://localhost:3000/callback",
                response_type: "token",
                code_challenge: "test-challenge",
            });
            const res = await app.request(`/trello/oauth/authorize?${params}`);
            expect(res.status).toBe(400);
            const data = await res.json() as { error: string };
            expect(data.error).toBe("unsupported_response_type");
        });

        it("should reject invalid redirect_uri (non-https, non-localhost)", async () => {
            const params = new URLSearchParams({
                client_id: "test-client",
                redirect_uri: "http://evil.com/callback",
                response_type: "code",
                code_challenge: "test-challenge",
            });
            const res = await app.request(`/trello/oauth/authorize?${params}`);
            expect(res.status).toBe(400);
            const data = await res.json() as { error: string; error_description: string };
            expect(data.error_description).toContain("HTTPS");
        });

        it("should redirect to Trello for valid params with localhost redirect", async () => {
            const params = new URLSearchParams({
                client_id: "test-client",
                redirect_uri: "http://localhost:3000/callback",
                response_type: "code",
                code_challenge: "test-challenge",
                code_challenge_method: "S256",
                state: "test-state",
            });
            const res = await app.request(`/trello/oauth/authorize?${params}`, { redirect: "manual" });
            expect(res.status).toBe(302);
            const location = res.headers.get("Location");
            expect(location).toContain("trello.com/1/authorize");
        });

        it("should accept https redirect URIs", async () => {
            const params = new URLSearchParams({
                client_id: "test-client",
                redirect_uri: "https://app.example.com/callback",
                response_type: "code",
                code_challenge: "test-challenge",
            });
            const res = await app.request(`/trello/oauth/authorize?${params}`, { redirect: "manual" });
            expect(res.status).toBe(302);
        });
    });

    describe("GET /trello/callback", () => {
        it("should return an HTML page for token extraction", async () => {
            const res = await app.request("/trello/callback?state=test-state");
            expect(res.status).toBe(200);
            const html = await res.text();
            expect(html).toContain("<!DOCTYPE html>");
            expect(html).toContain("token-store");
            expect(html).toContain("oauth-callback");
        });
    });

    describe("POST /trello/token-store", () => {
        it("should reject when token is missing", async () => {
            const res = await app.request("/trello/token-store", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ state: "test-state" }),
            });
            expect(res.status).toBe(400);
            const data = await res.json() as { error: string };
            expect(data.error).toBe("Missing token or state");
        });

        it("should reject when state is missing", async () => {
            const res = await app.request("/trello/token-store", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token: "test-token" }),
            });
            expect(res.status).toBe(400);
        });

        it("should reject invalid state", async () => {
            const res = await app.request("/trello/token-store", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token: "test-token", state: "invalid-state" }),
            });
            expect(res.status).toBe(400);
            const data = await res.json() as { error: string };
            expect(data.error).toContain("Invalid or expired");
        });
    });

    describe("POST /trello/oauth/token", () => {
        it("should reject unsupported grant_type", async () => {
            const res = await app.request("/trello/oauth/token", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    grant_type: "client_credentials",
                    code: "test",
                    code_verifier: "test",
                }).toString(),
            });
            expect(res.status).toBe(400);
            const data = await res.json() as { error: string };
            expect(data.error).toBe("unsupported_grant_type");
        });

        it("should reject missing code or code_verifier", async () => {
            const res = await app.request("/trello/oauth/token", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    grant_type: "authorization_code",
                }).toString(),
            });
            expect(res.status).toBe(400);
            const data = await res.json() as { error: string };
            expect(data.error).toBe("invalid_request");
        });

        it("should reject invalid authorization code", async () => {
            const res = await app.request("/trello/oauth/token", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    grant_type: "authorization_code",
                    code: "invalid-code",
                    code_verifier: "test-verifier",
                }).toString(),
            });
            expect(res.status).toBe(400);
            const data = await res.json() as { error: string };
            expect(data.error).toBe("invalid_grant");
        });

        it("should accept JSON content type", async () => {
            const res = await app.request("/trello/oauth/token", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    grant_type: "authorization_code",
                    code: "invalid-code",
                    code_verifier: "test-verifier",
                }),
            });
            expect(res.status).toBe(400);
            const data = await res.json() as { error: string };
            expect(data.error).toBe("invalid_grant");
        });
    });

    describe("Full PKCE flow (register → authorize → token)", () => {
        it("should complete end-to-end PKCE exchange", async () => {
            // 1. Register client
            const regRes = await app.request("/trello/oauth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    redirect_uris: ["http://localhost:3000/oauth/callback"],
                }),
            });
            expect(regRes.status).toBe(201);
            const regData = await regRes.json() as { client_id: string };

            // 2. Generate PKCE params
            const codeVerifier = "test-code-verifier-that-is-long-enough-for-pkce";
            const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

            // 3. Authorize — should redirect to Trello
            const authParams = new URLSearchParams({
                client_id: regData.client_id,
                redirect_uri: "http://localhost:3000/oauth/callback",
                response_type: "code",
                code_challenge: codeChallenge,
                code_challenge_method: "S256",
                state: "my-client-state",
            });
            const authRes = await app.request(`/trello/oauth/authorize?${authParams}`, { redirect: "manual" });
            expect(authRes.status).toBe(302);
        });
    });

    describe("GET /trello/status", () => {
        it("should reject without userId", async () => {
            const res = await app.request("/trello/status");
            expect(res.status).toBe(400);
            const data = await res.json() as { error: string };
            expect(data.error).toContain("userId");
        });

        it("should return configured and connected status", async () => {
            const res = await app.request("/trello/status?userId=test-user");
            expect(res.status).toBe(200);
            const data = await res.json() as { configured: boolean; connected: boolean };
            expect(typeof data.configured).toBe("boolean");
            expect(typeof data.connected).toBe("boolean");
        });
    });

    describe("DELETE /trello/disconnect", () => {
        it("should reject without userId", async () => {
            const res = await app.request("/trello/disconnect", { method: "DELETE" });
            expect(res.status).toBe(400);
        });

        it("should disconnect user", async () => {
            const res = await app.request("/trello/disconnect?userId=test-user", { method: "DELETE" });
            expect(res.status).toBe(200);
            const data = await res.json() as { disconnected: boolean };
            expect(data.disconnected).toBe(true);
        });
    });
});
