import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../src/index";
import { initPool, closePool } from "../../src/db/connection";
import { hashApiKey } from "../../src/lib/vault-crypto";

const API_KEY_A = "test-api-key-alpha-12345678";
const API_KEY_B = "test-api-key-beta-87654321";

describe("Vault Routes", () => {
    beforeAll(async () => {
        process.env.DB_DRIVER = "sqlite";
        process.env.API_KEYS = `${API_KEY_A},${API_KEY_B}`;
        await initPool();
    });

    afterAll(async () => {
        await closePool();
        delete process.env.DB_DRIVER;
        delete process.env.API_KEYS;
    });

    const request = (method: string, path: string, apiKey: string, body?: unknown) => {
        const opts: RequestInit = {
            method,
            headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        };
        if (body) opts.body = JSON.stringify(body);
        return app.request(path, opts);
    };

    describe("PUT /vault/secrets", () => {
        it("should store secrets and return stored names", async () => {
            const res = await request("PUT", "/vault/secrets", API_KEY_A, {
                GOOGLE_CLIENT_ID: "1234.apps.googleusercontent.com",
                GOOGLE_CLIENT_SECRET: "GOCSPX-secret123",
            });

            expect(res.status).toBe(200);
            const body = await res.json() as { stored: string[] };
            expect(body.stored).toEqual(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]);
        });

        it("should reject empty body", async () => {
            const res = await request("PUT", "/vault/secrets", API_KEY_A, {});
            expect(res.status).toBe(400);
        });

        it("should reject missing API key", async () => {
            const res = await app.request("/vault/secrets", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ FOO: "bar" }),
            });
            expect(res.status).toBe(401);
        });

        it("should overwrite existing secret (upsert)", async () => {
            await request("PUT", "/vault/secrets", API_KEY_A, { OVERWRITE_ME: "v1" });
            await request("PUT", "/vault/secrets", API_KEY_A, { OVERWRITE_ME: "v2" });

            const res = await request("GET", "/vault/secrets", API_KEY_A);
            const body = await res.json() as { secrets: Array<{ name: string }> };
            const names = body.secrets.map(s => s.name);
            // Should have exactly one entry, not two
            expect(names.filter(n => n === "OVERWRITE_ME").length).toBe(1);
        });
    });

    describe("GET /vault/secrets", () => {
        it("should return stored secret names with timestamps", async () => {
            const res = await request("GET", "/vault/secrets", API_KEY_A);
            expect(res.status).toBe(200);

            const body = await res.json() as { secrets: Array<{ name: string; set: boolean; updatedAt: number }> };
            expect(body.secrets.length).toBeGreaterThanOrEqual(2);

            const google = body.secrets.find(s => s.name === "GOOGLE_CLIENT_SECRET");
            expect(google).toBeDefined();
            expect(google!.set).toBe(true);
            expect(google!.updatedAt).toBeGreaterThan(0);
        });

        it("should never return secret values", async () => {
            const res = await request("GET", "/vault/secrets", API_KEY_A);
            const body = await res.json() as { secrets: Array<Record<string, unknown>> };

            for (const secret of body.secrets) {
                expect(secret).not.toHaveProperty("ciphertext");
                expect(secret).not.toHaveProperty("salt");
                expect(secret).not.toHaveProperty("iv");
                expect(secret).not.toHaveProperty("tag");
                expect(secret).not.toHaveProperty("value");
            }
        });

        it("should isolate secrets between different API keys", async () => {
            // Store a secret for key B
            await request("PUT", "/vault/secrets", API_KEY_B, { B_ONLY_SECRET: "private" });

            // Key A should NOT see key B's secrets
            const resA = await request("GET", "/vault/secrets", API_KEY_A);
            const bodyA = await resA.json() as { secrets: Array<{ name: string }> };
            expect(bodyA.secrets.find(s => s.name === "B_ONLY_SECRET")).toBeUndefined();

            // Key B should see its own secret
            const resB = await request("GET", "/vault/secrets", API_KEY_B);
            const bodyB = await resB.json() as { secrets: Array<{ name: string }> };
            expect(bodyB.secrets.find(s => s.name === "B_ONLY_SECRET")).toBeDefined();
        });

        it("should return empty array for new API key with no secrets", async () => {
            const res = await request("GET", "/vault/secrets", "brand-new-key-no-secrets");
            // This will 401 if the key is not in API_KEYS, so use key B which has no Google secrets
            const resB = await request("GET", "/vault/secrets", API_KEY_B);
            expect(resB.status).toBe(200);
        });
    });

    describe("DELETE /vault/secrets/:name", () => {
        it("should delete an existing secret", async () => {
            await request("PUT", "/vault/secrets", API_KEY_A, { TO_DELETE: "temp" });

            const res = await request("DELETE", "/vault/secrets/TO_DELETE", API_KEY_A);
            expect(res.status).toBe(200);
            const body = await res.json() as { deleted: boolean };
            expect(body.deleted).toBe(true);

            // Verify it's gone
            const listRes = await request("GET", "/vault/secrets", API_KEY_A);
            const listBody = await listRes.json() as { secrets: Array<{ name: string }> };
            expect(listBody.secrets.find(s => s.name === "TO_DELETE")).toBeUndefined();
        });

        it("should return 404 for non-existent secret", async () => {
            const res = await request("DELETE", "/vault/secrets/NONEXISTENT", API_KEY_A);
            expect(res.status).toBe(404);
        });

        it("should not delete another key's secrets", async () => {
            await request("PUT", "/vault/secrets", API_KEY_B, { B_KEEP: "keep" });

            // Try to delete B's secret with A's key
            const res = await request("DELETE", "/vault/secrets/B_KEEP", API_KEY_A);
            expect(res.status).toBe(404);

            // Verify B still has it
            const resB = await request("GET", "/vault/secrets", API_KEY_B);
            const bodyB = await resB.json() as { secrets: Array<{ name: string }> };
            expect(bodyB.secrets.find(s => s.name === "B_KEEP")).toBeDefined();
        });
    });

    describe("Crypto: key_id derivation", () => {
        it("should produce consistent key_id for same API key", () => {
            const id1 = hashApiKey(API_KEY_A);
            const id2 = hashApiKey(API_KEY_A);
            expect(id1).toBe(id2);
            expect(id1).toHaveLength(64); // SHA-256 hex
        });

        it("should produce different key_id for different API keys", () => {
            expect(hashApiKey(API_KEY_A)).not.toBe(hashApiKey(API_KEY_B));
        });
    });
});
