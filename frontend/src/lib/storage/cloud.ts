/**
 * Cloud Configuration Storage
 *
 * Unified backend/cloud config that derives sync, MCP proxy,
 * and MCP directory URLs from a single base URL + API key.
 */

import {
    isVaultConfigured,
    isVaultUnlocked,
    encryptWithVault,
} from "../vault";
import { storage } from "./adapter";
import { STORAGE_KEYS } from "./keys";
import { readEncryptedOrFallback } from "./vault-helper";

// =============================================================================
// Types
// =============================================================================

export interface CloudConfig {
    enabled: boolean;
    baseUrl: string;
    apiKey: string;
}

const DEFAULT_CLOUD_CONFIG: CloudConfig = {
    enabled: false,
    baseUrl: import.meta.env.VITE_API_BASE_URL || "",
    apiKey: "",
};

// =============================================================================
// URL Helpers
// =============================================================================

export function getCloudSyncUrl(baseUrl: string): string {
    const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    return `${base}/sync`;
}

export function getCloudProxyUrl(baseUrl: string): string {
    const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    return `${base}/mcp-proxy`;
}

export function getCloudDirectoryUrl(baseUrl: string): string {
    const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    return `${base}/mcp-directory`;
}

// =============================================================================
// Storage
// =============================================================================

export async function getCloudConfig(): Promise<CloudConfig> {
    const baseConfig = await storage.getValueOrDefault<CloudConfig>(
        STORAGE_KEYS.CLOUD_CONFIG,
        DEFAULT_CLOUD_CONFIG,
    );
    const configured = await isVaultConfigured();
    if (!configured) {
        return baseConfig;
    }
    const lockedFallback = { ...baseConfig, apiKey: "" };
    const secret = await readEncryptedOrFallback<Pick<CloudConfig, "apiKey">>(
        STORAGE_KEYS.CLOUD_CONFIG_ENC,
        { apiKey: "" },
        { apiKey: "" },
    );
    if (!secret.apiKey) {
        return lockedFallback;
    }
    return {
        ...baseConfig,
        ...secret,
    };
}

export async function setCloudConfig(config: CloudConfig): Promise<void> {
    const configured = await isVaultConfigured();
    if (!configured) {
        await storage.set({
            [STORAGE_KEYS.CLOUD_CONFIG]: config,
            [STORAGE_KEYS.SETTINGS_LAST_MODIFIED]: Date.now(),
        });
        return;
    }
    const { apiKey, ...rest } = config;
    if (!isVaultUnlocked()) {
        await storage.set({
            [STORAGE_KEYS.CLOUD_CONFIG]: { ...DEFAULT_CLOUD_CONFIG, ...rest, apiKey: "" },
            [STORAGE_KEYS.SETTINGS_LAST_MODIFIED]: Date.now(),
        });
        return;
    }
    const encrypted = await encryptWithVault({ apiKey });
    await storage.set({
        [STORAGE_KEYS.CLOUD_CONFIG]: { ...DEFAULT_CLOUD_CONFIG, ...rest, apiKey: "" },
        [STORAGE_KEYS.CLOUD_CONFIG_ENC]: encrypted,
        [STORAGE_KEYS.SETTINGS_LAST_MODIFIED]: Date.now(),
    });
}
