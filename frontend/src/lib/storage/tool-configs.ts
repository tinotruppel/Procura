import { ToolConfigMap } from "@/tools/types";
import {
    isVaultConfigured,
    isVaultUnlocked,
    encryptWithVault,
} from "../vault";
import { storage } from "./adapter";
import { STORAGE_KEYS } from "./keys";
import { readEncryptedOrFallback } from "./vault-helper";

// ============================================================================
// Tool Configs
// ============================================================================

export type ToolConfigSecretsMap = Record<string, Record<string, unknown>>;

export function splitToolConfigSecrets(configs: ToolConfigMap): { sanitized: ToolConfigMap; secrets: ToolConfigSecretsMap } {
    const sanitized: ToolConfigMap = {};
    const secrets: ToolConfigSecretsMap = {};
    for (const [toolName, config] of Object.entries(configs)) {
        if (!config) continue;
        const settings = config.settings || {};
        const cleanedSettings: Record<string, unknown> = {};
        const secretSettings: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(settings)) {
            if (/(key|token|secret|password)/i.test(key)) {
                secretSettings[key] = value;
            } else {
                cleanedSettings[key] = value;
            }
        }
        sanitized[toolName] = { ...config, settings: cleanedSettings };
        if (Object.keys(secretSettings).length > 0) {
            secrets[toolName] = secretSettings;
        }
    }
    return { sanitized, secrets };
}

export function mergeToolConfigSecrets(configs: ToolConfigMap, secrets: ToolConfigSecretsMap): ToolConfigMap {
    const merged: ToolConfigMap = {};
    for (const [toolName, config] of Object.entries(configs)) {
        if (!config) continue;
        const secretSettings = secrets[toolName] || {};
        merged[toolName] = {
            ...config,
            settings: {
                ...config.settings,
                ...secretSettings,
            },
        };
    }
    return merged;
}

export async function getToolConfigs(): Promise<ToolConfigMap> {
    const baseConfigs = await storage.getValueOrDefault<ToolConfigMap>(STORAGE_KEYS.TOOL_CONFIGS, {} as ToolConfigMap);
    const configured = await isVaultConfigured();
    if (!configured) {
        return baseConfigs;
    }
    const secrets = await readEncryptedOrFallback<ToolConfigSecretsMap>(STORAGE_KEYS.TOOL_CONFIG_SECRETS_ENC, {});
    if (Object.keys(secrets).length === 0) {
        return baseConfigs;
    }
    return mergeToolConfigSecrets(baseConfigs, secrets);
}

export async function setToolConfigs(configs: ToolConfigMap): Promise<void> {
    const configured = await isVaultConfigured();
    if (!configured) {
        await storage.set({
            [STORAGE_KEYS.TOOL_CONFIGS]: configs,
            [STORAGE_KEYS.SETTINGS_LAST_MODIFIED]: Date.now(),
        });
        return;
    }
    const { sanitized, secrets } = splitToolConfigSecrets(configs);
    if (!isVaultUnlocked()) {
        await storage.set({
            [STORAGE_KEYS.TOOL_CONFIGS]: sanitized,
            [STORAGE_KEYS.SETTINGS_LAST_MODIFIED]: Date.now(),
        });
        return;
    }
    const encrypted = await encryptWithVault(secrets);
    await storage.set({
        [STORAGE_KEYS.TOOL_CONFIGS]: sanitized,
        [STORAGE_KEYS.TOOL_CONFIG_SECRETS_ENC]: encrypted,
        [STORAGE_KEYS.SETTINGS_LAST_MODIFIED]: Date.now(),
    });
}
