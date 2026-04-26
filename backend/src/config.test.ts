/**
 * Config Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { loadConfig, getConfig, resetConfig } from "./config";

describe("getConfig", () => {
    beforeEach(() => {
        resetConfig();
    });

    it("returns a valid config object", () => {
        const config = getConfig();
        expect(config).toBeDefined();
        expect(config.db).toBeDefined();
        expect(config.port).toBeTypeOf("number");
        expect(config.rateLimit.requests).toBeTypeOf("number");
        expect(config.rateLimit.window).toBeTypeOf("number");
    });

    it("returns the same singleton on subsequent calls", () => {
        const config1 = getConfig();
        const config2 = getConfig();
        expect(config1).toBe(config2);
    });

    it("resets config singleton", () => {
        const config1 = getConfig();
        resetConfig();
        const config2 = getConfig();
        // Same content but different object reference after reset
        expect(config1).not.toBe(config2);
    });

    it("uses default values when DB env vars are not set", async () => {
        vi.resetModules();
        const originalDbName = process.env.DB_NAME;
        const originalDbUser = process.env.DB_USER;
        const originalDbPassword = process.env.DB_PASSWORD;
        delete process.env.DB_NAME;
        delete process.env.DB_USER;
        delete process.env.DB_PASSWORD;

        try {
            const mod = await import("./config");
            mod.resetConfig();
            const config = mod.getConfig();
            // Should use defaults (either zod defaults or test defaults)
            expect(config.db.name).toBeDefined();
            expect(config.db.user).toBeDefined();
        } finally {
            process.env.DB_NAME = originalDbName;
            process.env.DB_USER = originalDbUser;
            process.env.DB_PASSWORD = originalDbPassword;
        }
    });

    it("loads config with defaults in production mode", async () => {
        vi.resetModules();
        const originalVitest = process.env.VITEST;
        const originalNodeEnv = process.env.NODE_ENV;
        const originalDbName = process.env.DB_NAME;
        const originalDbUser = process.env.DB_USER;
        const originalDbPassword = process.env.DB_PASSWORD;

        // Remove DB vars — should still work with defaults
        delete process.env.DB_NAME;
        delete process.env.DB_USER;
        delete process.env.DB_PASSWORD;
        // Simulate production
        delete process.env.VITEST;
        process.env.NODE_ENV = "production";

        try {
            const mod = await import("./config");
            mod.resetConfig();
            const config = mod.getConfig();
            expect(config.db.name).toBeDefined();
        } finally {
            if (originalVitest !== undefined) process.env.VITEST = originalVitest;
            process.env.NODE_ENV = originalNodeEnv ?? "";
            process.env.DB_NAME = originalDbName;
            process.env.DB_USER = originalDbUser;
            process.env.DB_PASSWORD = originalDbPassword;
        }
    });
});

describe("loadConfig", () => {
    const savedEnv = { ...process.env };

    afterEach(() => {
        // Restore env vars
        process.env = { ...savedEnv };
    });

    it("parses all environment variables correctly", () => {
        process.env.DB_HOST = "db.example.com";
        process.env.DB_PORT = "3307";
        process.env.DB_NAME = "mydb";
        process.env.DB_USER = "admin";
        process.env.DB_PASSWORD = "secret";
        process.env.PORT = "8080";
        process.env.CORS_ORIGIN = "https://app.example.com";
        process.env.RATE_LIMIT_REQUESTS = "200";
        process.env.RATE_LIMIT_WINDOW = "30";
        process.env.MAX_BLOB_SIZE = "1048576";
        process.env.API_KEYS = "key1,key2,key3";
        process.env.MCP_PROXY_ALLOWED_DOMAINS = "example.com,api.example.com";

        const config = loadConfig();
        expect(config.db).toEqual({
            host: "db.example.com",
            port: 3307,
            name: "mydb",
            user: "admin",
            password: "secret",
        });
        expect(config.port).toBe(8080);
        expect(config.corsOrigin).toBe("https://app.example.com");
        expect(config.rateLimit).toEqual({ requests: 200, window: 30 });
        expect(config.maxBlobSize).toBe(1048576);
        expect(config.apiKeys).toEqual(["key1", "key2", "key3"]);
        expect(config.mcpProxyAllowedDomains).toEqual(["example.com", "api.example.com"]);
    });

    it("uses defaults for missing DB fields", () => {
        delete process.env.DB_NAME;
        delete process.env.DB_USER;
        delete process.env.DB_PASSWORD;
        const config = loadConfig();
        expect(config.db.name).toBe("procura");
        expect(config.db.user).toBe("root");
        expect(config.db.password).toBe("");
    });

    it("parses QDRANT_KEY_MAPPINGS correctly", () => {
        process.env.QDRANT_KEY_MAPPINGS = "extKey1:qdrantKey1,extKey2:qdrantKey2";
        const config = loadConfig();
        expect(config.qdrantKeyMappings.get("extKey1")).toBe("qdrantKey1");
        expect(config.qdrantKeyMappings.get("extKey2")).toBe("qdrantKey2");
        expect(config.qdrantKeyMappings.size).toBe(2);
    });

    it("handles empty QDRANT_KEY_MAPPINGS", () => {
        process.env.QDRANT_KEY_MAPPINGS = "";
        const config = loadConfig();
        expect(config.qdrantKeyMappings.size).toBe(0);
    });

    it("handles malformed QDRANT_KEY_MAPPINGS pairs", () => {
        process.env.QDRANT_KEY_MAPPINGS = "noSeparator,valid:key,:noExtKey";
        const config = loadConfig();
        expect(config.qdrantKeyMappings.size).toBe(1);
        expect(config.qdrantKeyMappings.get("valid")).toBe("key");
    });

    it("handles CLEANUP_INACTIVE_DAYS", () => {
        process.env.CLEANUP_INACTIVE_DAYS = "30";
        const config = loadConfig();
        expect(config.cleanupInactiveDays).toBe(30);
    });
});

describe("getConfig - error handling", () => {
    it("should throw in non-test environment when config is invalid", async () => {
        const originalVitest = process.env.VITEST;
        const originalNodeEnv = process.env.NODE_ENV;
        const originalPort = process.env.PORT;

        delete process.env.VITEST;
        process.env.NODE_ENV = "production";
        process.env.PORT = "not-a-number";

        try {
            vi.resetModules();
            const mod = await import("./config");
            mod.resetConfig();

            // In production mode with invalid PORT, getConfig should throw
            expect(() => mod.getConfig()).toThrow("Failed to load configuration");
        } finally {
            if (originalVitest !== undefined) process.env.VITEST = originalVitest;
            else delete process.env.VITEST;
            process.env.NODE_ENV = originalNodeEnv || "";
            if (originalPort !== undefined) process.env.PORT = originalPort;
            else delete process.env.PORT;
        }
    });
});

