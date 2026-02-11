/**
 * Tests for openai.ts with streaming support
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies
vi.mock("@/tools/registry", () => ({
    getEnabledToolDeclarations: vi.fn(() => Promise.resolve([])),
    executeTool: vi.fn(),
}));

import { sendMessageOpenAI } from "./openai";
import { getEnabledToolDeclarations, executeTool } from "@/tools/registry";

/**
 * Create a mock SSE stream for OpenAI responses
 */
function createMockSSEStream(events: Array<{ data: string }>): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    const lines = events.map(e => `data: ${e.data}\n\n`).join("");
    const encoded = encoder.encode(lines);

    return new ReadableStream({
        start(controller) {
            controller.enqueue(encoded);
            controller.close();
        }
    });
}

/**
 * Create a mock OpenAI streaming response
 */
function createMockOpenAIStreamResponse(content: string, toolCalls?: Array<{ id: string; name: string; arguments: string }>) {
    const events: Array<{ data: string }> = [];

    if (toolCalls && toolCalls.length > 0) {
        // Send tool calls
        for (let i = 0; i < toolCalls.length; i++) {
            const tc = toolCalls[i];
            events.push({
                data: JSON.stringify({
                    id: "chatcmpl-123",
                    object: "chat.completion.chunk",
                    choices: [{
                        index: 0,
                        delta: {
                            tool_calls: [{
                                index: i,
                                id: tc.id,
                                type: "function",
                                function: { name: tc.name, arguments: tc.arguments }
                            }]
                        },
                        finish_reason: null
                    }]
                })
            });
        }
        // Final chunk with finish reason
        events.push({
            data: JSON.stringify({
                id: "chatcmpl-123",
                object: "chat.completion.chunk",
                choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
                usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
            })
        });
    } else {
        // Send content chunks
        events.push({
            data: JSON.stringify({
                id: "chatcmpl-123",
                object: "chat.completion.chunk",
                choices: [{
                    index: 0,
                    delta: { role: "assistant", content: content },
                    finish_reason: null
                }]
            })
        });
        // Final chunk
        events.push({
            data: JSON.stringify({
                id: "chatcmpl-123",
                object: "chat.completion.chunk",
                choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
                usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
            })
        });
    }

    events.push({ data: "[DONE]" });

    return {
        ok: true,
        body: createMockSSEStream(events),
    };
}

describe("sendMessageOpenAI", () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it("should send message without tools", async () => {
        (getEnabledToolDeclarations as ReturnType<typeof vi.fn>).mockResolvedValue([]);

        global.fetch = vi.fn().mockResolvedValue(createMockOpenAIStreamResponse("Hello from OpenAI!"));

        const result = await sendMessageOpenAI("test-key", "gpt-4", [
            { role: "user", content: "Hello" },
        ]);

        expect(result.text).toBe("Hello from OpenAI!");
        expect(result.toolCalls).toEqual([]);
        expect(global.fetch).toHaveBeenCalledWith(
            "https://api.openai.com/v1/chat/completions",
            expect.objectContaining({
                method: "POST",
                headers: expect.objectContaining({
                    "Authorization": "Bearer test-key",
                }),
            })
        );
    });

    it("should convert model role correctly", async () => {
        (getEnabledToolDeclarations as ReturnType<typeof vi.fn>).mockResolvedValue([]);

        global.fetch = vi.fn().mockResolvedValue(createMockOpenAIStreamResponse("Response"));

        await sendMessageOpenAI("test-key", "gpt-4", [
            { role: "user", content: "First" },
            { role: "model", content: "Middle" },
            { role: "user", content: "Last" },
        ]);

        const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
        const body = JSON.parse(fetchCall[1].body);

        expect(body.messages).toEqual(expect.arrayContaining([
            expect.objectContaining({ role: "user", content: "First" }),
            expect.objectContaining({ role: "assistant", content: "Middle" }),
            expect.objectContaining({ role: "user", content: "Last" }),
        ]));
    });

    it("should handle API errors", async () => {
        (getEnabledToolDeclarations as ReturnType<typeof vi.fn>).mockResolvedValue([]);

        global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 401,
            text: () => Promise.resolve("Invalid API key"),
        });

        await expect(
            sendMessageOpenAI("bad-key", "gpt-4", [{ role: "user", content: "Hello" }])
        ).rejects.toThrow("OpenAI API Error: 401 - Invalid API key");
    });

    it("should handle tool calls", async () => {
        const mockTool = {
            name: "calculator",
            description: "Calculator tool",
            parameters: {
                type: "object",
                properties: { expression: { type: "string" } },
                required: ["expression"],
            },
        };

        (getEnabledToolDeclarations as ReturnType<typeof vi.fn>).mockResolvedValue([mockTool]);
        (executeTool as ReturnType<typeof vi.fn>).mockResolvedValue({
            success: true,
            data: { result: 42 },
        });

        let callCount = 0;
        global.fetch = vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
                // First call returns tool call
                return Promise.resolve(createMockOpenAIStreamResponse("", [{
                    id: "call_123",
                    name: "calculator",
                    arguments: '{"expression": "21*2"}'
                }]));
            } else {
                // Second call returns final response
                return Promise.resolve(createMockOpenAIStreamResponse("The result is 42"));
            }
        });

        const result = await sendMessageOpenAI("test-key", "gpt-4", [
            { role: "user", content: "Calculate 21*2" },
        ]);

        expect(result.text).toBe("The result is 42");
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0].name).toBe("calculator");
        expect(result.toolCalls[0].result?.success).toBe(true);
    });

    it("should include tools in request when available", async () => {
        const mockTools = [{
            name: "test_tool",
            description: "A test tool",
            parameters: {
                type: "object",
                properties: { arg: { type: "string" } },
                required: ["arg"],
            },
        }];

        (getEnabledToolDeclarations as ReturnType<typeof vi.fn>).mockResolvedValue(mockTools);

        global.fetch = vi.fn().mockResolvedValue(createMockOpenAIStreamResponse("Done"));

        await sendMessageOpenAI("test-key", "gpt-4", [{ role: "user", content: "Test" }]);

        const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
        const body = JSON.parse(fetchCall[1].body);

        expect(body.tools).toBeDefined();
        expect(body.tools[0].function.name).toBe("test_tool");
        expect(body.tool_choice).toBe("auto");
    });
});
