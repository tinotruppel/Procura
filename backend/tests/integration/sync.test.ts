/**
 * Integration Tests for Sync API
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { clearAll } from "../helpers/db-mock";

// Mock the DB module with our stateful in-memory mock
vi.mock("../../src/db/connection", async () => {
    return await import("../helpers/db-mock");
});

import { app } from "../../src/index";

// Test user ID (valid 64-char hex)
const TEST_USER_ID = "a".repeat(64);
const TEST_OBJECT_ID = "test-object-001";

describe("Sync API", () => {
    beforeEach(() => {
        clearAll();
    });

    describe("GET /sync/:userId", () => {
        it("should return empty list for new user", async () => {
            const res = await app.request(`/sync/${TEST_USER_ID}`);
            expect(res.status).toBe(200);

            const json = await res.json() as { success: boolean; objects: unknown[] };
            expect(json.success).toBe(true);
            expect(Array.isArray(json.objects)).toBe(true);
            expect(json.objects).toHaveLength(0);
        });

        it("should reject invalid userId format", async () => {
            const res = await app.request("/sync/invalid-user-id");
            expect(res.status).toBe(400);

            const json = await res.json() as { error: string };
            expect(json.error).toContain("userId");
        });

        it("should reject too short userId", async () => {
            const res = await app.request("/sync/" + "a".repeat(63));
            expect(res.status).toBe(400);
        });

        it("should reject uppercase hex in userId", async () => {
            const res = await app.request("/sync/" + "A".repeat(64));
            expect(res.status).toBe(400);
        });
    });

    describe("GET /sync/:userId/:objectId", () => {
        it("should return 404 for non-existent object", async () => {
            const res = await app.request(`/sync/${TEST_USER_ID}/non-existent-object`);
            expect(res.status).toBe(404);

            const json = await res.json() as { error: string };
            expect(json.error).toContain("not found");
        });

        it("should reject invalid objectId format", async () => {
            const res = await app.request(`/sync/${TEST_USER_ID}/has.invalid.chars`);
            expect(res.status).toBe(400);

            const json = await res.json() as { error: string };
            expect(json.error).toContain("objectId");
        });
    });

    describe("PUT /sync/:userId/:objectId", () => {
        it("should reject missing data field", async () => {
            const res = await app.request(`/sync/${TEST_USER_ID}/${TEST_OBJECT_ID}`, {
                method: "PUT",
                body: JSON.stringify({}),
                headers: { "Content-Type": "application/json" },
            });
            expect(res.status).toBe(400);
        });

        it("should reject empty data field", async () => {
            const res = await app.request(`/sync/${TEST_USER_ID}/${TEST_OBJECT_ID}`, {
                method: "PUT",
                body: JSON.stringify({ data: "" }),
                headers: { "Content-Type": "application/json" },
            });
            expect(res.status).toBe(400);
        });

        it("should store and retrieve an object", async () => {
            const putRes = await app.request(`/sync/${TEST_USER_ID}/${TEST_OBJECT_ID}`, {
                method: "PUT",
                body: JSON.stringify({ data: "dGVzdC1kYXRh" }),
                headers: { "Content-Type": "application/json" },
            });
            expect(putRes.status).toBe(200);

            const putJson = await putRes.json() as { success: boolean };
            expect(putJson.success).toBe(true);

            // GET the stored object
            const getRes = await app.request(`/sync/${TEST_USER_ID}/${TEST_OBJECT_ID}`);
            expect(getRes.status).toBe(200);

            const getJson = await getRes.json() as { success: boolean; data: string; lastModified: number };
            expect(getJson.success).toBe(true);
            expect(getJson.data).toBe("dGVzdC1kYXRh");
            expect(getJson.lastModified).toBeGreaterThan(0);
        });

        it("should update an existing object", async () => {
            // Store initial
            await app.request(`/sync/${TEST_USER_ID}/${TEST_OBJECT_ID}`, {
                method: "PUT",
                body: JSON.stringify({ data: "aW5pdGlhbA==" }),
                headers: { "Content-Type": "application/json" },
            });

            // Update
            const putRes = await app.request(`/sync/${TEST_USER_ID}/${TEST_OBJECT_ID}`, {
                method: "PUT",
                body: JSON.stringify({ data: "dXBkYXRlZA==" }),
                headers: { "Content-Type": "application/json" },
            });
            expect(putRes.status).toBe(200);

            // Verify updated value
            const getRes = await app.request(`/sync/${TEST_USER_ID}/${TEST_OBJECT_ID}`);
            const getJson = await getRes.json() as { data: string };
            expect(getJson.data).toBe("dXBkYXRlZA==");
        });

        it("should list stored objects", async () => {
            // Store two objects
            await app.request(`/sync/${TEST_USER_ID}/obj-1`, {
                method: "PUT",
                body: JSON.stringify({ data: "b25l" }),
                headers: { "Content-Type": "application/json" },
            });
            await app.request(`/sync/${TEST_USER_ID}/obj-2`, {
                method: "PUT",
                body: JSON.stringify({ data: "dHdv" }),
                headers: { "Content-Type": "application/json" },
            });

            const listRes = await app.request(`/sync/${TEST_USER_ID}`);
            expect(listRes.status).toBe(200);

            const listJson = await listRes.json() as { objects: Array<{ objectId: string }> };
            expect(listJson.objects).toHaveLength(2);
        });
    });

    describe("CORS", () => {
        it("should handle OPTIONS preflight", async () => {
            const res = await app.request("/sync/" + TEST_USER_ID, {
                method: "OPTIONS",
            });
            expect(res.status).toBe(204);
        });

        it("should include CORS headers", async () => {
            const res = await app.request("/sync/invalid-user-id");
            expect(res.headers.get("access-control-allow-origin")).toBeTruthy();
        });
    });

    describe("Health check", () => {
        it("should return ok", async () => {
            const res = await app.request("/health");
            expect([200, 503]).toContain(res.status);

            const json = await res.json() as { status: string };
            expect(["ok", "degraded"]).toContain(json.status);
        });
    });

    describe("404 handling", () => {
        it("should return 404 for unknown routes", async () => {
            const res = await app.request("/unknown-route");
            expect(res.status).toBe(404);
        });
    });
});
