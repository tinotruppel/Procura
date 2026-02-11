import { McpToolStatesMap } from "../mcp-types";
import { storage } from "./adapter";
import { STORAGE_KEYS } from "./keys";

// ============================================================================
// MCP Tool States Storage
// ============================================================================

export async function getMcpToolStates(): Promise<McpToolStatesMap> {
    return storage.getValueOrDefault<McpToolStatesMap>(STORAGE_KEYS.MCP_TOOL_STATES, {} as McpToolStatesMap);
}

export async function setMcpToolStates(states: McpToolStatesMap): Promise<void> {
    await storage.set({
        [STORAGE_KEYS.MCP_TOOL_STATES]: states,
        [STORAGE_KEYS.SETTINGS_LAST_MODIFIED]: Date.now(),
    });
}

/**
 * Get the enabled state for a specific MCP tool
 */
export function getMcpToolKey(serverId: string, toolName: string): string {
    return `${serverId}:${toolName}`;
}

export async function isMcpToolEnabled(serverId: string, toolName: string): Promise<boolean> {
    const states = await getMcpToolStates();
    const key = getMcpToolKey(serverId, toolName);
    // Default to enabled
    return states[key]?.enabled ?? true;
}

export async function setMcpToolEnabled(
    serverId: string,
    toolName: string,
    enabled: boolean
): Promise<void> {
    const states = await getMcpToolStates();
    const key = getMcpToolKey(serverId, toolName);
    states[key] = { enabled };
    await setMcpToolStates(states);
}
