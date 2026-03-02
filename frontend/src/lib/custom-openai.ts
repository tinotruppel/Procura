/**
 * Custom OpenAI-Compatible LLM Provider
 * Works with any service implementing the OpenAI Chat Completions API (LiteLLM, Ollama, etc.)
 */
import { ChatMessage, ToolCallInfo, LLMResponse, DebugEvent, StreamCallback, TextChunkCallback } from "./llm-types";
import { getEnabledToolDeclarations, executeTool } from "@/tools/registry";
import { FunctionDeclaration } from "@google/generative-ai";

interface OpenAIMessage {
    role: "user" | "assistant" | "tool" | "system";
    content: string | null | Array<{ type: string; text?: string; image_url?: { url: string } }>;
    tool_calls?: OpenAIToolCall[];
    tool_call_id?: string;
}

interface OpenAIToolCall {
    id: string;
    type: "function";
    function: {
        name: string;
        arguments: string;
    };
}

interface OpenAITool {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: {
            type: "object";
            properties: Record<string, unknown>;
            required?: string[];
        };
    };
}

interface OpenAIStreamDelta {
    role?: string;
    content?: string;
    tool_calls?: Array<{
        index: number;
        id?: string;
        type?: string;
        function?: {
            name?: string;
            arguments?: string;
        };
    }>;
}

interface OpenAIStreamChunk {
    id: string;
    object: string;
    choices: Array<{
        index: number;
        delta: OpenAIStreamDelta;
        finish_reason: string | null;
    }>;
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

interface ModelInfo {
    id: string;
    name: string;
}

/**
 * Fetch available models from the /v1/models endpoint
 */
export async function fetchCustomModels(baseUrl: string, apiKey: string): Promise<ModelInfo[]> {
    const url = baseUrl.replace(/\/$/, "") + "/v1/models";

    const response = await fetch(url, {
        method: "GET",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Accept": "application/json",
        },
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to fetch models: ${response.status} - ${error}`);
    }

    const data = await response.json();

    // OpenAI /v1/models returns { data: [{ id: "model-id", ... }] }
    const models: ModelInfo[] = (data.data || []).map((m: { id: string; name?: string }) => ({
        id: m.id,
        name: m.name || m.id,
    }));

    // Sort alphabetically by name
    models.sort((a, b) => a.name.localeCompare(b.name));

    return models;
}

/**
 * Convert Gemini-style tool declarations to OpenAI format
 */
function convertToolsForOpenAI(tools: FunctionDeclaration[]): OpenAITool[] {
    return tools.map((tool) => ({
        type: "function" as const,
        function: {
            name: tool.name,
            description: tool.description || "",
            parameters: {
                type: "object" as const,
                properties: (tool.parameters as { properties?: Record<string, unknown> })?.properties || {},
                required: (tool.parameters as { required?: string[] })?.required || [],
            },
        },
    }));
}

/**
 * Convert our message format to OpenAI format (with image support)
 */
function convertMessagesForOpenAI(messages: ChatMessage[]): OpenAIMessage[] {
    return messages.map((msg) => {
        // If message has images, use array content format for vision
        if (msg.images && msg.images.length > 0) {
            const content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [];

            // Add images
            for (const imageDataUrl of msg.images) {
                content.push({
                    type: "image_url",
                    image_url: { url: imageDataUrl },
                });
            }

            // Add text content
            if (msg.content) {
                content.push({ type: "text", text: msg.content });
            }

            return {
                role: msg.role === "model" ? "assistant" : "user",
                content: content as OpenAIMessage["content"],
            };
        }

        // Simple text-only message
        return {
            role: msg.role === "model" ? "assistant" : "user",
            content: msg.content,
        };
    });
}

/**
 * Parse SSE stream from OpenAI-compatible API
 */
async function parseOpenAIStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    onTextChunk?: TextChunkCallback
): Promise<{
    content: string;
    toolCalls: OpenAIToolCall[];
    usage: { prompt_tokens: number; completion_tokens: number };
}> {
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let usage = { prompt_tokens: 0, completion_tokens: 0 };
    const toolCallsMap: Map<number, OpenAIToolCall> = new Map();

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
            if (line.startsWith("data: ")) {
                const data = line.slice(6);
                if (data === "[DONE]") continue;

                try {
                    const chunk: OpenAIStreamChunk = JSON.parse(data);

                    for (const choice of chunk.choices) {
                        const delta = choice.delta;

                        // Stream text content
                        if (delta.content) {
                            content += delta.content;
                            onTextChunk?.(delta.content);
                        }

                        // Accumulate tool calls
                        if (delta.tool_calls) {
                            for (const tc of delta.tool_calls) {
                                const existing = toolCallsMap.get(tc.index);
                                if (existing) {
                                    // Append to existing
                                    if (tc.function?.arguments) {
                                        existing.function.arguments += tc.function.arguments;
                                    }
                                } else {
                                    // Create new
                                    toolCallsMap.set(tc.index, {
                                        id: tc.id || "",
                                        type: "function",
                                        function: {
                                            name: tc.function?.name || "",
                                            arguments: tc.function?.arguments || "",
                                        },
                                    });
                                }
                            }
                        }
                    }

                    // Capture usage from final chunk
                    if (chunk.usage) {
                        usage = {
                            prompt_tokens: chunk.usage.prompt_tokens,
                            completion_tokens: chunk.usage.completion_tokens,
                        };
                    }
                } catch {
                    // Ignore JSON parse errors
                }
            }
        }
    }

    // Convert map to array
    const toolCalls = Array.from(toolCallsMap.values());

    return { content, toolCalls, usage };
}

/**
 * Send a message to a custom OpenAI-compatible API with streaming
 */
export async function sendMessageCustomOpenAI(
    baseUrl: string,
    apiKey: string,
    model: string,
    messages: ChatMessage[],
    systemPrompt?: string,
    onDebugEvent?: StreamCallback,
    onTextChunk?: TextChunkCallback,
    signal?: AbortSignal,
    getIntervention?: () => string | null
): Promise<LLMResponse> {
    const apiUrl = baseUrl.replace(/\/$/, "") + "/v1/chat/completions";

    // Get enabled tools
    const toolDeclarations = await getEnabledToolDeclarations();
    const openaiTools = convertToolsForOpenAI(toolDeclarations as FunctionDeclaration[]);

    // OpenAI uses a "system" role for system prompts
    const messagesWithSystem: OpenAIMessage[] = systemPrompt
        ? [{ role: "system" as const, content: systemPrompt }, ...convertMessagesForOpenAI(messages)]
        : convertMessagesForOpenAI(messages);

    const allToolCalls: ToolCallInfo[] = [];
    const debugEvents: DebugEvent[] = [];

    let continueLoop = true;
    const currentMessages = [...messagesWithSystem];
    let finalContent = "";

    while (continueLoop) {
        const llmStartTime = performance.now();
        const response = await fetch(apiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model,
                stream: true,
                stream_options: { include_usage: true },
                messages: currentMessages,
                tools: openaiTools.length > 0 ? openaiTools : undefined,
                tool_choice: openaiTools.length > 0 ? "auto" : undefined,
            }),
            signal,
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`API Error: ${response.status} - ${error}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error("No response body");
        }

        const { content, toolCalls, usage } = await parseOpenAIStream(reader, onTextChunk);
        const llmDuration = Math.round(performance.now() - llmStartTime);

        // Record LLM call event
        const llmDebug = {
            durationMs: llmDuration,
            inputTokens: usage.prompt_tokens,
            outputTokens: usage.completion_tokens,
            totalTokens: usage.prompt_tokens + usage.completion_tokens,
            model,
        };
        const llmEvent: DebugEvent = { type: 'llm', info: llmDebug };
        debugEvents.push(llmEvent);
        onDebugEvent?.(llmEvent);

        // Check for tool calls
        if (toolCalls.length > 0) {
            // Add assistant message with tool calls
            currentMessages.push({
                role: "assistant",
                content: content || null,
                tool_calls: toolCalls,
            });

            // Process each tool call
            for (const toolCall of toolCalls) {
                let args: Record<string, unknown> = {};
                try {
                    args = JSON.parse(toolCall.function.arguments);
                } catch {
                    args = {};
                }

                const toolCallInfo: ToolCallInfo = {
                    name: toolCall.function.name,
                    args,
                };

                const toolStartTime = performance.now();
                const toolResult = await executeTool(toolCall.function.name, args);
                toolCallInfo.durationMs = Math.round(performance.now() - toolStartTime);
                toolCallInfo.result = toolResult;
                allToolCalls.push(toolCallInfo);

                // Add tool event
                const toolEvent: DebugEvent = { type: 'tool', info: toolCallInfo };
                debugEvents.push(toolEvent);
                onDebugEvent?.(toolEvent);

                // Add tool result message
                currentMessages.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: JSON.stringify(
                        toolResult.success ? toolResult.data : { error: toolResult.error }
                    ),
                });
            }

            // Inject user intervention if one is pending
            const intervention = getIntervention?.();
            if (intervention) {
                currentMessages.push({ role: "user", content: `[User intervention]: ${intervention}` });
            }

            // Continue loop to get final response
        } else {
            // No tool calls, done
            continueLoop = false;
            finalContent = content;
        }
    }

    const lastLLMEvent = debugEvents.filter(e => e.type === 'llm').pop();
    const lastLLMDebug = lastLLMEvent?.type === 'llm' ? lastLLMEvent.info : undefined;

    return {
        text: finalContent,
        toolCalls: allToolCalls,
        debug: lastLLMDebug,
        debugEvents,
    };
}
