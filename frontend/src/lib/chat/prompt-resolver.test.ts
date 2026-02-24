import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveSystemPrompt } from "./prompt-resolver";

vi.mock("@/lib/storage", () => ({
    getActiveSystemPrompt: vi.fn(() => Promise.resolve("Local prompt content")),
    getLangfuseConfig: vi.fn(() =>
        Promise.resolve({ enabled: true, publicKey: "pk", secretKey: "sk", host: "https://langfuse" })
    ),
    getPromptVariables: vi.fn(() => Promise.resolve([{ key: "name", value: "Alice" }])),
    getToolConfigs: vi.fn(() => Promise.resolve({})),
}));

vi.mock("@/lib/langfuse", () => ({
    fetchLangfusePrompt: vi.fn(() =>
        Promise.resolve({ content: "Hello {{name}}", name: "MyPrompt", version: 2 })
    ),
    replacePromptVariables: vi.fn(() => ({ result: "Hello Alice", missing: [] })),
}));

vi.mock("@/lib/memory-store", () => ({
    getMemoryEntries: vi.fn(() => Promise.resolve([])),
}));

vi.mock("@/tools", () => ({
    getTool: vi.fn(() => null),
}));

describe("resolveSystemPrompt", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should return empty when no promptId", async () => {
        const result = await resolveSystemPrompt({
            selectedPromptId: null,
            systemPrompts: [],
        });
        expect(result.missingVariables).toEqual([]);
        expect(result.promptIdUsed).toBeNull();
        expect(result.systemPrompt).toBeUndefined();
    });

    it("should resolve local prompt content and metadata", async () => {
        const result = await resolveSystemPrompt({
            selectedPromptId: "local-1",
            systemPrompts: [{ id: "local-1", title: "Local Prompt", prompt: "Local prompt content" }],
        });

        expect(result.systemPrompt).toBe("Local prompt content");
        expect(result.systemPromptName).toBe("Local Prompt");
        expect(result.systemPromptSource).toBe("local");
        expect(result.promptIdUsed).toBe("local-1");
    });

    it("should resolve Langfuse prompt content and metadata", async () => {
        const result = await resolveSystemPrompt({
            selectedPromptId: "langfuse_MyPrompt",
            systemPrompts: [],
        });

        expect(result.systemPrompt).toBe("Hello Alice");
        expect(result.systemPromptName).toBe("MyPrompt");
        expect(result.systemPromptVersion).toBe(2);
        expect(result.systemPromptSource).toBe("langfuse");
        expect(result.promptIdUsed).toBe("langfuse_MyPrompt");
    });

    it("should use promptIdOverride over selectedPromptId", async () => {
        const result = await resolveSystemPrompt({
            selectedPromptId: "langfuse_Other",
            systemPrompts: [{ id: "override-1", title: "Override", prompt: "Override content" }],
            promptIdOverride: "override-1",
        });

        expect(result.promptIdUsed).toBe("override-1");
        expect(result.systemPromptSource).toBe("local");
    });

    it("should recover from Langfuse errors", async () => {
        const { fetchLangfusePrompt } = await import("@/lib/langfuse");
        vi.mocked(fetchLangfusePrompt).mockRejectedValueOnce(new Error("Network error"));

        const result = await resolveSystemPrompt({
            selectedPromptId: "langfuse_FailingPrompt",
            systemPrompts: [],
        });

        expect(result.missingVariables).toEqual([]);
        expect(result.promptIdUsed).toBe("langfuse_FailingPrompt");
        expect(result.systemPrompt).toBeUndefined();
    });

    it("should handle local prompt with memory", async () => {
        const { getTool } = await import("@/tools");
        const { getMemoryEntries } = await import("@/lib/memory-store");
        const { getToolConfigs } = await import("@/lib/storage");

        vi.mocked(getTool).mockReturnValueOnce({ name: "memory", enabledByDefault: true } as ReturnType<typeof getTool>);
        vi.mocked(getToolConfigs).mockResolvedValueOnce({ memory: { enabled: true } });
        vi.mocked(getMemoryEntries).mockResolvedValueOnce([
            { key: "user_name", value: "Alice", updatedAt: Date.now() },
        ]);

        const result = await resolveSystemPrompt({
            selectedPromptId: "local-1",
            systemPrompts: [{ id: "local-1", title: "Local", prompt: "content" }],
        });

        expect(result.injectedMemoryCount).toBe(1);
        expect(result.systemPrompt).toContain("Stored Memories");
    });

    it("should handle local prompt when active prompt is null", async () => {
        const { getActiveSystemPrompt } = await import("@/lib/storage");
        vi.mocked(getActiveSystemPrompt).mockResolvedValueOnce(null as unknown as string);

        const result = await resolveSystemPrompt({
            selectedPromptId: "local-1",
            systemPrompts: [{ id: "local-1", title: "Local", prompt: "content" }],
        });

        expect(result.systemPrompt).toBeUndefined();
        expect(result.systemPromptSource).toBeUndefined();
    });
});

