/**
 * Tests for storage adapter
 *
 * Covers branch paths: null keys, string keys, array keys, getValue, getValueOrDefault
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/platform", () => ({
    platform: {
        name: "web",
        storage: {
            get: vi.fn(async (keys: string[]) => {
                const result: Record<string, unknown> = {};
                for (const key of keys) {
                    if (key === "existing-key") result[key] = "test-value";
                }
                return result;
            }),
            set: vi.fn(async () => { }),
            remove: vi.fn(async () => { }),
        },
    },
}));

import { storage } from "./adapter";

describe("storage adapter", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("get", () => {
        it("should return empty object for null keys on web platform", async () => {
            const result = await storage.get(null);
            expect(result).toEqual({});
        });

        it("should handle string key", async () => {
            const result = await storage.get("existing-key");
            expect(result["existing-key"]).toBe("test-value");
        });

        it("should handle array of keys", async () => {
            const result = await storage.get(["existing-key"]);
            expect(result["existing-key"]).toBe("test-value");
        });
    });

    describe("getValue", () => {
        it("should return value for existing key", async () => {
            const result = await storage.getValue("existing-key");
            expect(result).toBe("test-value");
        });

        it("should return undefined for missing key", async () => {
            const result = await storage.getValue("missing-key");
            expect(result).toBeUndefined();
        });
    });

    describe("getValueOrDefault", () => {
        it("should return value for existing key", async () => {
            const result = await storage.getValueOrDefault("existing-key", "default");
            expect(result).toBe("test-value");
        });

        it("should return default for missing key", async () => {
            const result = await storage.getValueOrDefault("missing-key", "default");
            expect(result).toBe("default");
        });
    });

    describe("set", () => {
        it("should delegate to platform storage", async () => {
            const { platform } = await import("@/platform");
            await storage.set({ key: "value" });
            expect(platform.storage.set).toHaveBeenCalledWith({ key: "value" });
        });
    });

    describe("remove", () => {
        it("should delegate to platform storage", async () => {
            const { platform } = await import("@/platform");
            await storage.remove("key");
            expect(platform.storage.remove).toHaveBeenCalledWith("key");
        });
    });
});
