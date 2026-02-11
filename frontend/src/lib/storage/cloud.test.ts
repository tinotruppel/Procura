/**
 * Tests for cloud.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../vault", () => ({
    isVaultConfigured: vi.fn(() => Promise.resolve(true)),
    isVaultUnlocked: vi.fn(() => true),
    encryptWithVault: vi.fn(async (value: unknown) => `enc:${btoa(JSON.stringify(value))}`),
}));

// Mock readEncryptedOrFallback
vi.mock("./vault-helper", () => ({
    readEncryptedOrFallback: vi.fn(),
}));

// Mock chrome.storage.local
const mockStorage: Record<string, unknown> = {};
const chromeMock = {
    storage: {
        local: {
            get: vi.fn((keys: string | string[]) => {
                if (typeof keys === "string") {
                    return Promise.resolve({ [keys]: mockStorage[keys] });
                }
                const result: Record<string, unknown> = {};
                for (const key of keys) {
                    if (mockStorage[key] !== undefined) {
                        result[key] = mockStorage[key];
                    }
                }
                return Promise.resolve(result);
            }),
            set: vi.fn((items: Record<string, unknown>) => {
                Object.assign(mockStorage, items);
                return Promise.resolve();
            }),
            remove: vi.fn((keys: string | string[]) => {
                const keysArray = typeof keys === "string" ? [keys] : keys;
                for (const key of keysArray) {
                    delete mockStorage[key];
                }
                return Promise.resolve();
            }),
        },
    },
    runtime: {
        id: "test-extension-id",
    },
};

vi.stubGlobal("chrome", chromeMock);

// Mock the platform module to ensure Chrome platform is used
vi.mock("@/platform", async () => {
    const mockPlatformStorage = {
        async get<T = unknown>(keys: string[]): Promise<Record<string, T>> {
            const result: Record<string, T> = {};
            for (const key of keys) {
                if ((globalThis as unknown as { chrome: typeof chromeMock }).chrome) {
                    const stored = await chromeMock.storage.local.get(key);
                    if (stored[key] !== undefined) {
                        result[key] = stored[key] as T;
                    }
                }
            }
            return result;
        },
        async set(items: Record<string, unknown>): Promise<void> {
            if ((globalThis as unknown as { chrome: typeof chromeMock }).chrome) {
                await chromeMock.storage.local.set(items);
            }
        },
        async remove(keys: string | string[]): Promise<void> {
            if ((globalThis as unknown as { chrome: typeof chromeMock }).chrome) {
                await chromeMock.storage.local.remove(keys);
            }
        },
    };

    return {
        platform: {
            name: "chrome" as const,
            storage: mockPlatformStorage,
            tabs: { create: vi.fn() },
            hasCapability: vi.fn(() => true),
        },
        isExtension: () => true,
        isWeb: () => false,
        hasCapability: vi.fn(() => true),
    };
});

import {
    getCloudConfig,
    setCloudConfig,
    getCloudSyncUrl,
    getCloudProxyUrl,
    getCloudDirectoryUrl,
} from "./cloud";
import { isVaultConfigured, isVaultUnlocked, encryptWithVault } from "../vault";
import { readEncryptedOrFallback } from "./vault-helper";
import { STORAGE_KEYS } from "./keys";

const mockedIsVaultConfigured = vi.mocked(isVaultConfigured);
const mockedIsVaultUnlocked = vi.mocked(isVaultUnlocked);
const mockedEncryptWithVault = vi.mocked(encryptWithVault);
const mockedReadEncrypted = vi.mocked(readEncryptedOrFallback);

describe("Cloud Config", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        for (const key of Object.keys(mockStorage)) {
            delete mockStorage[key];
        }
        // Restore defaults
        mockedIsVaultConfigured.mockResolvedValue(true);
        mockedIsVaultUnlocked.mockReturnValue(true);
        mockedEncryptWithVault.mockImplementation(async (value: unknown) =>
            `enc:${btoa(JSON.stringify(value))}`,
        );
    });

    // =========================================================================
    // URL helpers
    // =========================================================================

    describe("getCloudSyncUrl", () => {
        it("should append /sync to base URL", () => {
            expect(getCloudSyncUrl("https://api.example.com")).toBe(
                "https://api.example.com/sync",
            );
        });

        it("should strip trailing slash before appending", () => {
            expect(getCloudSyncUrl("https://api.example.com/")).toBe(
                "https://api.example.com/sync",
            );
        });
    });

    describe("getCloudProxyUrl", () => {
        it("should append /mcp-proxy to base URL", () => {
            expect(getCloudProxyUrl("https://api.example.com")).toBe(
                "https://api.example.com/mcp-proxy",
            );
        });

        it("should strip trailing slash before appending", () => {
            expect(getCloudProxyUrl("https://api.example.com/")).toBe(
                "https://api.example.com/mcp-proxy",
            );
        });
    });

    describe("getCloudDirectoryUrl", () => {
        it("should append /mcp-directory to base URL", () => {
            expect(getCloudDirectoryUrl("https://api.example.com")).toBe(
                "https://api.example.com/mcp-directory",
            );
        });

        it("should strip trailing slash before appending", () => {
            expect(getCloudDirectoryUrl("https://api.example.com/")).toBe(
                "https://api.example.com/mcp-directory",
            );
        });
    });

    // =========================================================================
    // getCloudConfig
    // =========================================================================

    describe("getCloudConfig", () => {
        it("should return defaults when no config is stored", async () => {
            mockedReadEncrypted.mockResolvedValue({ apiKey: "" });

            const config = await getCloudConfig();
            expect(config).toEqual({
                enabled: false,
                baseUrl: import.meta.env.VITE_API_BASE_URL || "",
                apiKey: "",
            });
        });

        it("should return stored config with decrypted API key", async () => {
            mockStorage[STORAGE_KEYS.CLOUD_CONFIG] = {
                enabled: true,
                baseUrl: "https://my.server.com",
                apiKey: "",
            };
            mockedReadEncrypted.mockResolvedValue({ apiKey: "decrypted-key" });

            const config = await getCloudConfig();
            expect(config).toEqual({
                enabled: true,
                baseUrl: "https://my.server.com",
                apiKey: "decrypted-key",
            });
        });

        it("should return config without vault decryption when vault not configured", async () => {
            mockedIsVaultConfigured.mockResolvedValue(false);
            mockStorage[STORAGE_KEYS.CLOUD_CONFIG] = {
                enabled: true,
                baseUrl: "https://my.server.com",
                apiKey: "plain-key",
            };

            const config = await getCloudConfig();
            expect(config).toEqual({
                enabled: true,
                baseUrl: "https://my.server.com",
                apiKey: "plain-key",
            });
            expect(mockedReadEncrypted).not.toHaveBeenCalled();
        });

        it("should return empty apiKey when vault returns no secret", async () => {
            mockStorage[STORAGE_KEYS.CLOUD_CONFIG] = {
                enabled: true,
                baseUrl: "https://my.server.com",
                apiKey: "",
            };
            mockedReadEncrypted.mockResolvedValue({ apiKey: "" });

            const config = await getCloudConfig();
            expect(config.apiKey).toBe("");
        });
    });

    // =========================================================================
    // setCloudConfig
    // =========================================================================

    describe("setCloudConfig", () => {
        it("should store config with encrypted API key when vault unlocked", async () => {
            await setCloudConfig({
                enabled: true,
                baseUrl: "https://my.server.com",
                apiKey: "secret-key",
            });

            expect(mockedEncryptWithVault).toHaveBeenCalledWith({ apiKey: "secret-key" });
            const stored = mockStorage[STORAGE_KEYS.CLOUD_CONFIG] as Record<string, unknown>;
            expect(stored.apiKey).toBe("");
            expect(stored.enabled).toBe(true);
            expect(stored.baseUrl).toBe("https://my.server.com");
            expect(mockStorage[STORAGE_KEYS.CLOUD_CONFIG_ENC]).toBeDefined();
            expect(mockStorage[STORAGE_KEYS.SETTINGS_LAST_MODIFIED]).toBeDefined();
        });

        it("should store config without encryption when vault not configured", async () => {
            mockedIsVaultConfigured.mockResolvedValue(false);

            await setCloudConfig({
                enabled: true,
                baseUrl: "https://my.server.com",
                apiKey: "plain-key",
            });

            expect(mockedEncryptWithVault).not.toHaveBeenCalled();
            const stored = mockStorage[STORAGE_KEYS.CLOUD_CONFIG] as Record<string, unknown>;
            expect(stored.apiKey).toBe("plain-key");
        });

        it("should store config without apiKey when vault is locked", async () => {
            mockedIsVaultUnlocked.mockReturnValue(false);

            await setCloudConfig({
                enabled: true,
                baseUrl: "https://my.server.com",
                apiKey: "secret-key",
            });

            expect(mockedEncryptWithVault).not.toHaveBeenCalled();
            const stored = mockStorage[STORAGE_KEYS.CLOUD_CONFIG] as Record<string, unknown>;
            expect(stored.apiKey).toBe("");
            expect(stored.enabled).toBe(true);
        });
    });
});
