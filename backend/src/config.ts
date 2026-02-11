/**
 * Application Configuration
 * Loads settings from environment variables
 */

import "dotenv/config";
import { z } from "zod";

const configSchema = z.object({
    // Database
    db: z.object({
        host: z.string().default("localhost"),
        port: z.coerce.number().default(3306),
        name: z.string(),
        user: z.string(),
        password: z.string(),
    }),

    // Server
    port: z.coerce.number().default(3001),

    // CORS
    corsOrigin: z.string().default("*"),

    // Rate limiting
    rateLimit: z.object({
        requests: z.coerce.number().default(100),
        window: z.coerce.number().default(60), // seconds
    }),

    // Max blob size in bytes (default 50MB)
    maxBlobSize: z.coerce.number().default(50 * 1024 * 1024),

    // API keys (empty = open mode)
    apiKeys: z.array(z.string()).default([]),

    // MCP proxy allowed domains (empty = allow all HTTPS)
    mcpProxyAllowedDomains: z.array(z.string()).default([]),
});

export type Config = z.infer<typeof configSchema>;

function parseCommaSeparated(value: string | undefined): string[] {
    if (!value || value.trim() === "") return [];
    return value.split(",").map(s => s.trim()).filter(Boolean);
}

export function loadConfig(): Config {
    const env = process.env;

    return configSchema.parse({
        db: {
            host: env.DB_HOST,
            port: env.DB_PORT,
            name: env.DB_NAME,
            user: env.DB_USER,
            password: env.DB_PASSWORD,
        },
        port: env.PORT,
        corsOrigin: env.CORS_ORIGIN,
        rateLimit: {
            requests: env.RATE_LIMIT_REQUESTS,
            window: env.RATE_LIMIT_WINDOW,
        },
        maxBlobSize: env.MAX_BLOB_SIZE,
        apiKeys: parseCommaSeparated(env.API_KEYS),
        mcpProxyAllowedDomains: parseCommaSeparated(env.MCP_PROXY_ALLOWED_DOMAINS),
    });
}

// Singleton config instance
let _config: Config | null = null;

// Default config for testing (when env vars not set)
const testDefaults: Config = {
    db: { host: "localhost", port: 3306, name: "procura_test", user: "test", password: "test" }, // eslint-disable-line sonarjs/no-hardcoded-passwords -- test defaults
    port: 3001,
    corsOrigin: "*",
    rateLimit: { requests: 100, window: 60 },
    maxBlobSize: 50 * 1024 * 1024,
    apiKeys: [],
    mcpProxyAllowedDomains: [],
};

export function getConfig(): Config {
    if (!_config) {
        try {
            _config = loadConfig();
        } catch (err) {
            // Only use test defaults in test environment — fail fast in production
            const isTest = process.env.NODE_ENV === "test" || !!process.env.VITEST;
            if (isTest) {
                _config = testDefaults;
            } else {
                throw new Error(
                    `Failed to load configuration. Check your .env file.\n${err instanceof Error ? err.message : err}`
                );
            }
        }
    }
    return _config;
}

// For testing: reset config
export function resetConfig(): void {
    _config = null;
}
