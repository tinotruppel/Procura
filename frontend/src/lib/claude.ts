/**
 * Claude (Anthropic) LLM Provider
 * Uses Anthropic's Messages API with tool calling and streaming support
 */
import { ChatMessage, ToolCallInfo, LLMResponse, DebugEvent, StreamCallback, TextChunkCallback } from "./llm-types";
import { getEnabledToolDeclarations, executeTool } from "@/tools/registry";
import { FunctionDeclaration } from "@google/generative-ai";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

interface ClaudeMessage {
    role: "user" | "assistant";
    content: string | ClaudeContent[];
}

interface ClaudeContent {
    type: "text" | "tool_use" | "tool_result";
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
    tool_use_id?: string;
    content?: string;
}

interface ClaudeTool {
    name: string;
    description: string;
    input_schema: {
        type: "object";
        properties: Record<string, unknown>;
        required?: string[];
    };
}

interface ClaudeStreamEvent {
    type: string;
    message?: { usage?: { input_tokens: number; output_tokens: number } };
    content_block?: ClaudeContent;
    delta?: { type?: string; text?: string; partial_json?: string };
    index?: number;
    usage?: { output_tokens: number };
}

/**
 * Convert Gemini-style tool declarations to Claude format
 */
function convertToolsForClaude(tools: FunctionDeclaration[]): ClaudeTool[] {
    return tools.map((tool) => ({
        name: tool.name,
        description: tool.description || "",
        input_schema: {
            type: "object" as const,
            properties: (tool.parameters as { properties?: Record<string, unknown> })?.properties || {},
            required: (tool.parameters as { required?: string[] })?.required || [],
        },
    }));
}

/**
 * Convert our message format to Claude format (with image support)
 */
function convertMessagesForClaude(messages: ChatMessage[]): ClaudeMessage[] {
    return messages.map((msg) => {
        // If message has images, use array content format
        if (msg.images && msg.images.length > 0) {
            const content: ClaudeContent[] = [];

            // Add images first
            for (const image of msg.images) {
                // Extract base64 data and mime type from data URL
                const match = /^data:([^;]+);base64,(.+)$/.exec(image);
                if (match) {
                    content.push({
                        type: "text",
                        text: `[Image: ${match[1]}]`, // Claude doesn't support inline images via API
                    });
                }
            }

            // Add text content
            if (msg.content) {
                content.push({ type: "text", text: msg.content });
            }

            return {
                role: msg.role === "user" ? ("user" as const) : ("assistant" as const),
                content,
            };
        }

        // Simple text message
        return {
            role: msg.role === "user" ? ("user" as const) : ("assistant" as const),
            content: msg.content,
        };
    });
}

interface SSEParseState {
    content: ClaudeContent[];
    usage: { input_tokens: number; output_tokens: number };
    toolInputBuffers: Map<number, string>;
}

function handleMessageStart(event: ClaudeStreamEvent, state: SSEParseState): void {
    if (event.message?.usage) {
        state.usage.input_tokens = event.message.usage.input_tokens;
    }
}

function handleContentBlockStart(event: ClaudeStreamEvent, state: SSEParseState): void {
    if (!event.content_block) return;

    if (event.content_block.type === "text") {
        state.content.push({ type: "text", text: "" });
    } else if (event.content_block.type === "tool_use") {
        state.content.push({
            type: "tool_use",
            id: event.content_block.id,
            name: event.content_block.name,
            input: {},
        });
        state.toolInputBuffers.set(event.index || 0, "");
    }
}

function handleContentBlockDelta(
    event: ClaudeStreamEvent,
    state: SSEParseState,
    onTextChunk?: TextChunkCallback
): void {
    if (event.delta?.type === "text_delta" && event.delta.text) {
        onTextChunk?.(event.delta.text);
        const lastText = state.content.filter(c => c.type === "text").pop();
        if (lastText) {
            lastText.text = (lastText.text || "") + event.delta.text;
        }
    } else if (event.delta?.type === "input_json_delta" && event.delta.partial_json) {
        const idx = event.index || 0;
        const existing = state.toolInputBuffers.get(idx) || "";
        state.toolInputBuffers.set(idx, existing + event.delta.partial_json);
    }
}

function handleContentBlockStop(event: ClaudeStreamEvent, state: SSEParseState): void {
    if (typeof event.index === "undefined" || !state.toolInputBuffers.has(event.index)) return;

    const jsonStr = state.toolInputBuffers.get(event.index) || "{}";
    try {
        const toolContent = state.content.filter(c => c.type === "tool_use")[
            [...state.toolInputBuffers.keys()].indexOf(event.index)
        ];
        if (toolContent) {
            toolContent.input = JSON.parse(jsonStr);
        }
    } catch {
        // Ignore JSON parse errors
    }
}

function handleMessageDelta(event: ClaudeStreamEvent, state: SSEParseState): void {
    if (event.usage) {
        state.usage.output_tokens = event.usage.output_tokens;
    }
}

function processSSEEvent(
    event: ClaudeStreamEvent,
    state: SSEParseState,
    onTextChunk?: TextChunkCallback
): void {
    switch (event.type) {
        case "message_start":
            handleMessageStart(event, state);
            break;
        case "content_block_start":
            handleContentBlockStart(event, state);
            break;
        case "content_block_delta":
            handleContentBlockDelta(event, state, onTextChunk);
            break;
        case "content_block_stop":
            handleContentBlockStop(event, state);
            break;
        case "message_delta":
            handleMessageDelta(event, state);
            break;
    }
}

/**
 * Parse SSE stream from Claude API
 */
async function parseSSEStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    onTextChunk?: TextChunkCallback
): Promise<{ content: ClaudeContent[]; usage: { input_tokens: number; output_tokens: number } }> {
    const decoder = new TextDecoder();
    let buffer = "";
    const state: SSEParseState = {
        content: [],
        usage: { input_tokens: 0, output_tokens: 0 },
        toolInputBuffers: new Map(),
    };

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6);
            if (data === "[DONE]") continue;

            try {
                const event: ClaudeStreamEvent = JSON.parse(data);
                processSSEEvent(event, state, onTextChunk);
            } catch {
                // Ignore JSON parse errors
            }
        }
    }

    return { content: state.content, usage: state.usage };
}

interface ClaudeRequestParams {
    apiKey: string;
    model: string;
    systemPrompt?: string;
    claudeTools: ClaudeTool[];
    claudeMessages: ClaudeMessage[];
    signal?: AbortSignal;
}

interface ToolProcessingResult {
    toolResults: ClaudeContent[];
    toolCalls: ToolCallInfo[];
    debugEvents: DebugEvent[];
    authRequired?: { serverId: string };
}

/**
 * Make a streaming request to Claude API
 */
async function makeClaudeRequest(
    params: ClaudeRequestParams,
    onTextChunk?: TextChunkCallback
): Promise<{ content: ClaudeContent[]; usage: { input_tokens: number; output_tokens: number } }> {
    const { apiKey, model, systemPrompt, claudeTools, claudeMessages, signal } = params;

    const response = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
            model,
            max_tokens: 4096,
            stream: true,
            system: systemPrompt || undefined,
            tools: claudeTools.length > 0 ? claudeTools : undefined,
            messages: claudeMessages,
        }),
        signal,
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Claude API Error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
        throw new Error("No response body");
    }

    return parseSSEStream(reader, onTextChunk);
}

/**
 * Process tool calls from Claude response
 */
async function processToolCalls(
    toolUses: ClaudeContent[],
    onDebugEvent?: StreamCallback
): Promise<ToolProcessingResult> {
    const toolResults: ClaudeContent[] = [];
    const toolCalls: ToolCallInfo[] = [];
    const debugEvents: DebugEvent[] = [];

    let authRequired: { serverId: string } | undefined;

    for (const toolUse of toolUses) {
        const toolCall: ToolCallInfo = {
            name: toolUse.name!,
            args: toolUse.input as Record<string, unknown>,
        };

        const startTime = performance.now();
        const toolResult = await executeTool(
            toolUse.name!,
            toolUse.input as Record<string, unknown>
        );
        toolCall.durationMs = Math.round(performance.now() - startTime);
        toolCall.result = toolResult;
        toolCalls.push(toolCall);

        const toolEvent: DebugEvent = { type: 'tool', info: toolCall };
        debugEvents.push(toolEvent);
        onDebugEvent?.(toolEvent);

        if (toolResult.authRequired && toolResult.serverId) {
            authRequired = { serverId: toolResult.serverId };
        }

        toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify(
                toolResult.success ? toolResult.data : { error: toolResult.error }
            ),
        });
    }

    return { toolResults, toolCalls, debugEvents, authRequired };
}

/**
 * Send a message to Claude and handle tool calls with streaming
 */
export async function sendMessageClaude(
    apiKey: string,
    model: string,
    messages: ChatMessage[],
    systemPrompt?: string,
    onDebugEvent?: StreamCallback,
    onTextChunk?: TextChunkCallback,
    signal?: AbortSignal,
    getIntervention?: () => string | null
): Promise<LLMResponse> {
    const toolDeclarations = await getEnabledToolDeclarations();
    const claudeTools = convertToolsForClaude(toolDeclarations as FunctionDeclaration[]);

    let claudeMessages = convertMessagesForClaude(messages);
    const allToolCalls: ToolCallInfo[] = [];
    const debugEvents: DebugEvent[] = [];

    // Claude requires alternating user/assistant messages
    if (claudeMessages.length > 0 && claudeMessages[0].role === "assistant") {
        claudeMessages = [{ role: "user", content: "Hallo" }, ...claudeMessages];
    }

    let continueLoop = true;
    let finalText = "";
    let authRequiredInfo: { serverId: string } | undefined;

    while (continueLoop) {
        const llmStartTime = performance.now();
        const requestParams: ClaudeRequestParams = {
            apiKey, model, systemPrompt, claudeTools, claudeMessages, signal
        };
        const { content, usage } = await makeClaudeRequest(requestParams, onTextChunk);
        const llmDuration = Math.round(performance.now() - llmStartTime);

        const llmDebug = {
            durationMs: llmDuration,
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            totalTokens: usage.input_tokens + usage.output_tokens,
            model,
        };
        const llmEvent: DebugEvent = { type: 'llm', info: llmDebug };
        debugEvents.push(llmEvent);
        onDebugEvent?.(llmEvent);

        const toolUses = content.filter((c) => c.type === "tool_use");

        if (toolUses.length > 0) {
            const result = await processToolCalls(toolUses, onDebugEvent);
            allToolCalls.push(...result.toolCalls);
            debugEvents.push(...result.debugEvents);

            if (result.authRequired) {
                authRequiredInfo = result.authRequired;
                // Break immediately — don't send results back to LLM
                finalText = "";
                break;
            }

            claudeMessages.push({ role: "assistant", content });

            // Merge tool results with any pending user intervention into a single user message
            const userContent: ClaudeContent[] = [...result.toolResults];
            const intervention = getIntervention?.();
            if (intervention) {
                userContent.push({ type: "text", text: `[User intervention]: ${intervention}` });
            }
            claudeMessages.push({ role: "user", content: userContent });
        } else {
            continueLoop = false;
            const textContent = content.find((c) => c.type === "text");
            finalText = textContent?.text || "";
        }
    }

    const lastLLMEvent = debugEvents.filter(e => e.type === 'llm').pop();
    const lastLLMDebug = lastLLMEvent?.type === 'llm' ? lastLLMEvent.info : undefined;

    return {
        text: finalText,
        toolCalls: allToolCalls,
        debug: lastLLMDebug,
        debugEvents,
        authRequired: authRequiredInfo,
    };
}
