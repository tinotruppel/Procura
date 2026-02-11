import { describe, it, expect } from "vitest";
import {
    LLMProvider,
    GEMINI_MODELS,
    CLAUDE_MODELS,
    OPENAI_MODELS,
    DEFAULT_MODELS,
    PROVIDER_LABELS,
} from "./llm-types";

describe("LLM Types", () => {
    describe("Provider Models", () => {
        it("should have at least one Gemini model", () => {
            expect(GEMINI_MODELS.length).toBeGreaterThan(0);
            expect(GEMINI_MODELS[0]).toHaveProperty("id");
            expect(GEMINI_MODELS[0]).toHaveProperty("name");
        });

        it("should have at least one Claude model", () => {
            expect(CLAUDE_MODELS.length).toBeGreaterThan(0);
            expect(CLAUDE_MODELS[0]).toHaveProperty("id");
            expect(CLAUDE_MODELS[0]).toHaveProperty("name");
        });

        it("should have at least one OpenAI model", () => {
            expect(OPENAI_MODELS.length).toBeGreaterThan(0);
            expect(OPENAI_MODELS[0]).toHaveProperty("id");
            expect(OPENAI_MODELS[0]).toHaveProperty("name");
        });
    });

    describe("DEFAULT_MODELS", () => {
        it("should have a default model for each provider", () => {
            expect(DEFAULT_MODELS).toHaveProperty("gemini");
            expect(DEFAULT_MODELS).toHaveProperty("claude");
            expect(DEFAULT_MODELS).toHaveProperty("openai");
        });

        it("should reference valid model IDs", () => {
            const geminiIds = GEMINI_MODELS.map((m) => m.id);
            const claudeIds = CLAUDE_MODELS.map((m) => m.id);
            const openaiIds = OPENAI_MODELS.map((m) => m.id);

            expect(geminiIds).toContain(DEFAULT_MODELS.gemini);
            expect(claudeIds).toContain(DEFAULT_MODELS.claude);
            expect(openaiIds).toContain(DEFAULT_MODELS.openai);
        });
    });

    describe("PROVIDER_LABELS", () => {
        it("should have a label for each provider", () => {
            const providers: LLMProvider[] = ["gemini", "claude", "openai"];
            for (const provider of providers) {
                expect(PROVIDER_LABELS[provider]).toBeDefined();
                expect(typeof PROVIDER_LABELS[provider]).toBe("string");
            }
        });
    });
});
