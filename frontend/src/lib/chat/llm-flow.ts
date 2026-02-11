import { sendMessage } from "@/lib/llm-provider";
import type { ChatMessage, LLMProvider, LLMResponse } from "@/lib/llm-types";
import type { StreamCallback, TextChunkCallback } from "@/lib/llm-types";

interface ExecuteLlmChatTurnInput {
    provider: LLMProvider;
    apiKey: string;
    model: string;
    messages: ChatMessage[];
    systemPrompt?: string;
    onDebugEvent?: StreamCallback;
    onTextChunk?: TextChunkCallback;
    signal?: AbortSignal;
    customBaseUrl?: string;
}

export async function executeLlmChatTurn({
    provider,
    apiKey,
    model,
    messages,
    systemPrompt,
    onDebugEvent,
    onTextChunk,
    signal,
    customBaseUrl,
}: ExecuteLlmChatTurnInput): Promise<LLMResponse> {
    return sendMessage(
        provider,
        apiKey,
        model,
        messages,
        systemPrompt,
        onDebugEvent,
        onTextChunk,
        signal,
        customBaseUrl
    );
}
