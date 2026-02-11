/**
 * Sync Service
 * 
 * High-level sync orchestration that integrates with the storage layer.
 * Handles the full sync workflow: pull changes, push changes, resolve conflicts.
 */

import { SyncClient, deriveKeys } from './sync-client';
import {
    getSyncMasterKey,
    isVaultUnlocked,
} from './vault';
import { LLMProvider, LLMApiKeys, LLMModels } from './llm-types';
import { ToolConfigMap } from '@/tools/types';
import { McpToolStatesMap } from './mcp-types';
import {
    storage,
    STORAGE_KEYS,
    getChatSessions,
    setChatSessions,
    ChatSession,
    getApiKeys,
    getModels,
    getProvider,
    getToolConfigs,
    getSettingsLastModified,
    getCustomBaseUrl,
    getDebugMode,
    getSystemPrompts,
    SystemPrompt,
    getSelectedSystemPromptId,
    getLangfuseConfig,
    LangfuseConfig,
    getMcpServers,
    StoredMcpServer,
    getMcpToolStates,
    getPromptVariables,
    PromptVariable,
    migrateLegacySecretsToVault,
} from './storage';

// =============================================================================
// Types
// =============================================================================

export interface SyncSettings {
    enabled: boolean;
    serverUrl: string;
    apiKey: string | null;         // API key for server authentication
    lastSync: number | null;
}

export interface SyncResult {
    success: boolean;
    pulled: number;
    pushed: number;
    errors: string[];
}

interface SettingsBundle {
    provider: LLMProvider;
    apiKeys: LLMApiKeys;
    models: LLMModels;
    toolConfig: ToolConfigMap;
    customBaseUrl: string;
    debugMode: boolean;
    systemPrompts: SystemPrompt[];
    selectedSystemPromptId: string | null;
    langfuseConfig: LangfuseConfig;
    mcpServers: StoredMcpServer[];
    mcpToolStates: McpToolStatesMap;
    promptVariables: PromptVariable[];
    _lastModified: number;
}

// Storage key for sync settings
const SYNC_SETTINGS_KEY = 'procura_sync_settings';

// =============================================================================
// Sync Settings Management (stored in chrome.storage.local)
// =============================================================================

const DEFAULT_SYNC_SETTINGS: SyncSettings = {
    enabled: false,
    serverUrl: '',
    apiKey: null,
    lastSync: null,
};

export async function getSyncSettings(): Promise<SyncSettings> {
    const { platform } = await import('@/platform');
    const result = await platform.storage.get<SyncSettings>([SYNC_SETTINGS_KEY]);
    const settings = result[SYNC_SETTINGS_KEY] || DEFAULT_SYNC_SETTINGS;
    if ("masterKey" in settings) {
        const rest = { ...(settings as SyncSettings & { masterKey?: string | null }) };
        delete (rest as { masterKey?: string | null }).masterKey;
        return {
            ...DEFAULT_SYNC_SETTINGS,
            ...rest,
        };
    }
    return settings;
}

export async function saveSyncSettings(settings: SyncSettings): Promise<void> {
    const { platform } = await import('@/platform');
    await platform.storage.set({ [SYNC_SETTINGS_KEY]: settings });
}

// =============================================================================
// Setup Functions
// =============================================================================

/**
 * Enable sync using the current vault key.
 */
export async function setupNewSync(serverUrl: string, apiKey: string | null = null): Promise<void> {
    if (!isVaultUnlocked()) {
        throw new Error("Vault is locked");
    }
    const masterKey = await getSyncMasterKey();
    const client = await SyncClient.create({ serverUrl, masterKey, apiKey: apiKey || undefined });
    await client.listObjects();

    await saveSyncSettings({
        enabled: true,
        serverUrl,
        apiKey,
        lastSync: null,
    });
    await migrateLegacySecretsToVault();
}

/**
 * Connect to existing sync using the current vault key.
 * Validates the connection by attempting to list objects.
 */
export async function connectExistingSync(serverUrl: string, apiKey: string | null = null): Promise<boolean> {
    try {
        if (!isVaultUnlocked()) {
            return false;
        }
        const masterKey = await getSyncMasterKey();

        // Validate by creating client and attempting list
        const client = await SyncClient.create({ serverUrl, masterKey, apiKey: apiKey || undefined });
        await client.listObjects(); // Validate connection

        await saveSyncSettings({
            enabled: true,
            serverUrl,
            apiKey,
            lastSync: null,
        });

        return true;
    } catch (error) {
        console.error('[SyncService] Failed to connect:', error);
        return false;
    }
}

/**
 * Disable sync and clear local settings.
 */
export async function disableSync(): Promise<void> {
    await saveSyncSettings({
        enabled: false,
        serverUrl: '',
        apiKey: null,
        lastSync: null,
    });
}

// =============================================================================
// Sync Operations
// =============================================================================

/**
 * Bundle all settings into a single object for sync
 */
async function bundleSettings(): Promise<SettingsBundle> {
    const [
        provider, apiKeys, models, toolConfig, lastModified,
        customBaseUrl, debugMode, systemPrompts, selectedSystemPromptId,
        langfuseConfig, mcpServers, mcpToolStates, promptVariables
    ] = await Promise.all([
        getProvider(),
        getApiKeys(),
        getModels(),
        getToolConfigs(),
        getSettingsLastModified(),
        getCustomBaseUrl(),
        getDebugMode(),
        getSystemPrompts(),
        getSelectedSystemPromptId(),
        getLangfuseConfig(),
        getMcpServers(),
        getMcpToolStates(),
        getPromptVariables(),
    ]);

    return {
        provider,
        apiKeys,
        models,
        toolConfig,
        customBaseUrl,
        debugMode,
        systemPrompts,
        selectedSystemPromptId,
        langfuseConfig,
        mcpServers,
        mcpToolStates,
        promptVariables,
        _lastModified: lastModified,
    };
}

/**
 * Apply settings bundle from sync.
 * 
 * IMPORTANT: This writes all values in a single atomic storage.set() call
 * instead of going through individual setters. This is critical because each
 * setter would write SETTINGS_LAST_MODIFIED: Date.now(), creating a race
 * condition: if sync crashes between the setter calls and the final timestamp
 * override, the local timestamp would be artificially inflated (Date.now()),
 * making local data appear "newer" than remote and preventing future pulls.
 */
async function applySettingsBundle(bundle: SettingsBundle): Promise<void> {
    await storage.set({
        [STORAGE_KEYS.PROVIDER]: bundle.provider,
        [STORAGE_KEYS.API_KEYS]: bundle.apiKeys,
        [STORAGE_KEYS.MODELS]: bundle.models,
        [STORAGE_KEYS.TOOL_CONFIGS]: bundle.toolConfig,
        [STORAGE_KEYS.CUSTOM_BASE_URL]: bundle.customBaseUrl,
        [STORAGE_KEYS.DEBUG_MODE]: bundle.debugMode,
        [STORAGE_KEYS.SYSTEM_PROMPTS]: bundle.systemPrompts,
        [STORAGE_KEYS.SELECTED_PROMPT_ID]: bundle.selectedSystemPromptId,
        [STORAGE_KEYS.LANGFUSE_CONFIG]: bundle.langfuseConfig,
        [STORAGE_KEYS.MCP_SERVERS]: bundle.mcpServers,
        [STORAGE_KEYS.MCP_TOOL_STATES]: bundle.mcpToolStates,
        [STORAGE_KEYS.PROMPT_VARIABLES]: bundle.promptVariables,
        [STORAGE_KEYS.SETTINGS_LAST_MODIFIED]: bundle._lastModified,
    });
}

/**
 * Perform a full sync: pull remote changes, push local changes.
 */
export async function performSync(): Promise<SyncResult> {
    const settings = await getSyncSettings();

    if (!settings.enabled) {
        return { success: false, pulled: 0, pushed: 0, errors: ['Sync not enabled'] };
    }
    if (!isVaultUnlocked()) {
        return { success: false, pulled: 0, pushed: 0, errors: ['Vault is locked'] };
    }

    const result: SyncResult = { success: true, pulled: 0, pushed: 0, errors: [] };

    try {
        const masterKey = await getSyncMasterKey();
        const client = await SyncClient.create({
            serverUrl: settings.serverUrl,
            masterKey,
            apiKey: settings.apiKey || undefined,
        });

        // Get remote object list
        const remoteObjects = await client.listObjects();
        const remoteMap = new Map(remoteObjects.map(o => [o.objectId, o.lastModified]));

        // Get local data
        const localSettings = await bundleSettings();
        const localChats = await getChatSessions();

        // Build local object map with timestamps
        const localObjects = new Map<string, { data: unknown; lastModified: number }>();
        localObjects.set('settings', {
            data: localSettings,
            lastModified: localSettings._lastModified || 0,
        });

        for (const chat of localChats) {
            localObjects.set(`chat-${chat.id}`, {
                data: chat,
                lastModified: chat.updatedAt || chat.createdAt || 0,
            });
        }

        // Pull: remote newer than local

        for (const [objectId, remoteTime] of remoteMap) {
            const local = localObjects.get(objectId);
            const localTime = local?.lastModified || 0;


            if (remoteTime > localTime) {
                try {
                    const remoteData = await client.getObject(objectId);
                    if (remoteData) {
                        if (objectId === 'settings') {
                            await applySettingsBundle(remoteData as SettingsBundle);
                        } else if (objectId.startsWith('chat-')) {
                            // Merge chat into existing sessions
                            const existingChats = await getChatSessions();
                            const remoteChat = remoteData as ChatSession;
                            const existingIndex = existingChats.findIndex(c => c.id === remoteChat.id);
                            if (existingIndex >= 0) {
                                existingChats[existingIndex] = remoteChat;
                            } else {
                                existingChats.push(remoteChat);
                            }
                            await setChatSessions(existingChats);
                        }
                        result.pulled++;
                    }
                } catch (error) {
                    console.error('[SyncService] Pull error for', objectId, error);
                    result.errors.push(`Pull ${objectId}: ${error}`);
                }
            }
        }

        // Push: local newer than remote
        for (const [objectId, { data, lastModified }] of localObjects) {
            const remoteTime = remoteMap.get(objectId) || 0;

            if (lastModified > remoteTime) {
                try {
                    await client.putObject(objectId, data, lastModified);
                    result.pushed++;
                } catch (error) {
                    result.errors.push(`Push ${objectId}: ${error}`);
                }
            }
        }

        // Update last sync time
        await saveSyncSettings({
            ...settings,
            lastSync: Date.now(),
        });

    } catch (error) {
        result.success = false;
        result.errors.push(`Sync failed: ${error}`);
    }

    return result;
}

/**
 * Get user ID for display (full 64-char hex userId)
 */
export async function getSyncUserId(): Promise<string | null> {
    const settings = await getSyncSettings();
    if (!settings.enabled || !isVaultUnlocked()) return null;

    try {
        const masterKey = await getSyncMasterKey();
        const { userId } = await deriveKeys(masterKey);
        return userId;
    } catch {
        return null;
    }
}
