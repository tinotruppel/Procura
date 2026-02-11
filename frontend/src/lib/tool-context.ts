/**
 * Tool Context Store
 * 
 * Provides execution context to tools without threading through LLM calls.
 * Set before LLM invocation, read during tool execution.
 */

let currentContext: { promptId?: string; chatId?: string } = {};

/**
 * Set the current tool execution context
 */
export function setToolContext(context: { promptId?: string; chatId?: string }): void {
    currentContext = { ...context };
}

/**
 * Get the current tool execution context
 */
export function getToolContext(): { promptId?: string; chatId?: string } {
    return { ...currentContext };
}

/**
 * Clear the current context
 */
export function clearToolContext(): void {
    currentContext = {};
}
