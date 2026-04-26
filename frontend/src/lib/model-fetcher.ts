/**
 * Dynamic Model Fetcher
 * Fetches available models from LLM provider APIs with caching and fallback.
 */

import { LLMProvider, GEMINI_MODELS, CLAUDE_MODELS, OPENAI_MODELS } from "./llm-types";

export interface ModelOption {
    id: string;
    name: string;
}

// 5-minute cache per provider
const cache = new Map<string, { models: ModelOption[]; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCached(provider: string): ModelOption[] | null {
    const entry = cache.get(provider);
    if (entry && Date.now() < entry.expiresAt) return entry.models;
    return null;
}

function setCache(provider: string, models: ModelOption[]) {
    cache.set(provider, { models, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Clear the model cache (e.g. when API key changes) */
export function clearModelCache(provider?: string) {
    if (provider) {
        cache.delete(provider);
    } else {
        cache.clear();
    }
}

// ---------------------------------------------------------------------------
// Provider-specific fetchers
// ---------------------------------------------------------------------------

async function fetchOpenAIModels(apiKey: string): Promise<ModelOption[]> {
    const response = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: "Bearer " + apiKey },
    });
    if (!response.ok) throw new Error("OpenAI API error: " + response.status);
    const data = await response.json();

    const chatPrefixes = ["gpt-", "o1", "o3", "o4", "chatgpt-"];
    const excluded = ["instruct", "realtime", "audio", "tts", "whisper", "dall-e", "embedding", "moderation", "search"];

    return (data.data || [])
        .filter((m: { id: string }) => {
            const id = m.id.toLowerCase();
            const isChat = chatPrefixes.some(p => id.startsWith(p));
            const isExcluded = excluded.some(e => id.includes(e));
            return isChat && !isExcluded;
        })
        .map((m: { id: string }) => ({ id: m.id, name: formatModelName(m.id) }))
        .sort((a: ModelOption, b: ModelOption) => a.name.localeCompare(b.name));
}

async function fetchClaudeModels(apiKey: string): Promise<ModelOption[]> {
    const response = await fetch("https://api.anthropic.com/v1/models", {
        headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
        },
    });
    if (!response.ok) throw new Error("Anthropic API error: " + response.status);
    const data = await response.json();

    return (data.data || [])
        .filter((m: { id: string }) => m.id.includes("claude"))
        .map((m: { id: string; display_name?: string }) => ({
            id: m.id,
            name: m.display_name || formatModelName(m.id),
        }))
        .sort((a: ModelOption, b: ModelOption) => a.name.localeCompare(b.name));
}

async function fetchGeminiModels(apiKey: string): Promise<ModelOption[]> {
    const response = await fetch(
        "https://generativelanguage.googleapis.com/v1/models?key=" + encodeURIComponent(apiKey)
    );
    if (!response.ok) throw new Error("Gemini API error: " + response.status);
    const data = await response.json();

    return (data.models || [])
        .filter((m: { supportedGenerationMethods?: string[] }) =>
            m.supportedGenerationMethods?.includes("generateContent")
        )
        .map((m: { name: string; displayName?: string }) => ({
            // name comes as "models/gemini-2.0-flash" → extract the model ID
            id: m.name.replace("models/", ""),
            name: m.displayName || formatModelName(m.name.replace("models/", "")),
        }))
        .sort((a: ModelOption, b: ModelOption) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert "gpt-4o-mini" → "GPT 4o Mini", "claude-3-5-sonnet-..." → "Claude 3 5 Sonnet ..." */
function formatModelName(id: string): string {
    return id
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, c => c.toUpperCase());
}

function getFallbackModels(provider: LLMProvider): ModelOption[] {
    switch (provider) {
        case "gemini": return GEMINI_MODELS;
        case "claude": return CLAUDE_MODELS;
        case "openai": return OPENAI_MODELS;
        case "custom": return [];
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch available models for a provider. Uses cache; falls back to hardcoded list on error.
 * Returns { models, fromApi } where fromApi indicates live fetch vs fallback.
 */
export async function fetchModelsForProvider(
    provider: LLMProvider,
    apiKey: string,
): Promise<{ models: ModelOption[]; fromApi: boolean }> {
    if (provider === "custom") {
        return { models: [], fromApi: false };
    }
    if (!apiKey) {
        return { models: getFallbackModels(provider), fromApi: false };
    }

    const cached = getCached(provider);
    if (cached) return { models: cached, fromApi: true };

    try {
        let models: ModelOption[];
        switch (provider) {
            case "openai": models = await fetchOpenAIModels(apiKey); break;
            case "claude": models = await fetchClaudeModels(apiKey); break;
            case "gemini": models = await fetchGeminiModels(apiKey); break;
        }
        if (models.length === 0) {
            return { models: getFallbackModels(provider), fromApi: false };
        }
        setCache(provider, models);
        return { models, fromApi: true };
    } catch (err) {
        console.warn("[model-fetcher] Failed to fetch models for", provider, err);
        return { models: getFallbackModels(provider), fromApi: false };
    }
}
