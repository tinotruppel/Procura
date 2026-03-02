/**
 * LLM Provider Factory
 * Unified interface for sending messages to different LLM providers
 */
import { ChatMessage, LLMProvider, LLMResponse, StreamCallback, TextChunkCallback } from "./llm-types";
import { sendMessageGemini } from "./gemini";
import { sendMessageClaude } from "./claude";
import { sendMessageOpenAI } from "./openai";
import { sendMessageCustomOpenAI } from "./custom-openai";

/**
 * Send a message to the configured LLM provider
 * @param onDebugEvent Optional callback for real-time debug event streaming
 * @param onTextChunk Optional callback for real-time text streaming
 * @param signal Optional AbortSignal to cancel the request
 * @param customBaseUrl Required for "custom" provider - the base URL of the OpenAI-compatible API
 * @param getIntervention Optional callback to pull pending user intervention messages mid-loop
 */
// eslint-disable-next-line max-params -- positional args match individual provider signatures
export async function sendMessage(
    provider: LLMProvider,
    apiKey: string,
    model: string,
    messages: ChatMessage[],
    systemPrompt?: string,
    onDebugEvent?: StreamCallback,
    onTextChunk?: TextChunkCallback,
    signal?: AbortSignal,
    customBaseUrl?: string,
    getIntervention?: () => string | null
): Promise<LLMResponse> {
    if (!apiKey) {
        throw new Error(`No API key configured for ${provider}`);
    }

    switch (provider) {
        case "gemini":
            return sendMessageGemini(apiKey, model, messages, systemPrompt, onDebugEvent, onTextChunk, signal, getIntervention);
        case "claude":
            return sendMessageClaude(apiKey, model, messages, systemPrompt, onDebugEvent, onTextChunk, signal, getIntervention);
        case "openai":
            return sendMessageOpenAI(apiKey, model, messages, systemPrompt, onDebugEvent, onTextChunk, signal, getIntervention);
        case "custom":
            if (!customBaseUrl) {
                throw new Error("Custom provider requires a base URL");
            }
            return sendMessageCustomOpenAI(customBaseUrl, apiKey, model, messages, systemPrompt, onDebugEvent, onTextChunk, signal, getIntervention);
        default:
            throw new Error(`Unknown provider: ${provider}`);
    }
}

