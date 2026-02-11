import { FunctionDeclaration, SchemaType } from "@google/generative-ai";
import type { PlatformName } from "@/platform";

/**
 * Configuration for a specific tool, stored in Chrome storage
 */
export interface ToolConfig {
    enabled: boolean;
    settings: Record<string, unknown>;
}

/**
 * Result from executing a tool
 */
export interface ToolExecutionResult {
    success: boolean;
    data?: unknown;
    error?: string;
}

/**
 * Field definition for tool settings UI
 */
export interface ToolSettingField {
    key: string;
    label: string;
    type: "text" | "password" | "select";
    placeholder?: string;
    options?: Array<{ value: string; label: string }>;
}

/**
 * Connection tester definition - allows tool to define its own test logic
 */
export interface ToolConnectionTester {
    /** API URL hint/link for users */
    apiLink?: { url: string; label: string };
    /** Fields required for test button to be enabled */
    requiredFields: string[];
    /** Test function - returns success/message */
    test: (getSetting: (key: string) => string) => Promise<{ success: boolean; message: string }>;
}

/**
 * Custom action definition - allows tool to add custom buttons (e.g., Clear All)
 */
export interface ToolCustomAction {
    /** Button label */
    label: string;
    /** Optional description shown next to the button */
    description?: string;
    /** Function to get dynamic description (e.g., entry count) */
    getDescription?: () => Promise<string>;
    /** Button variant/style */
    variant?: 'default' | 'destructive';
    /** Action function - returns success/message */
    action: () => Promise<{ success: boolean; message: string }>;
    /** Optional confirmation message before action */
    confirmMessage?: string | (() => Promise<string>);
}

/**
 * Context passed to tool execution
 */
export interface ToolContext {
    /** ID of the current system prompt (for memory tool) */
    promptId?: string;
    /** ID of the current chat (for schedule tool) */
    chatId?: string;
}

/**
 * Tool definition - each tool exports one of these
 */
export interface Tool {
    /** Unique identifier for the tool */
    name: string;

    /** Human-readable description */
    description: string;

    /** Whether the tool is enabled by default */
    enabledByDefault: boolean;

    /** Default configuration values */
    defaultConfig: Record<string, unknown>;

    /** Gemini Function Declaration schema */
    schema: FunctionDeclaration;

    /** Optional settings fields for UI rendering */
    settingsFields?: ToolSettingField[];

    /** Optional connection tester for UI */
    connectionTester?: ToolConnectionTester;

    /** Optional custom action button for UI (e.g., Clear All) */
    customAction?: ToolCustomAction;

    /**
     * Which platforms this tool supports
     * If omitted, tool is available on all platforms
     * @example ['chrome'] - Extension only
     * @example ['chrome', 'web'] - Both platforms
     */
    supportedPlatforms?: PlatformName[];

    /** Execute the tool with the given arguments, merged config, and optional context */
    execute: (
        args: Record<string, unknown>,
        config: Record<string, unknown>,
        context?: ToolContext
    ) => Promise<ToolExecutionResult>;
}

/**
 * Map of tool name to user configuration overrides
 */
export type ToolConfigMap = Record<string, ToolConfig>;

/**
 * Get the active browser tab
 * @returns The active tab with guaranteed id, or throws an error
 */
export async function getActiveTab(): Promise<chrome.tabs.Tab & { id: number }> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
        throw new Error("No active tab found");
    }
    return tab as chrome.tabs.Tab & { id: number };
}

// Re-export SchemaType for convenience
export { SchemaType };
