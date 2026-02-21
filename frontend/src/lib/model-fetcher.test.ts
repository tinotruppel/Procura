import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchModelsForProvider, clearModelCache, type ModelOption } from "./model-fetcher";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const getData = (result: { models: ModelOption[] }) => result.models;

describe("model-fetcher", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearModelCache();
    });

    describe("fetchModelsForProvider - OpenAI", () => {
        it("should fetch and filter chat models", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    data: [
                        { id: "gpt-4o" },
                        { id: "gpt-4o-mini" },
                        { id: "gpt-5" },
                        { id: "text-embedding-ada-002" },
                        { id: "dall-e-3" },
                        { id: "tts-1" },
                        { id: "whisper-1" },
                        { id: "gpt-4o-realtime-preview" },
                        { id: "o3-mini" },
                    ],
                }),
            });

            const result = await fetchModelsForProvider("openai", "sk-test");
            const models = getData(result);

            expect(result.fromApi).toBe(true);
            expect(models.some(m => m.id === "gpt-4o")).toBe(true);
            expect(models.some(m => m.id === "gpt-5")).toBe(true);
            expect(models.some(m => m.id === "o3-mini")).toBe(true);
            // Excluded: embeddings, dall-e, tts, whisper, realtime
            expect(models.some(m => m.id === "text-embedding-ada-002")).toBe(false);
            expect(models.some(m => m.id === "dall-e-3")).toBe(false);
            expect(models.some(m => m.id === "tts-1")).toBe(false);
            expect(models.some(m => m.id === "whisper-1")).toBe(false);
            expect(models.some(m => m.id === "gpt-4o-realtime-preview")).toBe(false);
        });

        it("should fall back to hardcoded on API error", async () => {
            mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

            const result = await fetchModelsForProvider("openai", "bad-key");

            expect(result.fromApi).toBe(false);
            expect(result.models.length).toBeGreaterThan(0);
            expect(result.models.some(m => m.id.startsWith("gpt-"))).toBe(true);
        });
    });

    describe("fetchModelsForProvider - Claude", () => {
        it("should fetch and filter Claude models", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    data: [
                        { id: "claude-sonnet-4-20250514", display_name: "Claude Sonnet 4" },
                        { id: "claude-3-5-sonnet-20241022", display_name: "Claude 3.5 Sonnet" },
                    ],
                }),
            });

            const result = await fetchModelsForProvider("claude", "sk-ant-test");
            const models = getData(result);

            expect(result.fromApi).toBe(true);
            expect(models).toHaveLength(2);
            expect(models.some(m => m.id.includes("claude"))).toBe(true);
        });

        it("should include anthropic-dangerous-direct-browser-access header", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ data: [{ id: "claude-3-5-sonnet-20241022" }] }),
            });

            await fetchModelsForProvider("claude", "sk-ant-test");

            const headers = mockFetch.mock.calls[0][1].headers;
            expect(headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
            expect(headers["x-api-key"]).toBe("sk-ant-test");
        });
    });

    describe("fetchModelsForProvider - Gemini", () => {
        it("should fetch and filter generateContent-capable models", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    models: [
                        { name: "models/gemini-2.0-flash", displayName: "Gemini 2.0 Flash", supportedGenerationMethods: ["generateContent"] },
                        { name: "models/embedding-001", displayName: "Embedding 001", supportedGenerationMethods: ["embedContent"] },
                        { name: "models/gemini-1.5-pro", displayName: "Gemini 1.5 Pro", supportedGenerationMethods: ["generateContent"] },
                    ],
                }),
            });

            const result = await fetchModelsForProvider("gemini", "AIza-test");
            const models = getData(result);

            expect(result.fromApi).toBe(true);
            expect(models).toHaveLength(2);
            expect(models.some(m => m.id === "gemini-2.0-flash")).toBe(true);
            expect(models.some(m => m.id === "gemini-1.5-pro")).toBe(true);
            expect(models.some(m => m.id === "embedding-001")).toBe(false);
        });

        it("should pass API key as query parameter", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ models: [] }),
            });

            await fetchModelsForProvider("gemini", "AIza-test-key");

            const url = mockFetch.mock.calls[0][0] as string;
            expect(url).toContain("key=AIza-test-key");
        });
    });

    describe("caching", () => {
        it("should cache results and not re-fetch", async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    data: [{ id: "gpt-4o" }],
                }),
            });

            await fetchModelsForProvider("openai", "sk-test");
            await fetchModelsForProvider("openai", "sk-test");

            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it("should clear cache for specific provider", async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    data: [{ id: "gpt-4o" }],
                }),
            });

            await fetchModelsForProvider("openai", "sk-test");
            clearModelCache("openai");
            await fetchModelsForProvider("openai", "sk-test");

            expect(mockFetch).toHaveBeenCalledTimes(2);
        });
    });

    describe("fallbacks", () => {
        it("should return fallback when no API key", async () => {
            const result = await fetchModelsForProvider("openai", "");

            expect(result.fromApi).toBe(false);
            expect(result.models.length).toBeGreaterThan(0);
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it("should return empty for custom provider", async () => {
            const result = await fetchModelsForProvider("custom", "key");

            expect(result.models).toEqual([]);
            expect(result.fromApi).toBe(false);
        });

        it("should fall back when API returns empty list", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ data: [] }),
            });

            const result = await fetchModelsForProvider("openai", "sk-test");

            expect(result.fromApi).toBe(false);
            expect(result.models.length).toBeGreaterThan(0);
        });

        it("should fall back for Claude on API error", async () => {
            mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });

            const result = await fetchModelsForProvider("claude", "bad-key");

            expect(result.fromApi).toBe(false);
            expect(result.models.length).toBeGreaterThan(0);
            expect(result.models.some(m => m.id.includes("claude"))).toBe(true);
        });

        it("should fall back for Gemini on API error", async () => {
            mockFetch.mockResolvedValueOnce({ ok: false, status: 400 });

            const result = await fetchModelsForProvider("gemini", "bad-key");

            expect(result.fromApi).toBe(false);
            expect(result.models.length).toBeGreaterThan(0);
        });

        it("should return fallback when no API key for gemini", async () => {
            const result = await fetchModelsForProvider("gemini", "");
            expect(result.fromApi).toBe(false);
            expect(result.models.length).toBeGreaterThan(0);
        });

        it("should return fallback when no API key for claude", async () => {
            const result = await fetchModelsForProvider("claude", "");
            expect(result.fromApi).toBe(false);
            expect(result.models.length).toBeGreaterThan(0);
        });

        it("should clear all caches when called without args", async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    data: [{ id: "gpt-4o" }],
                }),
            });

            await fetchModelsForProvider("openai", "sk-test");
            clearModelCache(); // clear all
            await fetchModelsForProvider("openai", "sk-test");

            expect(mockFetch).toHaveBeenCalledTimes(2);
        });
    });
});
