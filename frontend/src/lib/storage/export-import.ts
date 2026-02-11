import { LLMProvider, LLMApiKeys, LLMModels } from "../llm-types";
import { ToolConfigMap } from "@/tools/types";
import { McpToolStatesMap } from "../mcp-types";
import {
    isVaultUnlocked,
    getVaultKeyHash,
    getVaultMeta,
    encryptWithVault,
    decryptWithVault,
    decryptWithExternalVaultParams,
} from "../vault";
import { getProvider, setProvider, getApiKeys, setApiKeys, getModels, setModels, getCustomBaseUrl, setCustomBaseUrl } from "./provider-config";
import { getSystemPrompts, setSystemPrompts, getSelectedSystemPromptId, setSelectedSystemPromptId } from "./system-prompts";
import type { SystemPrompt } from "./system-prompts";
import { getDebugMode, setDebugMode } from "./ui-settings";
import { getToolConfigs, setToolConfigs, splitToolConfigSecrets, mergeToolConfigSecrets } from "./tool-configs";
import type { ToolConfigSecretsMap } from "./tool-configs";
import { getMcpServers, setMcpServers, getMcpProxyConfig, setMcpProxyConfig, getLangfuseConfig, setLangfuseConfig, getPromptVariables, setPromptVariables } from "./integrations";
import type { LangfuseConfig, PromptVariable } from "./integrations";
import { getCloudConfig, setCloudConfig } from "./cloud";
import { getMcpToolStates, setMcpToolStates } from "./mcp-tools";

// ============================================================================
// Config Export/Import
// ============================================================================

export interface ExportedConfig {
    version: number;
    exportedAt: string;
    provider: LLMProvider;
    models: LLMModels;
    customBaseUrl: string;
    systemPrompts: SystemPrompt[];
    selectedPromptId: string | null;
    debugMode: boolean;
    langfuseConfig: {
        enabled: boolean;
        host: string;
    };
    promptVariables: PromptVariable[];
    mcpProxyConfig: {
        enabled: boolean;
        url: string;
    };
    toolConfigs: ToolConfigMap;
    mcpServers: Array<{
        id: string;
        url: string;
        name: string;
        description?: string;
    }>;
    mcpToolStates: McpToolStatesMap;
    syncConfig?: {
        enabled: boolean;
        serverUrl: string;
    };
    cloudConfig?: {
        enabled: boolean;
        baseUrl: string;
    };
    encryptedSecrets?: {
        vaultKeyHash: string;
        vaultMeta: {
            saltBase64: string;
            iterations: number;
        };
        payload: string;
    };
    memoryStore?: Record<string, Array<{
        key: string;
        value: string;
        createdAt: number;
        updatedAt: number;
    }>>;
}


// Note: sanitizeToolConfigs removed; splitToolConfigSecrets covers sanitization.
/**
 * Export configuration without secrets
 */
export async function exportConfig(): Promise<ExportedConfig> {
    // Dynamic import to avoid circular dependencies
    const { getSyncSettings } = await import('../sync-service');
    const { getMemoryStore } = await import('../memory-store');

    const [provider, models, customBaseUrl, systemPrompts, selectedPromptId, debugMode, langfuseConfig, promptVariables, mcpProxyConfig, toolConfigs, mcpServers, mcpToolStates, syncSettings, memoryStore, cloudConfig] = await Promise.all([
        getProvider(),
        getModels(),
        getCustomBaseUrl(),
        getSystemPrompts(),
        getSelectedSystemPromptId(),
        getDebugMode(),
        getLangfuseConfig(),
        getPromptVariables(),
        getMcpProxyConfig(),
        getToolConfigs(),
        getMcpServers(),
        getMcpToolStates(),
        getSyncSettings(),
        getMemoryStore(),
        getCloudConfig(),
    ]);

    const vaultKeyHash = await getVaultKeyHash();
    const vaultMeta = await getVaultMeta();
    if (!vaultKeyHash || !vaultMeta || !isVaultUnlocked()) {
        throw new Error("Vault is locked");
    }

    const { sanitized: sanitizedToolConfigs, secrets: toolConfigSecrets } = splitToolConfigSecrets(toolConfigs);
    const serverTokens: Record<string, string> = {};
    for (const server of mcpServers) {
        if (server.authToken) {
            serverTokens[server.id] = server.authToken;
        }
    }
    const encryptedSecrets = await encryptWithVault({
        apiKeys: await getApiKeys(),
        langfuseSecrets: { publicKey: langfuseConfig.publicKey, secretKey: langfuseConfig.secretKey },
        mcpProxyApiKey: mcpProxyConfig.apiKey || "",
        mcpServerTokens: serverTokens,
        toolConfigSecrets,
        syncApiKey: syncSettings.apiKey || "",
        cloudApiKey: cloudConfig.apiKey || "",
    });

    return {
        version: 10,
        exportedAt: new Date().toISOString(),
        provider,
        models,
        customBaseUrl,
        systemPrompts,
        selectedPromptId,
        debugMode,
        langfuseConfig: {
            enabled: langfuseConfig.enabled,
            host: langfuseConfig.host,
        },
        promptVariables,
        mcpProxyConfig: {
            enabled: mcpProxyConfig.enabled,
            url: mcpProxyConfig.url,
        },
        toolConfigs: sanitizedToolConfigs,
        mcpServers: mcpServers.map(({ id, url, name, description }) => ({
            id,
            url,
            name,
            description,
        })),
        mcpToolStates,
        syncConfig: {
            enabled: syncSettings.enabled,
            serverUrl: syncSettings.serverUrl,
        },
        encryptedSecrets: {
            vaultKeyHash,
            vaultMeta: {
                saltBase64: vaultMeta.saltBase64,
                iterations: vaultMeta.iterations,
            },
            payload: encryptedSecrets,
        },
        memoryStore,
        cloudConfig: {
            enabled: cloudConfig.enabled,
            baseUrl: cloudConfig.baseUrl,
        },
    };
}

/**
 * Import configuration from exported data.
 * Supports cross-device import: if the vault key is the same but salt differs,
 * we decrypt using the export's vault parameters and re-encrypt with local vault.
 *
 * @param config - The exported configuration
 * @param vaultKey - Optional vault key for cross-device import when salts differ
 */
export async function importConfig(config: ExportedConfig, vaultKey?: string): Promise<void> {
    if (config.version !== 9 && config.version !== 10) {
        throw new Error("Invalid or unsupported config version");
    }

    console.log("[import] Starting import, version:", config.version, "hasVaultKey:", !!vaultKey);

    // Dynamic import to avoid circular dependencies
    const { saveSyncSettings, getSyncSettings } = await import('../sync-service');

    let mergedToolConfigs = config.toolConfigs;
    let mergedMcpServers = config.mcpServers;
    let langfuseSecrets: Pick<LangfuseConfig, "publicKey" | "secretKey"> | null = null;
    let apiKeys: LLMApiKeys | null = null;
    let mcpProxyApiKey = "";
    let syncApiKey = "";

    if (config.encryptedSecrets) {
        console.log("[import] Has encrypted secrets, vault unlocked:", isVaultUnlocked());
        if (!isVaultUnlocked()) {
            throw new Error("Vault is locked");
        }

        const currentHash = await getVaultKeyHash();
        const hashMatches = currentHash === config.encryptedSecrets.vaultKeyHash;
        console.log("[import] Hash matches:", hashMatches, "currentHash:", currentHash?.slice(0, 10), "exportHash:", config.encryptedSecrets.vaultKeyHash.slice(0, 10));

        type DecryptedSecrets = {
            apiKeys: LLMApiKeys;
            langfuseSecrets: Pick<LangfuseConfig, "publicKey" | "secretKey">;
            mcpProxyApiKey: string;
            mcpServerTokens: Record<string, string>;
            toolConfigSecrets: ToolConfigSecretsMap;
            syncApiKey?: string;
            cloudApiKey?: string;
        };

        let decrypted: DecryptedSecrets;

        if (hashMatches) {
            // Same vault configuration - use normal decryption
            console.log("[import] Using same-vault decryption");
            decrypted = await decryptWithVault<DecryptedSecrets>(config.encryptedSecrets.payload);
        } else if (config.version >= 10 && config.encryptedSecrets.vaultMeta && vaultKey) {
            // Different salt but same key - use external vault params to decrypt
            // This enables cross-device import
            console.log("[import] Using cross-device decryption with external vault params");
            decrypted = await decryptWithExternalVaultParams<DecryptedSecrets>(
                config.encryptedSecrets.payload,
                {
                    saltBase64: config.encryptedSecrets.vaultMeta.saltBase64,
                    iterations: config.encryptedSecrets.vaultMeta.iterations,
                    keyHashBase64: config.encryptedSecrets.vaultKeyHash,
                },
                vaultKey
            );
        } else if (!hashMatches && config.version < 10) {
            throw new Error("Export from older version - please re-export from current version");
        } else {
            throw new Error("Security key does not match export. Provide the vault key for cross-device import.");
        }

        console.log("[import] Decryption successful, has apiKeys:", !!decrypted.apiKeys);
        apiKeys = decrypted.apiKeys;
        langfuseSecrets = decrypted.langfuseSecrets;
        mcpProxyApiKey = decrypted.mcpProxyApiKey;
        syncApiKey = decrypted.syncApiKey || "";
        mergedToolConfigs = mergeToolConfigSecrets(config.toolConfigs, decrypted.toolConfigSecrets);
        mergedMcpServers = config.mcpServers.map((server) => ({
            ...server,
            authToken: decrypted.mcpServerTokens[server.id],
        }));
    }

    console.log("[import] Saving config settings...");

    // Read current values for merging (best-effort: may fail if old encrypted data
    // exists from a previous vault installation with a different key)
    let currentLangfuseConfig: Awaited<ReturnType<typeof getLangfuseConfig>> | null = null;
    let currentMcpProxyConfig: Awaited<ReturnType<typeof getMcpProxyConfig>> | null = null;
    let currentSyncSettings: Awaited<ReturnType<typeof getSyncSettings>> | null = null;
    try {
        [currentLangfuseConfig, currentMcpProxyConfig, currentSyncSettings] = await Promise.all([
            getLangfuseConfig(),
            getMcpProxyConfig(),
            getSyncSettings(),
        ]);
    } catch (e) {
        console.warn("[import] Could not read current config (stale encrypted data?), using export values only:", e);
    }

    await Promise.all([
        setProvider(config.provider),
        setModels(config.models),
        setToolConfigs(mergedToolConfigs),
        setMcpServers(mergedMcpServers),
        setMcpToolStates(config.mcpToolStates),
        setDebugMode(config.debugMode),
        setLangfuseConfig({
            ...(currentLangfuseConfig || {}),
            enabled: config.langfuseConfig.enabled,
            host: config.langfuseConfig.host,
            publicKey: langfuseSecrets?.publicKey ?? currentLangfuseConfig?.publicKey ?? "",
            secretKey: langfuseSecrets?.secretKey ?? currentLangfuseConfig?.secretKey ?? "",
        }),
        setMcpProxyConfig({
            ...(currentMcpProxyConfig || {}),
            enabled: config.mcpProxyConfig.enabled,
            url: config.mcpProxyConfig.url,
            apiKey: mcpProxyApiKey || currentMcpProxyConfig?.apiKey || "",
        }),
    ]);
    if (apiKeys) {
        await setApiKeys(apiKeys);
    }
    await setSystemPrompts(config.systemPrompts);
    await setSelectedSystemPromptId(config.selectedPromptId);
    await setPromptVariables(config.promptVariables);
    await setCustomBaseUrl(config.customBaseUrl);

    // Import sync settings if present
    if (config.syncConfig) {
        await saveSyncSettings({
            ...(currentSyncSettings || {}),
            enabled: config.syncConfig.enabled,
            serverUrl: config.syncConfig.serverUrl,
            apiKey: syncApiKey || currentSyncSettings?.apiKey || "",
            lastSync: currentSyncSettings?.lastSync ?? null,
        });
    }

    // Import memory store if present
    if (config.memoryStore) {
        const { setMemoryStore } = await import('../memory-store');
        await setMemoryStore(config.memoryStore);
    }

    // Import cloud config if present
    if (config.cloudConfig) {
        const decryptedCloudApiKey = (config.encryptedSecrets && apiKeys) ? syncApiKey : "";
        await setCloudConfig({
            enabled: config.cloudConfig.enabled,
            baseUrl: config.cloudConfig.baseUrl,
            apiKey: decryptedCloudApiKey,
        });
    }
}
