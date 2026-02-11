/**
 * LLM Provider Types
 * Shared types for all LLM providers (Gemini, Claude, OpenAI)
 */

export type LLMProvider = "gemini" | "claude" | "openai" | "custom";

export interface LLMApiKeys {
    gemini?: string;
    claude?: string;
    openai?: string;
    custom?: string;
}

export interface LLMModels {
    gemini: string;
    claude: string;
    openai: string;
    custom: string;
}

export interface ToolCallInfo {
    name: string;
    args: Record<string, unknown>;
    durationMs?: number;
    result?: {
        success: boolean;
        data?: unknown;
        error?: string;
    };
    observationId?: string; // Langfuse span ID for debugging
}

export interface LLMDebugInfo {
    durationMs: number;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    model?: string;
    provider?: string; // Provider name (gemini, claude, openai, custom)
    baseUrl?: string; // Base URL for custom provider
    systemPromptName?: string; // Name of the system prompt used
    systemPromptSource?: "local" | "langfuse"; // Source of the system prompt
    missingVariables?: string[]; // Variables not found in prompt substitution
    injectedMemoryCount?: number; // Number of memories injected into prompt
    observationId?: string; // Langfuse generation ID for debugging
}

// Debug event types for sequential logging
export type DebugEvent =
    | { type: 'llm'; info: LLMDebugInfo }
    | { type: 'tool'; info: ToolCallInfo };

// Callback for streaming debug events in real-time
export type StreamCallback = (event: DebugEvent) => void;

// Callback for streaming text chunks in real-time
export type TextChunkCallback = (chunk: string) => void;

// Attached file metadata for display and tool reference
export interface AttachedFile {
    id: string;           // Reference ID (file_xxx or img_xxx)
    fileName: string;     // Original filename
    mimeType: string;     // MIME type (e.g., "application/pdf")
    fileSize: number;     // Size in bytes
    dataUrl: string;      // Base64 data URL for display/upload
}

export interface ChatMessage {
    role: "user" | "model";
    content: string;
    images?: string[]; // Base64 data URLs
    files?: AttachedFile[]; // General file attachments (documents, audio, etc.)
    toolCalls?: ToolCallInfo[]; // Derived from debugEvents
    llmDebug?: LLMDebugInfo; // Last LLM debug
    debugEvents?: DebugEvent[]; // New: all events in sequence
    traceId?: string; // Langfuse trace ID for feedback scoring
    timestamp?: number; // Unix timestamp when response was received
}

export interface LLMResponse {
    text: string;
    toolCalls: ToolCallInfo[];
    debug?: LLMDebugInfo; // Keep for backward compat
    debugEvents?: DebugEvent[]; // New: all events in sequence
}

// Provider-specific model lists
export const GEMINI_MODELS = [
    { id: "gemini-3-flash-preview", name: "Gemini 3 Flash (Preview)" },
    { id: "gemini-3-pro-preview", name: "Gemini 3 Pro (Preview)" },
    { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
    { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash" },
    { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro" },
];

export const CLAUDE_MODELS = [
    { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
    { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet" },
    { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku" },
];

export const OPENAI_MODELS = [
    { id: "gpt-5.2", name: "GPT-5.2" },
    { id: "gpt-5.1", name: "GPT-5.1" },
    { id: "gpt-5", name: "GPT-5" },
    { id: "gpt-5-mini", name: "GPT-5 Mini" },
    { id: "gpt-4.1-mini", name: "GPT-4.1 Mini" },
    { id: "gpt-4o", name: "GPT-4o" },
    { id: "gpt-4o-mini", name: "GPT-4o Mini" },
    { id: "o3-mini", name: "o3 Mini" },
    { id: "gpt-4-turbo", name: "GPT-4 Turbo" },
];

export const DEFAULT_MODELS: LLMModels = {
    gemini: "gemini-2.0-flash",
    claude: "claude-sonnet-4-20250514",
    openai: "gpt-4o-mini",
    custom: "",
};

export const PROVIDER_LABELS: Record<LLMProvider, string> = {
    gemini: "Google Gemini",
    claude: "Anthropic Claude",
    openai: "OpenAI",
    custom: "Custom (OpenAI-Compatible)",
};
