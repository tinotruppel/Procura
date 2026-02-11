/**
 * Tests for custom-openai.ts - Custom OpenAI-Compatible Provider
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies
vi.mock("@/tools/registry", () => ({
    getEnabledToolDeclarations: vi.fn(() => Promise.resolve([])),
    executeTool: vi.fn(),
}));

import { fetchCustomModels, sendMessageCustomOpenAI } from "./custom-openai";
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
function createMockStreamResponse(content: string, toolCalls?: Array<{ id: string; name: string; arguments: string }>) {
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

describe("custom-openai", () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    describe("fetchCustomModels", () => {
        it("should fetch and parse models from /v1/models endpoint", async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    data: [
                        { id: "gpt-4", name: "GPT-4" },
                        { id: "gpt-3.5-turbo" },  // name defaults to id
                        { id: "claude-3" },
                    ]
                }),
            });

            const models = await fetchCustomModels("http://localhost:4000", "test-key");

            expect(models).toHaveLength(3);
            expect(models[0]).toEqual({ id: "claude-3", name: "claude-3" });  // sorted alphabetically
            expect(models[1]).toEqual({ id: "gpt-3.5-turbo", name: "gpt-3.5-turbo" });
            expect(models[2]).toEqual({ id: "gpt-4", name: "GPT-4" });

            expect(global.fetch).toHaveBeenCalledWith(
                "http://localhost:4000/v1/models",
                expect.objectContaining({
                    method: "GET",
                    headers: expect.objectContaining({
                        "Authorization": "Bearer test-key",
                    }),
                })
            );
        });

        it("should handle trailing slash in base URL", async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ data: [] }),
            });

            await fetchCustomModels("http://localhost:4000/", "test-key");

            expect(global.fetch).toHaveBeenCalledWith(
                "http://localhost:4000/v1/models",
                expect.anything()
            );
        });

        it("should throw error on API failure", async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 401,
                text: () => Promise.resolve("Unauthorized"),
            });

            await expect(
                fetchCustomModels("http://localhost:4000", "bad-key")
            ).rejects.toThrow("Failed to fetch models: 401 - Unauthorized");
        });

        it("should handle empty data array", async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ data: [] }),
            });

            const models = await fetchCustomModels("http://localhost:4000", "test-key");
            expect(models).toEqual([]);
        });

        it("should handle missing data field", async () => {
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({}),
            });

            const models = await fetchCustomModels("http://localhost:4000", "test-key");
            expect(models).toEqual([]);
        });
    });

    describe("sendMessageCustomOpenAI", () => {
        it("should send message to custom endpoint", async () => {
            (getEnabledToolDeclarations as ReturnType<typeof vi.fn>).mockResolvedValue([]);

            global.fetch = vi.fn().mockResolvedValue(createMockStreamResponse("Hello from custom API!"));

            const result = await sendMessageCustomOpenAI(
                "http://localhost:4000",
                "test-key",
                "gpt-4",
                [{ role: "user", content: "Hello" }]
            );

            expect(result.text).toBe("Hello from custom API!");
            expect(result.toolCalls).toEqual([]);
            expect(global.fetch).toHaveBeenCalledWith(
                "http://localhost:4000/v1/chat/completions",
                expect.objectContaining({
                    method: "POST",
                    headers: expect.objectContaining({
                        "Authorization": "Bearer test-key",
                    }),
                })
            );
        });

        it("should include system prompt when provided", async () => {
            (getEnabledToolDeclarations as ReturnType<typeof vi.fn>).mockResolvedValue([]);

            global.fetch = vi.fn().mockResolvedValue(createMockStreamResponse("Response"));

            await sendMessageCustomOpenAI(
                "http://localhost:4000",
                "test-key",
                "gpt-4",
                [{ role: "user", content: "Hello" }],
                "You are a helpful assistant."
            );

            const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
            const body = JSON.parse(fetchCall[1].body);

            expect(body.messages[0]).toEqual({
                role: "system",
                content: "You are a helpful assistant."
            });
        });

        it("should convert model role to assistant", async () => {
            (getEnabledToolDeclarations as ReturnType<typeof vi.fn>).mockResolvedValue([]);

            global.fetch = vi.fn().mockResolvedValue(createMockStreamResponse("Response"));

            await sendMessageCustomOpenAI(
                "http://localhost:4000",
                "test-key",
                "gpt-4",
                [
                    { role: "user", content: "First" },
                    { role: "model", content: "Middle" },
                    { role: "user", content: "Last" },
                ]
            );

            const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
            const body = JSON.parse(fetchCall[1].body);

            expect(body.messages[1].role).toBe("assistant");
        });

        it("should handle API errors", async () => {
            (getEnabledToolDeclarations as ReturnType<typeof vi.fn>).mockResolvedValue([]);

            global.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 500,
                text: () => Promise.resolve("Internal Server Error"),
            });

            await expect(
                sendMessageCustomOpenAI(
                    "http://localhost:4000",
                    "test-key",
                    "gpt-4",
                    [{ role: "user", content: "Hello" }]
                )
            ).rejects.toThrow("API Error: 500 - Internal Server Error");
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
                    return Promise.resolve(createMockStreamResponse("", [{
                        id: "call_123",
                        name: "calculator",
                        arguments: '{"expression": "21*2"}'
                    }]));
                } else {
                    return Promise.resolve(createMockStreamResponse("The result is 42"));
                }
            });

            const result = await sendMessageCustomOpenAI(
                "http://localhost:4000",
                "test-key",
                "gpt-4",
                [{ role: "user", content: "Calculate 21*2" }]
            );

            expect(result.text).toBe("The result is 42");
            expect(result.toolCalls).toHaveLength(1);
            expect(result.toolCalls[0].name).toBe("calculator");
            expect(result.toolCalls[0].result?.success).toBe(true);
        });

        it("should handle messages with images", async () => {
            (getEnabledToolDeclarations as ReturnType<typeof vi.fn>).mockResolvedValue([]);

            global.fetch = vi.fn().mockResolvedValue(createMockStreamResponse("I see an image"));

            await sendMessageCustomOpenAI(
                "http://localhost:4000",
                "test-key",
                "gpt-4-vision",
                [{
                    role: "user",
                    content: "What's in this image?",
                    images: ["data:image/png;base64,abc123"]
                }]
            );

            const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
            const body = JSON.parse(fetchCall[1].body);

            expect(body.messages[0].content).toEqual([
                { type: "image_url", image_url: { url: "data:image/png;base64,abc123" } },
                { type: "text", text: "What's in this image?" }
            ]);
        });

        it("should call debug callback with events", async () => {
            (getEnabledToolDeclarations as ReturnType<typeof vi.fn>).mockResolvedValue([]);

            global.fetch = vi.fn().mockResolvedValue(createMockStreamResponse("Response"));

            const debugCallback = vi.fn();

            await sendMessageCustomOpenAI(
                "http://localhost:4000",
                "test-key",
                "gpt-4",
                [{ role: "user", content: "Hello" }],
                undefined,
                debugCallback
            );

            expect(debugCallback).toHaveBeenCalled();
            expect(debugCallback.mock.calls[0][0].type).toBe("llm");
        });

        it("should call text chunk callback during streaming", async () => {
            (getEnabledToolDeclarations as ReturnType<typeof vi.fn>).mockResolvedValue([]);

            global.fetch = vi.fn().mockResolvedValue(createMockStreamResponse("Streamed content"));

            const textChunkCallback = vi.fn();

            await sendMessageCustomOpenAI(
                "http://localhost:4000",
                "test-key",
                "gpt-4",
                [{ role: "user", content: "Hello" }],
                undefined,
                undefined,
                textChunkCallback
            );

            expect(textChunkCallback).toHaveBeenCalledWith("Streamed content");
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

            global.fetch = vi.fn().mockResolvedValue(createMockStreamResponse("Done"));

            await sendMessageCustomOpenAI(
                "http://localhost:4000",
                "test-key",
                "gpt-4",
                [{ role: "user", content: "Test" }]
            );

            const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
            const body = JSON.parse(fetchCall[1].body);

            expect(body.tools).toBeDefined();
            expect(body.tools[0].function.name).toBe("test_tool");
            expect(body.tool_choice).toBe("auto");
        });

        it("should handle trailing slash in base URL", async () => {
            (getEnabledToolDeclarations as ReturnType<typeof vi.fn>).mockResolvedValue([]);

            global.fetch = vi.fn().mockResolvedValue(createMockStreamResponse("Response"));

            await sendMessageCustomOpenAI(
                "http://localhost:4000/",
                "test-key",
                "gpt-4",
                [{ role: "user", content: "Hello" }]
            );

            expect(global.fetch).toHaveBeenCalledWith(
                "http://localhost:4000/v1/chat/completions",
                expect.anything()
            );
        });

        it("should return debug info with token usage", async () => {
            (getEnabledToolDeclarations as ReturnType<typeof vi.fn>).mockResolvedValue([]);

            global.fetch = vi.fn().mockResolvedValue(createMockStreamResponse("Response"));

            const result = await sendMessageCustomOpenAI(
                "http://localhost:4000",
                "test-key",
                "gpt-4",
                [{ role: "user", content: "Hello" }]
            );

            expect(result.debug).toBeDefined();
            expect(result.debug?.inputTokens).toBe(10);
            expect(result.debug?.outputTokens).toBe(10);
            expect(result.debug?.model).toBe("gpt-4");
        });

        it("should handle tool call with invalid JSON arguments gracefully", async () => {
            const mockTool = {
                name: "calculator",
                description: "Calculator tool",
                parameters: { type: "object", properties: {} },
            };

            (getEnabledToolDeclarations as ReturnType<typeof vi.fn>).mockResolvedValue([mockTool]);
            (executeTool as ReturnType<typeof vi.fn>).mockResolvedValue({
                success: true,
                data: {},
            });

            let callCount = 0;
            global.fetch = vi.fn().mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return Promise.resolve(createMockStreamResponse("", [{
                        id: "call_123",
                        name: "calculator",
                        arguments: "invalid-json"
                    }]));
                } else {
                    return Promise.resolve(createMockStreamResponse("Done"));
                }
            });

            const result = await sendMessageCustomOpenAI(
                "http://localhost:4000",
                "test-key",
                "gpt-4",
                [{ role: "user", content: "Test" }]
            );

            expect(result.text).toBe("Done");
            expect(result.toolCalls[0].args).toEqual({});
        });
    });
});
