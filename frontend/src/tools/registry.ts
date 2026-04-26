import { Tool, ToolConfig, ToolExecutionResult, ToolContext } from "./types";
import { allTools, getTool } from "./index";
import { getToolConfigs, isMcpToolEnabled } from "@/lib/storage";
import { getToolContext } from "@/lib/tool-context";
import { McpServer, McpTool } from "@/lib/mcp-types";
import {
    callTool as mcpCallTool,
    mcpToolToFunctionDeclaration,
    parseMcpToolName,
    AuthRequiredError,
} from "@/lib/mcp-client";

// ============================================================================
// MCP Server Management (runtime state)
// ============================================================================

/** Connected MCP servers with their tools (runtime state) */
interface ConnectedMcpServer {
    server: McpServer;
    tools: McpTool[];
    /** OAuth metadata cached from last AuthRequiredError (for login flow) */
    authMetadata?: {
        resourceMetadataUrl?: string;
        scope?: string;
        useDirectAuthServer?: boolean;
    };
}

let connectedServers: ConnectedMcpServer[] = [];

/**
 * Register a connected MCP server and its tools
 */
export function registerMcpServer(server: McpServer, tools: McpTool[]): void {
    // Remove existing entry if reconnecting
    connectedServers = connectedServers.filter((s) => s.server.id !== server.id);
    connectedServers.push({ server, tools });
}

/**
 * Unregister an MCP server
 */
export function unregisterMcpServer(serverId: string): void {
    connectedServers = connectedServers.filter((s) => s.server.id !== serverId);
}

/**
 * Get all connected MCP servers with their tools
 */
export function getConnectedMcpServers(): ConnectedMcpServer[] {
    return connectedServers;
}

/**
 * Find a connected server by sanitized ID (hyphens replaced with underscores)
 */
function findServerByIdPrefix(sanitizedId: string): ConnectedMcpServer | undefined {
    return connectedServers.find(
        (s) => s.server.id.replace(/-/g, "_") === sanitizedId
    );
}

/**
 * Get cached auth metadata for a server (populated when tools/call returns 401)
 */
export function getAuthMetadata(serverId: string): {
    resourceMetadataUrl?: string;
    scope?: string;
    useDirectAuthServer?: boolean;
} | undefined {
    const entry = connectedServers.find((s) => s.server.id === serverId);
    return entry?.authMetadata;
}

// ============================================================================
// Local Tool Functions
// ============================================================================

/**
 * Get all local tools with their current configuration (merged with defaults)
 */
export async function getToolsWithConfig(): Promise<
    Array<{ tool: Tool; config: ToolConfig }>
> {
    const userConfigs = await getToolConfigs();

    return allTools.map((tool) => {
        const userConfig = userConfigs[tool.name];

        return {
            tool,
            config: {
                enabled: userConfig?.enabled ?? tool.enabledByDefault,
                settings: {
                    ...tool.defaultConfig,
                    ...(userConfig?.settings || {}),
                },
            },
        };
    });
}

// ============================================================================
// Combined Tool Declarations (Local + MCP)
// ============================================================================

/**
 * Get all enabled tool declarations for Gemini (local + MCP)
 */
export async function getEnabledToolDeclarations() {
    const declarations: unknown[] = [];

    // 1. Local tools
    const toolsWithConfig = await getToolsWithConfig();
    for (const { tool, config } of toolsWithConfig) {
        if (config.enabled) {
            declarations.push(tool.schema);
        }
    }

    // 2. MCP tools from connected servers
    for (const { server, tools } of connectedServers) {
        for (const tool of tools) {
            const enabled = await isMcpToolEnabled(server.id, tool.name);
            if (enabled) {
                declarations.push(mcpToolToFunctionDeclaration(tool, server.id));
            }
        }
    }

    return declarations;
}

// ============================================================================
// Tool Execution (Local + MCP)
// ============================================================================

/**
 * Execute a tool by name with the given arguments
 * Routes to local or MCP execution based on tool name prefix
 */
export async function executeTool(
    toolName: string,
    args: Record<string, unknown>,
    context?: ToolContext
): Promise<ToolExecutionResult> {
    // Check if this is an MCP tool (prefixed with mcp_<serverId>_)
    const mcpInfo = parseMcpToolName(toolName);

    if (mcpInfo) {
        return executeMcpTool(mcpInfo.serverId, mcpInfo.toolName, args);
    }

    // Otherwise, execute local tool
    return executeLocalTool(toolName, args, context);
}

/**
 * Execute a local tool
 */
async function executeLocalTool(
    toolName: string,
    args: Record<string, unknown>,
    context?: ToolContext
): Promise<ToolExecutionResult> {
    const tool = getTool(toolName);

    if (!tool) {
        return {
            success: false,
            error: `Tool '${toolName}' not found`,
        };
    }

    // Get merged config
    const userConfigs = await getToolConfigs();
    const userConfig = userConfigs[tool.name];

    const mergedSettings = {
        ...tool.defaultConfig,
        ...(userConfig?.settings || {}),
    };

    // Check if tool is enabled
    const enabled = userConfig?.enabled ?? tool.enabledByDefault;
    if (!enabled) {
        return {
            success: false,
            error: `Tool '${toolName}' ist deaktiviert`,
        };
    }

    // Use provided context or fall back to global context
    const effectiveContext = context ?? getToolContext();

    // Execute the tool with context
    return tool.execute(args, mergedSettings, effectiveContext);
}

/**
 * Execute an MCP tool
 */
async function executeMcpTool(
    serverIdPrefix: string,
    toolName: string,
    args: Record<string, unknown>
): Promise<ToolExecutionResult> {
    const connected = findServerByIdPrefix(serverIdPrefix);

    if (!connected) {
        return {
            success: false,
            error: `MCP server not connected`,
        };
    }

    // Check if enabled
    const enabled = await isMcpToolEnabled(connected.server.id, toolName);
    if (!enabled) {
        return {
            success: false,
            error: `Tool '${toolName}' ist deaktiviert`,
        };
    }

    try {
        const result = await mcpCallTool(connected.server, toolName, args);

        if (result.isError) {
            // Extract error message from content
            const errorText = result.content
                .filter((c) => c.type === "text")
                .map((c) => (c as { type: "text"; text: string }).text)
                .join("\n");

            return {
                success: false,
                error: errorText || "MCP tool error",
            };
        }

        // Process different content types
        const { addFile } = await import("@/lib/file-store");
        const textParts: string[] = [];
        const imageRefs: string[] = [];

        for (const content of result.content) {
            if (content.type === "text") {
                textParts.push((content as { type: "text"; text: string }).text);
            } else if (content.type === "image") {
                // Store image in file-store and return reference
                const imgContent = content as { type: "image"; data: string; mimeType: string };
                const dataUrl = `data:${imgContent.mimeType};base64,${imgContent.data}`;
                const fileId = addFile(dataUrl, `generated-image.${imgContent.mimeType.split('/')[1] || 'png'}`);
                imageRefs.push(fileId);
            }
        }

        // Build response for LLM
        if (imageRefs.length > 0) {
            // For images, return file references that LLM can use in markdown
            const imageText = imageRefs.length === 1
                ? `Generated image saved. Use this reference to display: ${imageRefs[0]}`
                : `Generated ${imageRefs.length} images. References: ${imageRefs.join(', ')}`;

            return {
                success: true,
                data: textParts.length > 0
                    ? `${textParts.join('\n')}\n\n${imageText}`
                    : imageText,
            };
        }

        // Text-only response
        return {
            success: true,
            data: textParts.join('\n') || result.content,
        };
    } catch (error) {
        // Check for auth-required error (lazy auth)
        if (error instanceof AuthRequiredError) {
            // Cache auth metadata for the login flow
            if (connected) {
                connected.authMetadata = {
                    resourceMetadataUrl: error.resourceMetadataUrl,
                    scope: error.scope,
                    useDirectAuthServer: error.useDirectAuthServer,
                };
            }
            return {
                success: false,
                error: "Authentication required. Please log in to use this tool.",
                authRequired: true,
                serverId: connected.server.id,
            };
        }
        return {
            success: false,
            error: error instanceof Error ? error.message : "MCP tool execution failed",
        };
    }
}

