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
});
