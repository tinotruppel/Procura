/**
 * Tests for gemini.ts with streaming support
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Create mock objects outside of vi.mock to avoid hoisting issues
const mockChat = {
    sendMessageStream: vi.fn(),
    sendMessage: vi.fn(),
};
const mockModel = {
    startChat: vi.fn(() => mockChat),
};

// Mock the dependencies before importing the module
vi.mock("@google/generative-ai", () => {
    // vitest 4.x requires class-based mocks for constructors
    return {
        GoogleGenerativeAI: class MockGoogleGenerativeAI {
            getGenerativeModel() {
                return mockModel;
            }
        },
        FunctionCallingMode: {
            AUTO: "AUTO",
        },
    };
});

vi.mock("@/tools/registry", () => ({
    getEnabledToolDeclarations: vi.fn(() => Promise.resolve([])),
    executeTool: vi.fn(),
}));

import { sendMessageGemini } from "./gemini";
import { getEnabledToolDeclarations, executeTool } from "@/tools/registry";

/**
 * Create a mock Gemini streaming result
 */
function createMockGeminiStreamResult(
    text: string,
    functionCalls?: Array<{ name: string; args: Record<string, unknown> }>
) {
    const chunks = text ? [{ text: () => text, functionCalls: () => functionCalls || null }] :
        [{ text: () => "", functionCalls: () => functionCalls || null }];

    return {
        stream: (async function* () {
            for (const chunk of chunks) {
                yield chunk;
            }
        })(),
        response: Promise.resolve({
            text: () => text,
            functionCalls: () => functionCalls || null,
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 }
        })
    };
}

describe("sendMessageGemini", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset mock implementations
        mockModel.startChat.mockReturnValue(mockChat);
    });

    it("should send message to Gemini without tools", async () => {
        (getEnabledToolDeclarations as ReturnType<typeof vi.fn>).mockResolvedValue([]);

        mockChat.sendMessageStream.mockResolvedValue(
            createMockGeminiStreamResult("Hello from Gemini!")
        );

        const result = await sendMessageGemini("test-key", "gemini-pro", [
            { role: "user", content: "Hello" },
        ]);

        expect(result.text).toBe("Hello from Gemini!");
        expect(result.toolCalls).toEqual([]);
    });

    it("should convert messages to Gemini format", async () => {
        (getEnabledToolDeclarations as ReturnType<typeof vi.fn>).mockResolvedValue([]);

        mockChat.sendMessageStream.mockResolvedValue(
            createMockGeminiStreamResult("Response")
        );

        await sendMessageGemini("test-key", "gemini-pro", [
            { role: "user", content: "First message" },
            { role: "model", content: "Response" },
            { role: "user", content: "Second message" },
        ]);

        expect(mockModel.startChat).toHaveBeenCalledWith({
            history: [
                { role: "user", parts: [{ text: "First message" }] },
                { role: "model", parts: [{ text: "Response" }] },
            ],
        });
        expect(mockChat.sendMessageStream).toHaveBeenCalledWith([{ text: "Second message" }]);
    });

    it("should handle function calls", async () => {
        const mockToolDeclaration = {
            name: "calculator",
            description: "Calculator",
            parameters: {},
        };

        (getEnabledToolDeclarations as ReturnType<typeof vi.fn>).mockResolvedValue([mockToolDeclaration]);
        (executeTool as ReturnType<typeof vi.fn>).mockResolvedValue({
            success: true,
            data: { result: 42 },
        });

        // First call returns a function call (streaming)
        mockChat.sendMessageStream.mockResolvedValue(
            createMockGeminiStreamResult("", [
                { name: "calculator", args: { expression: "21*2" } },
            ])
        );

        // Function response uses sendMessage (non-streaming)
        mockChat.sendMessage.mockResolvedValue({
            response: {
                text: () => "The result is 42",
                functionCalls: () => null,
                usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 },
            },
        });

        const result = await sendMessageGemini("test-key", "gemini-pro", [
            { role: "user", content: "Calculate 21*2" },
        ]);

        expect(result.text).toBe("The result is 42");
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0].name).toBe("calculator");
        expect(result.toolCalls[0].result).toEqual({ success: true, data: { result: 42 } });
    });

    it("should handle tool errors", async () => {
        (getEnabledToolDeclarations as ReturnType<typeof vi.fn>).mockResolvedValue([{ name: "test" }]);
        (executeTool as ReturnType<typeof vi.fn>).mockResolvedValue({
            success: false,
            error: "Tool failed",
        });

        // First call returns a function call (streaming)
        mockChat.sendMessageStream.mockResolvedValue(
            createMockGeminiStreamResult("", [{ name: "test", args: {} }])
        );

        // Function response uses sendMessage (non-streaming)
        mockChat.sendMessage.mockResolvedValue({
            response: {
                text: () => "Error occurred",
                functionCalls: () => null,
                usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 },
            },
        });

        const result = await sendMessageGemini("test-key", "gemini-pro", [
            { role: "user", content: "Test" },
        ]);

        expect(result.toolCalls[0].result?.success).toBe(false);
        expect(result.toolCalls[0].result?.error).toBe("Tool failed");
    });
});
