import { McpServer } from "../mcp-types";
import {
    isVaultConfigured,
    isVaultUnlocked,
    encryptWithVault,
} from "../vault";
import { storage } from "./adapter";
import { STORAGE_KEYS } from "./keys";
import { readEncryptedOrFallback } from "./vault-helper";
import { getMcpToolStates, setMcpToolStates } from "./mcp-tools";
import type { McpToolStatesMap } from "../mcp-types";

// ============================================================================
// MCP Server Storage
// ============================================================================

/**
 * Stored server data (without runtime state like 'status')
 */
export interface StoredMcpServer {
    id: string;
    url: string;
    name: string;
    description?: string;
    authToken?: string;
    /** Origin of this server: "cloud" = auto-discovered, "manual" = user-added */
    source?: "cloud" | "manual";
}

export async function getMcpServers(): Promise<StoredMcpServer[]> {
    const baseServers = await storage.getValueOrDefault<StoredMcpServer[]>(STORAGE_KEYS.MCP_SERVERS, []);
    const configured = await isVaultConfigured();
    if (!configured) {
        return baseServers;
    }
    const strippedServers = baseServers.map(({ authToken: _authToken, ...rest }) => rest);
    const tokens = await readEncryptedOrFallback<Record<string, string>>(
        STORAGE_KEYS.MCP_SERVER_TOKENS_ENC,
        {},
    );
    if (Object.keys(tokens).length === 0) {
        return strippedServers;
    }
    return baseServers.map((server) => ({
        ...server,
        authToken: tokens[server.id] || server.authToken,
    }));
}

export async function setMcpServers(servers: StoredMcpServer[]): Promise<void> {
    const configured = await isVaultConfigured();
    if (!configured) {
        await storage.set({
            [STORAGE_KEYS.MCP_SERVERS]: servers,
            [STORAGE_KEYS.SETTINGS_LAST_MODIFIED]: Date.now(),
        });
        return;
    }
    // Vault configured (SecurityGate guarantees unlocked)
    const sanitized = servers.map(({ authToken: _authToken, ...rest }) => rest);
    const tokens: Record<string, string> = {};
    for (const server of servers) {
        if (server.authToken) {
            tokens[server.id] = server.authToken;
        }
    }
    const encrypted = await encryptWithVault(tokens);
    await storage.set({
        [STORAGE_KEYS.MCP_SERVERS]: sanitized,
        [STORAGE_KEYS.MCP_SERVER_TOKENS_ENC]: encrypted,
        [STORAGE_KEYS.SETTINGS_LAST_MODIFIED]: Date.now(),
    });
}

export async function addMcpServer(server: McpServer): Promise<void> {
    const servers = await getMcpServers();
    const stored: StoredMcpServer = {
        id: server.id,
        url: server.url,
        name: server.name,
        description: server.description,
        authToken: server.authToken,
    };
    servers.push(stored);
    await setMcpServers(servers);
}

export async function removeMcpServer(serverId: string): Promise<void> {
    const servers = await getMcpServers();
    const filtered = servers.filter((s) => s.id !== serverId);
    await setMcpServers(filtered);

    // Also clean up tool states for this server
    const toolStates = await getMcpToolStates();
    const cleanedStates: McpToolStatesMap = {};
    for (const key of Object.keys(toolStates)) {
        if (!key.startsWith(`${serverId}:`)) {
            cleanedStates[key] = toolStates[key];
        }
    }
    await setMcpToolStates(cleanedStates);
}

export async function updateMcpServer(server: McpServer): Promise<void> {
    const servers = await getMcpServers();
    const index = servers.findIndex((s) => s.id === server.id);
    if (index !== -1) {
        servers[index] = {
            id: server.id,
            url: server.url,
            name: server.name,
            description: server.description,
            authToken: server.authToken,
        };
        await setMcpServers(servers);
    }
}

// ============================================================================
// MCP Proxy Configuration
// ============================================================================

export interface McpProxyConfig {
    enabled: boolean;
    url: string;
    apiKey?: string;
}

const DEFAULT_MCP_PROXY_CONFIG: McpProxyConfig = {
    enabled: false,
    url: import.meta.env.VITE_API_BASE_URL ? `${import.meta.env.VITE_API_BASE_URL}/mcp-proxy` : "",
    apiKey: "",
};

export async function getMcpProxyConfig(): Promise<McpProxyConfig> {
    const baseConfig = await storage.getValueOrDefault<McpProxyConfig>(STORAGE_KEYS.MCP_PROXY_CONFIG, DEFAULT_MCP_PROXY_CONFIG);
    const configured = await isVaultConfigured();
    if (!configured) {
        return baseConfig;
    }
    const lockedFallback = { ...baseConfig, apiKey: "" };
    const secret = await readEncryptedOrFallback<Pick<McpProxyConfig, "apiKey">>(
        STORAGE_KEYS.MCP_PROXY_CONFIG_ENC,
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

export async function setMcpProxyConfig(config: McpProxyConfig): Promise<void> {
    const configured = await isVaultConfigured();
    if (!configured) {
        await storage.set({
            [STORAGE_KEYS.MCP_PROXY_CONFIG]: config,
            [STORAGE_KEYS.SETTINGS_LAST_MODIFIED]: Date.now(),
        });
        return;
    }
    // Vault configured (SecurityGate guarantees unlocked)
    const { apiKey, ...rest } = config;
    const encrypted = await encryptWithVault({ apiKey });
    await storage.set({
        [STORAGE_KEYS.MCP_PROXY_CONFIG]: { ...DEFAULT_MCP_PROXY_CONFIG, ...rest, apiKey: "" },
        [STORAGE_KEYS.MCP_PROXY_CONFIG_ENC]: encrypted,
        [STORAGE_KEYS.SETTINGS_LAST_MODIFIED]: Date.now(),
    });
}

// ============================================================================
// Langfuse Configuration
// ============================================================================

export interface LangfuseConfig {
    enabled: boolean; // Enables both remote prompts and tracing together
    publicKey: string;
    secretKey: string;
    host: string; // default: "https://cloud.langfuse.com"
    tags?: string[]; // optional tag filter for prompt list
}

const DEFAULT_LANGFUSE_CONFIG: LangfuseConfig = {
    enabled: false,
    publicKey: "",
    secretKey: "",
    host: "https://cloud.langfuse.com",
};

export async function getLangfuseConfig(): Promise<LangfuseConfig> {
    const baseConfig = await storage.getValueOrDefault<LangfuseConfig>(STORAGE_KEYS.LANGFUSE_CONFIG, DEFAULT_LANGFUSE_CONFIG);
    const configured = await isVaultConfigured();
    if (!configured) {
        return baseConfig;
    }
    const lockedFallback = { ...baseConfig, publicKey: "", secretKey: "" };
    const secrets = await readEncryptedOrFallback<Pick<LangfuseConfig, "publicKey" | "secretKey">>(
        STORAGE_KEYS.LANGFUSE_CONFIG_ENC,
        { publicKey: "", secretKey: "" },
        { publicKey: "", secretKey: "" },
    );
    if (!secrets.publicKey && !secrets.secretKey) {
        return lockedFallback;
    }
    return {
        ...baseConfig,
        ...secrets,
    };
}

export async function setLangfuseConfig(config: LangfuseConfig): Promise<void> {
    const configured = await isVaultConfigured();
    if (!configured) {
        await storage.set({
            [STORAGE_KEYS.LANGFUSE_CONFIG]: config,
            [STORAGE_KEYS.SETTINGS_LAST_MODIFIED]: Date.now(),
        });
        return;
    }
    const { publicKey, secretKey, ...rest } = config;
    if (!isVaultUnlocked()) {
        await storage.set({
            [STORAGE_KEYS.LANGFUSE_CONFIG]: { ...DEFAULT_LANGFUSE_CONFIG, ...rest, publicKey: "", secretKey: "" },
            [STORAGE_KEYS.SETTINGS_LAST_MODIFIED]: Date.now(),
        });
        return;
    }
    const encrypted = await encryptWithVault({ publicKey, secretKey });
    await storage.set({
        [STORAGE_KEYS.LANGFUSE_CONFIG]: { ...DEFAULT_LANGFUSE_CONFIG, ...rest, publicKey: "", secretKey: "" },
        [STORAGE_KEYS.LANGFUSE_CONFIG_ENC]: encrypted,
        [STORAGE_KEYS.SETTINGS_LAST_MODIFIED]: Date.now(),
    });
}

// ============================================================================
// Prompt Variables (for Langfuse prompt template substitution)
// ============================================================================

export interface PromptVariable {
    key: string;
    value: string;
}

export async function getPromptVariables(): Promise<PromptVariable[]> {
    return storage.getValueOrDefault<PromptVariable[]>(STORAGE_KEYS.PROMPT_VARIABLES, []);
}

export async function setPromptVariables(variables: PromptVariable[]): Promise<void> {
    await storage.set({
        [STORAGE_KEYS.PROMPT_VARIABLES]: variables,
        [STORAGE_KEYS.SETTINGS_LAST_MODIFIED]: Date.now(),
    });
}
