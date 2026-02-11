/**
 * MCP (Model Context Protocol) Type Definitions
 * Based on https://modelcontextprotocol.io/specification/2025-11-25
 */

// ============================================================================
// JSON-RPC 2.0 Types
// ============================================================================

export interface JsonRpcRequest {
    jsonrpc: "2.0";
    id: number | string;
    method: string;
    params?: Record<string, unknown>;
}

export interface JsonRpcNotification {
    jsonrpc: "2.0";
    method: string;
    params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
    jsonrpc: "2.0";
    id: number | string | null;
    result?: unknown;
    error?: JsonRpcError;
}

export interface JsonRpcError {
    code: number;
    message: string;
    data?: unknown;
}

// ============================================================================
// MCP Server Types
// ============================================================================

export interface McpServer {
    /** Unique identifier (generated UUID) */
    id: string;
    /** Server URL endpoint */
    url: string;
    /** Display name (from server info or user-provided) */
    name: string;
    /** Description from server */
    description?: string;
    /** Authentication token (if OAuth was used) */
    authToken?: string;
    /** Current connection status */
    status: McpServerStatus;
    /** Server capabilities from initialize response */
    capabilities?: McpServerCapabilities;
    /** Server info from initialize response */
    serverInfo?: McpServerInfo;
    /** Last error message */
    error?: string;
    /** Session ID for stateful connections */
    sessionId?: string;
    /** OAuth resource metadata URL (if auth required) */
    resourceMetadataUrl?: string;
    /** Required scope from WWW-Authenticate */
    requiredScope?: string;
    /** If true, resourceMetadataUrl is direct auth server metadata URL */
    useDirectAuthServer?: boolean;
}

export type McpServerStatus =
    | "disconnected"
    | "connecting"
    | "connected"
    | "error"
    | "auth_required";

export interface McpServerInfo {
    name: string;
    title?: string;
    version: string;
    description?: string;
    websiteUrl?: string;
}

export interface McpServerCapabilities {
    tools?: {
        listChanged?: boolean;
    };
    resources?: {
        subscribe?: boolean;
        listChanged?: boolean;
    };
    prompts?: {
        listChanged?: boolean;
    };
    logging?: Record<string, unknown>;
}

// ============================================================================
// MCP Client Capabilities
// ============================================================================

export interface McpClientInfo {
    name: string;
    version: string;
}

export interface McpClientCapabilities {
    // We only need basic tool support for now
}

// ============================================================================
// MCP Tool Types
// ============================================================================

export interface McpTool {
    /** Unique tool name */
    name: string;
    /** Human-readable title */
    title?: string;
    /** Tool description */
    description?: string;
    /** JSON Schema for input parameters */
    inputSchema: McpJsonSchema;
    /** Optional icons */
    icons?: McpIcon[];
}

export interface McpJsonSchema {
    type: string;
    properties?: Record<string, McpJsonSchemaProperty>;
    required?: string[];
    additionalProperties?: boolean;
    [key: string]: unknown; // Allow other JSON Schema properties
}

export interface McpJsonSchemaProperty {
    type?: string;
    description?: string;
    enum?: string[];
    default?: unknown;
    [key: string]: unknown;
}

export interface McpIcon {
    src: string;
    mimeType?: string;
    sizes?: string[];
}

// ============================================================================
// MCP Tool Result Types
// ============================================================================

export interface McpToolResult {
    content: McpContent[];
    isError: boolean;
}

export type McpContent = McpTextContent | McpImageContent | McpResourceContent;

export interface McpTextContent {
    type: "text";
    text: string;
}

export interface McpImageContent {
    type: "image";
    data: string; // base64
    mimeType: string;
}

export interface McpResourceContent {
    type: "resource";
    resource: {
        uri: string;
        mimeType?: string;
        text?: string;
        blob?: string;
    };
}

// ============================================================================
// MCP Protocol Messages
// ============================================================================

export interface InitializeParams {
    protocolVersion: string;
    capabilities: McpClientCapabilities;
    clientInfo: McpClientInfo;
}

export interface InitializeResult {
    protocolVersion: string;
    capabilities: McpServerCapabilities;
    serverInfo: McpServerInfo;
    instructions?: string;
}

export interface ToolsListParams {
    cursor?: string;
}

export interface ToolsListResult {
    tools: McpTool[];
    nextCursor?: string;
}

export interface ToolsCallParams {
    name: string;
    arguments?: Record<string, unknown>;
}

// ============================================================================
// Storage Types
// ============================================================================

export interface McpToolState {
    /** Whether the tool is enabled */
    enabled: boolean;
}

/** Maps "serverId:toolName" to tool state */
export type McpToolStatesMap = Record<string, McpToolState>;
