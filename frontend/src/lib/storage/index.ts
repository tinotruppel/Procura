// Re-export facade for backward compatibility
// All existing imports from "@/lib/storage" continue to work via this barrel export
export { storage } from "./adapter";
export { STORAGE_KEYS } from "./keys";
export { readEncryptedOrFallback } from "./vault-helper";
export { getProvider, setProvider, getApiKeys, setApiKeys, getApiKeyForProvider, setApiKeyForProvider, getModels, setModels, getModelForProvider, setModelForProvider, getCustomBaseUrl, setCustomBaseUrl } from "./provider-config";
export type { ChatSession } from "./chat-sessions";
export { getChatSessions, setChatSessions, getCurrentChatId, setCurrentChatId, getCurrentChat, saveCurrentChat, switchToChat, createNewChat, forkConversation, updateChatTitleById, deleteChat, getPinnedChatsCount, toggleChatPinned } from "./chat-sessions";
export type { SystemPrompt } from "./system-prompts";
export { getSystemPrompts, setSystemPrompts, addSystemPrompt, updateSystemPrompt, deleteSystemPrompt, getSelectedSystemPromptId, setSelectedSystemPromptId, getActiveSystemPrompt } from "./system-prompts";
export type { ToolConfigSecretsMap } from "./tool-configs";
export { splitToolConfigSecrets, mergeToolConfigSecrets, getToolConfigs, setToolConfigs } from "./tool-configs";
export type { StoredMcpServer, McpProxyConfig, LangfuseConfig, PromptVariable } from "./integrations";
export { getMcpServers, setMcpServers, addMcpServer, removeMcpServer, updateMcpServer, getMcpProxyConfig, setMcpProxyConfig, getLangfuseConfig, setLangfuseConfig, getPromptVariables, setPromptVariables } from "./integrations";
export type { CloudConfig } from "./cloud";
export { getCloudConfig, setCloudConfig, getCloudSyncUrl, getCloudProxyUrl, getCloudDirectoryUrl } from "./cloud";
export { getMcpToolStates, setMcpToolStates, getMcpToolKey, isMcpToolEnabled, setMcpToolEnabled } from "./mcp-tools";
export type { Theme } from "./ui-settings";
export { getDebugMode, setDebugMode, getTheme, setTheme, applyTheme } from "./ui-settings";
export type { ExportedConfig } from "./export-import";
export { exportConfig, importConfig } from "./export-import";
export { migrateLegacySecretsToVault } from "./vault-migration";
export { getSettingsLastModified, setSettingsLastModified } from "./metadata";
export type { StorageUsageItem, StorageUsageReport } from "./debug";
export { debugStorageUsage } from "./debug";
