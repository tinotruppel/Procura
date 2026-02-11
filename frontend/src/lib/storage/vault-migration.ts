import { LLMApiKeys } from "../llm-types";
import { ToolConfigMap } from "@/tools/types";
import {
    isVaultConfigured,
    isVaultUnlocked,
} from "../vault";
import { storage } from "./adapter";
import { STORAGE_KEYS } from "./keys";
import { setApiKeys } from "./provider-config";
import { setToolConfigs } from "./tool-configs";
import { setMcpServers } from "./integrations";
import { setLangfuseConfig, setMcpProxyConfig } from "./integrations";
import type { LangfuseConfig, McpProxyConfig, StoredMcpServer } from "./integrations";

// ============================================================================
// Vault Migration (legacy plaintext -> encrypted)
// ============================================================================

export async function migrateLegacySecretsToVault(): Promise<void> {
    if (!(await isVaultConfigured()) || !isVaultUnlocked()) {
        return;
    }
    const legacyApiKeys = await storage.getValue<LLMApiKeys>(STORAGE_KEYS.API_KEYS);
    if (legacyApiKeys && Object.keys(legacyApiKeys).length > 0) {
        await setApiKeys(legacyApiKeys);
        await storage.remove(STORAGE_KEYS.API_KEYS);
    }
    const legacyLangfuse = await storage.getValue<LangfuseConfig>(STORAGE_KEYS.LANGFUSE_CONFIG);
    if (legacyLangfuse && (legacyLangfuse.publicKey || legacyLangfuse.secretKey)) {
        await setLangfuseConfig(legacyLangfuse);
    }
    const legacyProxy = await storage.getValue<McpProxyConfig>(STORAGE_KEYS.MCP_PROXY_CONFIG);
    if (legacyProxy && legacyProxy.apiKey) {
        await setMcpProxyConfig(legacyProxy);
    }
    const legacyServers = await storage.getValue<StoredMcpServer[]>(STORAGE_KEYS.MCP_SERVERS);
    if (legacyServers && legacyServers.some((s) => s.authToken)) {
        await setMcpServers(legacyServers);
    }
    const legacyToolConfigs = await storage.getValue<ToolConfigMap>(STORAGE_KEYS.TOOL_CONFIGS);
    if (legacyToolConfigs && Object.keys(legacyToolConfigs).length > 0) {
        await setToolConfigs(legacyToolConfigs);
    }
}
