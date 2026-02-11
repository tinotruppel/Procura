import {
    GoogleGenerativeAI,
    Content,
    FunctionDeclaration,
    FunctionCallingMode,
    Part,
    GenerateContentStreamResult,
} from "@google/generative-ai";
import { getEnabledToolDeclarations, executeTool } from "@/tools/registry";
import { ChatMessage, ToolCallInfo, LLMResponse, DebugEvent, StreamCallback, TextChunkCallback } from "./llm-types";

export async function sendMessageGemini(
    apiKey: string,
    model: string,
    messages: ChatMessage[],
    systemPrompt?: string,
    onDebugEvent?: StreamCallback,
    onTextChunk?: TextChunkCallback,
    signal?: AbortSignal
): Promise<LLMResponse> {
    const genAI = new GoogleGenerativeAI(apiKey);

    // Get enabled tools
    const toolDeclarations = await getEnabledToolDeclarations();

    const generativeModel = genAI.getGenerativeModel({
        model,
        systemInstruction: systemPrompt || undefined,
        tools: toolDeclarations.length > 0 ? [{
            functionDeclarations: toolDeclarations as FunctionDeclaration[],
        }] : undefined,
        toolConfig: toolDeclarations.length > 0 ? {
            functionCallingConfig: {
                mode: FunctionCallingMode.AUTO,
            },
        } : undefined,
    });

    // Helper to convert message format
    const messageToParts = (msg: ChatMessage): Part[] => {
        const parts: Part[] = [];

        // Add images first if present
        if (msg.images && msg.images.length > 0) {
            for (const image of msg.images) {
                // Extract base64 data and mime type from data URL
                const match = /^data:([^;]+);base64,(.+)$/.exec(image);
                if (match) {
                    parts.push({
                        inlineData: {
                            mimeType: match[1],
                            data: match[2],
                        },
                    });
                }
            }
        }

        // Add text content
        if (msg.content) {
            parts.push({ text: msg.content });
        }

        return parts;
    };

    // Convert messages to Gemini format (excluding last message)
    const history: Content[] = messages.slice(0, -1).map((msg) => ({
        role: msg.role === "user" ? "user" : "model",
        parts: messageToParts(msg),
    }));

    const chat = generativeModel.startChat({ history });
    const lastMessage = messages[messages.length - 1];
    const lastMessageParts = messageToParts(lastMessage);

    // Debug: Log if images are being sent
    const imagePartsCount = lastMessageParts.filter(p => 'inlineData' in p).length;
    if (imagePartsCount > 0 || lastMessage.images?.length) {
        console.log(`[Gemini] Sending message with ${imagePartsCount} image parts (source images: ${lastMessage.images?.length || 0})`);
    }

    const debugEvents: DebugEvent[] = [];
    const allToolCalls: ToolCallInfo[] = [];
    let accumulatedText = "";

    // Helper to process a streaming response
    async function processStream(
        streamResult: GenerateContentStreamResult
    ): Promise<{ text: string; functionCalls: { name: string; args: Record<string, unknown> }[] }> {
        let streamText = "";
        const functionCalls: { name: string; args: Record<string, unknown> }[] = [];

        for await (const chunk of streamResult.stream) {
            // Check for abort signal
            if (signal?.aborted) {
                throw new DOMException("Aborted", "AbortError");
            }
            const chunkText = chunk.text();
            if (chunkText) {
                streamText += chunkText;
                onTextChunk?.(chunkText);
            }

            // Check for function calls in this chunk
            const calls = chunk.functionCalls();
            if (calls && calls.length > 0) {
                for (const fc of calls) {
                    functionCalls.push({
                        name: fc.name,
                        args: fc.args as Record<string, unknown>,
                    });
                }
            }
        }

        return { text: streamText, functionCalls };
    }

    // First LLM call with streaming
    let llmStartTime = performance.now();
    const streamResult = await chat.sendMessageStream(lastMessageParts);
    let { text: responseText, functionCalls } = await processStream(streamResult);
    accumulatedText = responseText;

    // Get the aggregated response for usage metadata
    const aggregatedResponse = await streamResult.response;

    // Record first LLM call
    const firstLLMDebug = {
        durationMs: Math.round(performance.now() - llmStartTime),
        inputTokens: aggregatedResponse.usageMetadata?.promptTokenCount || 0,
        outputTokens: aggregatedResponse.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: (aggregatedResponse.usageMetadata?.promptTokenCount || 0) + (aggregatedResponse.usageMetadata?.candidatesTokenCount || 0),
        model,
    };
    const firstEvent: DebugEvent = { type: 'llm', info: firstLLMDebug };
    debugEvents.push(firstEvent);
    onDebugEvent?.(firstEvent);

    // Handle function calls in a loop
    while (functionCalls.length > 0) {
        // Check for abort signal before processing tool calls
        if (signal?.aborted) {
            throw new DOMException("Aborted", "AbortError");
        }
        const functionResponses: Part[] = [];

        for (const fc of functionCalls) {
            const toolCall: ToolCallInfo = {
                name: fc.name,
                args: fc.args,
            };

            // Execute the tool with timing
            const toolStartTime = performance.now();
            const toolResult = await executeTool(fc.name, fc.args);
            toolCall.durationMs = Math.round(performance.now() - toolStartTime);
            toolCall.result = toolResult;
            allToolCalls.push(toolCall);

            // Add tool event
            const toolEvent: DebugEvent = { type: 'tool', info: toolCall };
            debugEvents.push(toolEvent);
            onDebugEvent?.(toolEvent);

            // Prepare response for Gemini
            functionResponses.push({
                functionResponse: {
                    name: fc.name,
                    response: toolResult.success
                        ? { result: toolResult.data }
                        : { error: toolResult.error },
                },
            });
        }

        // Send function results back to Gemini
        // Use non-streaming for function responses to ensure thought_signature is correctly handled
        llmStartTime = performance.now();
        const response = await chat.sendMessage(functionResponses);
        responseText = response.response.text() || "";

        // Check for more function calls
        const nextFunctionCalls = response.response.functionCalls();
        if (nextFunctionCalls && nextFunctionCalls.length > 0) {
            functionCalls = nextFunctionCalls.map(fc => ({
                name: fc.name,
                args: fc.args as Record<string, unknown>,
            }));
        } else {
            functionCalls = [];
        }
        accumulatedText = responseText;

        // Stream the final text to the callback if no more function calls
        if (functionCalls.length === 0 && responseText) {
            onTextChunk?.(responseText);
        }

        // Record this LLM call
        const llmDebug = {
            durationMs: Math.round(performance.now() - llmStartTime),
            inputTokens: response.response.usageMetadata?.promptTokenCount || 0,
            outputTokens: response.response.usageMetadata?.candidatesTokenCount || 0,
            totalTokens: (response.response.usageMetadata?.promptTokenCount || 0) + (response.response.usageMetadata?.candidatesTokenCount || 0),
            model,
        };
        const llmEvent: DebugEvent = { type: 'llm', info: llmDebug };
        debugEvents.push(llmEvent);
        onDebugEvent?.(llmEvent);
    }

    // Get last LLM debug for backward compat
    const lastLLMEvent = debugEvents.filter(e => e.type === 'llm').pop();
    const lastLLMDebug = lastLLMEvent?.type === 'llm' ? lastLLMEvent.info : undefined;

    return {
        text: accumulatedText,
        toolCalls: allToolCalls,
        debug: lastLLMDebug,
        debugEvents,
    };
}

