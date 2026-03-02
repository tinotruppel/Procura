/**
 * Tests for llm-provider.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all LLM implementations
vi.mock("./gemini", () => ({
    sendMessageGemini: vi.fn(() => Promise.resolve({ text: "Gemini response", toolCalls: [] })),
}));

vi.mock("./claude", () => ({
    sendMessageClaude: vi.fn(() => Promise.resolve({ text: "Claude response", toolCalls: [] })),
}));

vi.mock("./openai", () => ({
    sendMessageOpenAI: vi.fn(() => Promise.resolve({ text: "OpenAI response", toolCalls: [] })),
}));

import { sendMessage } from "./llm-provider";
import { sendMessageGemini } from "./gemini";
import { sendMessageClaude } from "./claude";
import { sendMessageOpenAI } from "./openai";

describe("sendMessage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should route to Gemini provider", async () => {
        const result = await sendMessage(
            "gemini",
            "test-key",
            "gemini-pro",
            [{ role: "user", content: "Hello" }]
        );

        expect(sendMessageGemini).toHaveBeenCalledWith(
            "test-key",
            "gemini-pro",
            [{ role: "user", content: "Hello" }],
            undefined,
            undefined,
            undefined,
            undefined,
            undefined
        );
        expect(result.text).toBe("Gemini response");
    });

    it("should route to Claude provider", async () => {
        const result = await sendMessage(
            "claude",
            "test-key",
            "claude-3-opus",
            [{ role: "user", content: "Hello" }]
        );

        expect(sendMessageClaude).toHaveBeenCalledWith(
            "test-key",
            "claude-3-opus",
            [{ role: "user", content: "Hello" }],
            undefined,
            undefined,
            undefined,
            undefined,
            undefined
        );
        expect(result.text).toBe("Claude response");
    });

    it("should route to OpenAI provider", async () => {
        const result = await sendMessage(
            "openai",
            "test-key",
            "gpt-4",
            [{ role: "user", content: "Hello" }]
        );

        expect(sendMessageOpenAI).toHaveBeenCalledWith(
            "test-key",
            "gpt-4",
            [{ role: "user", content: "Hello" }],
            undefined,
            undefined,
            undefined,
            undefined,
            undefined
        );
        expect(result.text).toBe("OpenAI response");
    });

    it("should throw for unknown provider", async () => {
        await expect(
            sendMessage(
                "unknown" as any,
                "test-key",
                "model",
                [{ role: "user", content: "Hello" }]
            )
        ).rejects.toThrow("Unknown provider");
    });

    it("should throw for missing API key", async () => {
        await expect(
            sendMessage(
                "gemini",
                "",
                "model",
                [{ role: "user", content: "Hello" }]
            )
        ).rejects.toThrow("No API key");
    });

    it("should pass abort signal to provider", async () => {
        const controller = new AbortController();
        await sendMessage(
            "gemini",
            "test-key",
            "gemini-pro",
            [{ role: "user", content: "Hello" }],
            "system prompt",
            undefined,
            undefined,
            controller.signal
        );

        expect(sendMessageGemini).toHaveBeenCalledWith(
            "test-key",
            "gemini-pro",
            [{ role: "user", content: "Hello" }],
            "system prompt",
            undefined,
            undefined,
            controller.signal,
            undefined
        );
    });
});
