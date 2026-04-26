/**
 * Unit Tests for Trello Auth Module
 *
 * Tests the Trello-specific authentication wrappers.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { clearAll, initPool } from "../helpers/db-mock";

vi.mock("../../src/db/connection", async () => {
    return await import("../helpers/db-mock");
});

// Mock vault-resolver for config resolution
vi.mock("../../src/lib/vault-resolver", () => ({
    resolveSecret: vi.fn().mockImplementation(async (key: string) => {
        const secrets: Record<string, string> = {
            TRELLO_APP_KEY: "test-trello-key",
        };
        return secrets[key] || process.env[key] || "";
    }),
}));

import {
    isTrelloConfigured,
    getTrelloAppKey,
    isTrelloConfiguredAsync,
    getTrelloAppKeyAsync,
} from "../../src/lib/trello-auth";

describe("Trello Auth Module", () => {
    const originalEnv = process.env;

    beforeEach(() => {
        clearAll();
        initPool();
        process.env = { ...originalEnv };
    });

    describe("isTrelloConfigured (sync)", () => {
        it("should return true when TRELLO_APP_KEY is set", () => {
            process.env.TRELLO_APP_KEY = "test-key";
            expect(isTrelloConfigured()).toBe(true);
        });

        it("should return false when TRELLO_APP_KEY is not set", () => {
            delete process.env.TRELLO_APP_KEY;
            expect(isTrelloConfigured()).toBe(false);
        });
    });

    describe("getTrelloAppKey (sync)", () => {
        it("should return the app key", () => {
            process.env.TRELLO_APP_KEY = "my-key";
            expect(getTrelloAppKey()).toBe("my-key");
        });

        it("should return empty string when not set", () => {
            delete process.env.TRELLO_APP_KEY;
            expect(getTrelloAppKey()).toBe("");
        });
    });

    describe("isTrelloConfiguredAsync", () => {
        it("should resolve from vault", async () => {
            const result = await isTrelloConfiguredAsync("test-api-key");
            expect(result).toBe(true);
        });
    });

    describe("getTrelloAppKeyAsync", () => {
        it("should resolve key from vault", async () => {
            const key = await getTrelloAppKeyAsync("test-api-key");
            expect(key).toBe("test-trello-key");
        });
    });
});
