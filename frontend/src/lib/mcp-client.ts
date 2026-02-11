/**
 * MCP (Model Context Protocol) Client
 * Implements the client side of the MCP protocol for remote tool servers.
 */

import {
    McpServer,
    McpTool,
    McpToolResult,
    JsonRpcRequest,
    JsonRpcResponse,
    InitializeParams,
    InitializeResult,
    ToolsListParams,
    ToolsListResult,
    ToolsCallParams,
    McpClientInfo,
} from "./mcp-types";
import { getMcpProxyConfig, McpProxyConfig } from "@/lib/storage";
import { getFile } from "@/lib/file-store";

const MCP_PROTOCOL_VERSION = "2024-11-05";

const CLIENT_INFO: McpClientInfo = {
    name: "Procura",
    version: "0.1.0",
};
// ============================================================================
// File Reference Resolution
// ============================================================================

/**
 * Resolve file references in tool arguments.
 * Converts file references (file_xxx) to fileData/fileName/mimeType for MCP servers.
 * 
 * Checks both:
 * - fileRef parameter (recommended way for LLMs to reference files)
 * - fileData parameter (if LLM put reference directly into the data field)
 * 
 * This allows LLMs to reference files without generating base64 themselves.
 */
export function resolveFileReferences(args: Record<string, unknown>): Record<string, unknown> {
    const resolved = { ...args };

    // Helper to resolve a file reference to base64 data
    const resolveRef = (ref: string): { fileData: string; fileName: string; mimeType: string } | null => {
        const file = getFile(ref);
        if (!file) return null;

        // Extract pure base64 from data URL (data:mime;base64,XXXXX)
        const base64Match = /;base64,(.+)$/.exec(file.dataUrl);
        if (!base64Match) return null;

        return {
            fileData: base64Match[1],
            fileName: file.fileName,
            mimeType: file.mimeType,
        };
    };

    // Check for fileRef parameter (recommended: explicit file reference field)
    if (typeof resolved.fileRef === "string" && resolved.fileRef.startsWith("file_")) {
        const fileInfo = resolveRef(resolved.fileRef);
        if (fileInfo) {
            resolved.fileData = fileInfo.fileData;
            resolved.fileName = fileInfo.fileName;
            resolved.mimeType = fileInfo.mimeType;
        }
        // Remove fileRef - server uses fileData instead
        delete resolved.fileRef;
    }
    // Also check fileData itself (fallback: LLM put reference directly in data field)
    else if (typeof resolved.fileData === "string" && resolved.fileData.startsWith("file_")) {
        const fileInfo = resolveRef(resolved.fileData);
        if (fileInfo) {
            resolved.fileData = fileInfo.fileData;
            resolved.fileName = resolved.fileName ?? fileInfo.fileName;
            resolved.mimeType = resolved.mimeType ?? fileInfo.mimeType;
        }
    }

    return resolved;
}

// ============================================================================
// Auth Error
// ============================================================================

/**
 * Error thrown when MCP server requires authentication
 */
export class AuthRequiredError extends Error {
    resourceMetadataUrl?: string;
    scope?: string;
    /** If true, resourceMetadataUrl points directly to auth server metadata (not resource metadata) */
    useDirectAuthServer?: boolean;

    constructor(message: string) {
        super(message);
        this.name = "AuthRequiredError";
    }
}

/**
 * Generate a unique request ID
 */
let requestIdCounter = 0;
function nextRequestId(): number {
    return ++requestIdCounter;
}

/**
 * Generate a unique server ID
 */
export function generateServerId(): string {
    return crypto.randomUUID();
}

/**
 * Build MCP protocol headers for a server request
 */
function buildMcpHeaders(server: McpServer): Record<string, string> {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
    };

    if (server.authToken) {
        headers["Authorization"] = `Bearer ${server.authToken}`;
    }

    if (server.sessionId) {
        headers["Mcp-Session-Id"] = server.sessionId;
    }

    return headers;
}

/**
 * Send a fetch request to an MCP server, routing through proxy if enabled
 */
async function sendMcpFetch(
    server: McpServer,
    payload: object,
    proxyConfig?: McpProxyConfig
): Promise<Response> {
    const mcpHeaders = buildMcpHeaders(server);
    const useProxy = proxyConfig?.enabled && proxyConfig?.url;

    if (useProxy) {
        const proxyHeaders: Record<string, string> = {
            "Content-Type": "application/json",
        };

        if (proxyConfig.apiKey) {
            proxyHeaders["Authorization"] = `Bearer ${proxyConfig.apiKey}`;
        }

        return fetch(proxyConfig.url, {
            method: "POST",
            headers: proxyHeaders,
            body: JSON.stringify({
                targetUrl: server.url,
                body: payload,
                headers: mcpHeaders,
            }),
        });
    }

    return fetch(server.url, {
        method: "POST",
        headers: mcpHeaders,
        body: JSON.stringify(payload),
    });
}

/**
 * Send a JSON-RPC request to an MCP server
 * If proxy is enabled in settings, requests are routed through the backend proxy to bypass CORS
 */
async function sendRequest<T>(
    server: McpServer,
    method: string,
    params?: object,
    proxyConfig?: McpProxyConfig
): Promise<T> {
    const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: nextRequestId(),
        method,
        params: params as Record<string, unknown> | undefined,
    };

    const response = await sendMcpFetch(server, request, proxyConfig);

    if (!response.ok) {
        if (response.status === 401) {
            // Parse WWW-Authenticate header for OAuth info
            const wwwAuth = response.headers.get("WWW-Authenticate");
            const authError = new AuthRequiredError("Authentication required");

            if (wwwAuth) {
                // Extract resource_metadata URL (RFC9728)
                const resourceMatch = /resource_metadata="([^"]+)"/.exec(wwwAuth);
                if (resourceMatch) {
                    authError.resourceMetadataUrl = resourceMatch[1];
                }
                // Extract scope
                const scopeMatch = /scope="([^"]+)"/.exec(wwwAuth);
                if (scopeMatch) {
                    authError.scope = scopeMatch[1];
                }
            }

            // Fallback: If no resource_metadata, construct well-known URL
            // Many servers (like Atlassian) use .well-known/oauth-authorization-server
            if (!authError.resourceMetadataUrl) {
                try {
                    const serverOrigin = new URL(server.url).origin;
                    authError.resourceMetadataUrl = `${serverOrigin}/.well-known/oauth-authorization-server`;
                    authError.useDirectAuthServer = true; // Flag to skip resource metadata fetch
                } catch {
                    // URL parsing failed, leave without fallback
                }
            }

            throw authError;
        }
        if (response.status === 403) {
            throw new Error("Access denied");
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Check for session ID in response
    const sessionId = response.headers.get("Mcp-Session-Id");
    if (sessionId && !server.sessionId) {
        server.sessionId = sessionId;
    }

    const contentType = response.headers.get("Content-Type") || "";

    if (contentType.includes("text/event-stream")) {
        // Handle SSE response - read until we get the final result
        return await handleSseResponse<T>(response);
    }

    // Handle JSON response
    const jsonResponse: JsonRpcResponse = await response.json();

    if (jsonResponse.error) {
        throw new Error(jsonResponse.error.message || "MCP error");
    }

    return jsonResponse.result as T;
}

/**
 * Handle Server-Sent Events response
 */
async function handleSseResponse<T>(response: Response): Promise<T> {
    const reader = response.body?.getReader();
    if (!reader) {
        throw new Error("No response body available");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let result: T | undefined;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
            if (line.startsWith("data: ")) {
                const data = line.slice(6);
                if (data) {
                    try {
                        const jsonResponse: JsonRpcResponse = JSON.parse(data);
                        if (jsonResponse.error) {
                            throw new Error(jsonResponse.error.message || "MCP error");
                        }
                        if (jsonResponse.result !== undefined) {
                            result = jsonResponse.result as T;
                        }
                    } catch (e) {
                        // Ignore parse errors for non-JSON lines
                        if (e instanceof SyntaxError) continue;
                        throw e;
                    }
                }
            }
        }
    }

    if (result === undefined) {
        throw new Error("No response received from server");
    }

    return result;
}

/**
 * Initialize connection to an MCP server
 */
export async function connectToServer(url: string, authToken?: string): Promise<McpServer> {
    const server: McpServer = {
        id: generateServerId(),
        url,
        name: new URL(url).hostname,
        status: "connecting",
        authToken,
    };

    try {
        // Load proxy configuration
        const proxyConfig = await getMcpProxyConfig();

        const params: InitializeParams = {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: CLIENT_INFO,
        };

        const result = await sendRequest<InitializeResult>(server, "initialize", params, proxyConfig);

        // Send initialized notification
        await sendNotification(server, "notifications/initialized", undefined, proxyConfig);

        server.status = "connected";
        server.capabilities = result.capabilities;
        server.serverInfo = result.serverInfo;
        server.name = result.serverInfo.title || result.serverInfo.name;
        server.description = result.serverInfo.description;

        return server;
    } catch (error) {
        server.status = "error";
        server.error = error instanceof Error ? error.message : "Connection failed";
        throw error;
    }
}

/**
 * Send a notification (no response expected)
 * If proxy is enabled in settings, requests are routed through the backend proxy to bypass CORS
 */
async function sendNotification(
    server: McpServer,
    method: string,
    params?: Record<string, unknown>,
    proxyConfig?: McpProxyConfig
): Promise<void> {
    const notification = {
        jsonrpc: "2.0",
        method,
        params,
    };

    const response = await sendMcpFetch(server, notification, proxyConfig);

    // Notifications should return 202 Accepted
    if (!response.ok && response.status !== 202) {
        console.warn(`Notification ${method} returned ${response.status}`);
    }
}

/**
 * List all tools from an MCP server
 */
export async function listTools(server: McpServer): Promise<McpTool[]> {
    if (server.status !== "connected") {
        throw new Error("Server not connected");
    }

    // Load proxy configuration
    const proxyConfig = await getMcpProxyConfig();

    const allTools: McpTool[] = [];
    let cursor: string | undefined;

    // Handle pagination
    do {
        const params: ToolsListParams = cursor ? { cursor } : {};
        const result = await sendRequest<ToolsListResult>(server, "tools/list", params, proxyConfig);

        allTools.push(...result.tools);
        cursor = result.nextCursor;
    } while (cursor);

    return allTools;
}

/**
 * Call a tool on an MCP server
 */
export async function callTool(
    server: McpServer,
    toolName: string,
    args: Record<string, unknown>
): Promise<McpToolResult> {
    if (server.status !== "connected") {
        throw new Error("Server not connected");
    }

    // Load proxy configuration
    const proxyConfig = await getMcpProxyConfig();

    // Resolve file references (fileRef -> fileData/fileName/mimeType)
    const resolvedArgs = resolveFileReferences(args);

    const params: ToolsCallParams = {
        name: toolName,
        arguments: resolvedArgs,
    };

    return await sendRequest<McpToolResult>(server, "tools/call", params, proxyConfig);
}

/**
 * Disconnect from an MCP server (cleanup)
 */
export function disconnectServer(server: McpServer): void {
    server.status = "disconnected";
    server.sessionId = undefined;
}

// ============================================================================
// MCP Initialization (for app startup)
// ============================================================================

// Track if MCP servers have been initialized
let mcpInitialized = false;

/**
 * Initialize all saved MCP servers and register their tools.
 * Should be called on app startup to ensure MCP tools are available for deep links.
 * Returns immediately if already initialized.
 */
export async function initializeMcpServers(): Promise<void> {
    if (mcpInitialized) {
        return;
    }

    // Lazy import to avoid circular dependency
    const { getMcpServers } = await import("@/lib/storage");
    const { registerMcpServer } = await import("@/tools/registry");

    try {
        const savedServers = await getMcpServers();

        // Connect to each saved server in parallel
        const connections = savedServers.map(async (saved) => {
            try {
                const server = await connectToServer(saved.url, saved.authToken);
                // Keep original ID
                server.id = saved.id;
                const tools = await listTools(server);
                registerMcpServer(server, tools);
                console.log("[MCP] Connected to", saved.name || saved.url, "-", tools.length, "tools");
            } catch (error) {
                console.warn("[MCP] Failed to connect to", saved.name || saved.url, error);
                // Don't block - server might need auth or be unavailable
            }
        });

        await Promise.all(connections);
        mcpInitialized = true;
        console.log("[MCP] Initialization complete");
    } catch (error) {
        console.error("[MCP] Failed to initialize servers:", error);
    }
}

/**
 * Sanitize MCP JSON Schema for Gemini FunctionDeclaration.
 * Removes fields that Gemini doesn't understand.
 */
function sanitizeSchemaForGemini(schema: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    // Fields that Gemini doesn't support
    const unsupportedFields = new Set([
        "$schema",
        "additionalProperties",
        "$id",
        "$ref",
        "$defs",
        "definitions",
        "examples",
        "default", // Gemini doesn't support default at top level
        // Numeric constraints - not supported by Gemini
        "exclusiveMinimum",
        "exclusiveMaximum",
        "minimum",
        "maximum",
        "multipleOf",
        // String constraints - not supported by Gemini
        "minLength",
        "maxLength",
        "pattern",
        // Array constraints - not supported by Gemini  
        "minItems",
        "maxItems",
        "uniqueItems",
        // Other JSON Schema fields
        "const",
        "oneOf",
        "anyOf",
        "allOf",
        "not",
        "if",
        "then",
        "else",
        "contentMediaType",
        "contentEncoding",
    ]);

    for (const [key, value] of Object.entries(schema)) {
        if (unsupportedFields.has(key)) {
            continue; // Skip unsupported fields
        }

        if (key === "properties" && typeof value === "object" && value !== null) {
            // Recursively sanitize property definitions
            const sanitizedProps: Record<string, unknown> = {};
            for (const [propName, propValue] of Object.entries(value as Record<string, unknown>)) {
                if (typeof propValue === "object" && propValue !== null) {
                    sanitizedProps[propName] = sanitizeSchemaForGemini(propValue as Record<string, unknown>);
                } else {
                    sanitizedProps[propName] = propValue;
                }
            }
            result[key] = sanitizedProps;
        } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
            // Recursively sanitize nested objects
            result[key] = sanitizeSchemaForGemini(value as Record<string, unknown>);
        } else {
            result[key] = value;
        }
    }

    return result;
}

/**
 * Convert MCP tool to Gemini FunctionDeclaration format
 */
export function mcpToolToFunctionDeclaration(
    tool: McpTool,
    serverId: string
): { name: string; description: string; parameters: unknown } {
    // Prefix tool name with server ID to make it unique
    const sanitizedId = serverId.replace(/-/g, "_");
    const uniqueName = `mcp__${sanitizedId}__${tool.name}`;

    // Sanitize the schema to remove fields Gemini doesn't understand
    const sanitizedSchema = sanitizeSchemaForGemini(tool.inputSchema as Record<string, unknown>);

    return {
        name: uniqueName,
        description: tool.description || tool.title || tool.name,
        parameters: sanitizedSchema,
    };
}

/**
 * Parse a prefixed MCP tool name back to server ID and tool name
 */
export function parseMcpToolName(prefixedName: string): { serverId: string; toolName: string } | null {
    if (!prefixedName.startsWith("mcp__")) return null;
    const rest = prefixedName.slice(5); // Remove "mcp__" prefix
    const delimIdx = rest.indexOf("__");
    if (delimIdx <= 0) return null;
    const serverId = rest.slice(0, delimIdx);
    const toolName = rest.slice(delimIdx + 2);
    if (!serverId || !toolName) return null;
    return { serverId, toolName };
}
