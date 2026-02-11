/**
 * Tests for claude.ts with streaming support
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies
vi.mock("@/tools/registry", () => ({
    getEnabledToolDeclarations: vi.fn(() => Promise.resolve([])),
    executeTool: vi.fn(),
}));

import { sendMessageClaude } from "./claude";
import { getEnabledToolDeclarations, executeTool } from "@/tools/registry";

/**
 * Create a mock SSE stream for Claude responses
 */
function createMockSSEStream(events: Array<{ event: string; data: object }>): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    const lines = events.map(e => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join("");
    const encoded = encoder.encode(lines);

    return new ReadableStream({
        start(controller) {
            controller.enqueue(encoded);
            controller.close();
        }
    });
}

/**
 * Create a mock Claude streaming response
 */
function createMockClaudeStreamResponse(
    text: string,
    toolUses?: Array<{ id: string; name: string; input: object }>,
    inputTokens = 10,
    outputTokens = 10
) {
    const events: Array<{ event: string; data: object }> = [];

    // message_start
    events.push({
        event: "message_start",
        data: { type: "message_start", message: { usage: { input_tokens: inputTokens } } }
    });

    if (toolUses && toolUses.length > 0) {
        // Content block for each tool use
        for (const tool of toolUses) {
            events.push({
                event: "content_block_start",
                data: { type: "content_block_start", content_block: { type: "tool_use", id: tool.id, name: tool.name } }
            });
            events.push({
                event: "content_block_delta",
                data: { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: JSON.stringify(tool.input) } }
            });
            events.push({
                event: "content_block_stop",
                data: { type: "content_block_stop", index: 0 }
            });
        }
    } else {
        // Text content
        events.push({
            event: "content_block_start",
            data: { type: "content_block_start", content_block: { type: "text", text: "" } }
        });
        events.push({
            event: "content_block_delta",
            data: { type: "content_block_delta", delta: { type: "text_delta", text: text } }
        });
        events.push({
            event: "content_block_stop",
            data: { type: "content_block_stop", index: 0 }
        });
    }

    // message_delta with usage
    events.push({
        event: "message_delta",
        data: { type: "message_delta", usage: { output_tokens: outputTokens } }
    });

    // message_stop
    events.push({
        event: "message_stop",
        data: { type: "message_stop" }
    });

    return {
        ok: true,
        body: createMockSSEStream(events),
    };
}

describe("sendMessageClaude", () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it("should send message without tools", async () => {
        (getEnabledToolDeclarations as ReturnType<typeof vi.fn>).mockResolvedValue([]);

        global.fetch = vi.fn().mockResolvedValue(createMockClaudeStreamResponse("Hello from Claude!"));

        const result = await sendMessageClaude("test-key", "claude-3-opus", [
            { role: "user", content: "Hello" },
        ]);

        expect(result.text).toBe("Hello from Claude!");
        expect(result.toolCalls).toEqual([]);
        expect(global.fetch).toHaveBeenCalledWith(
            "https://api.anthropic.com/v1/messages",
            expect.objectContaining({
                method: "POST",
                headers: expect.objectContaining({
                    "x-api-key": "test-key",
                    "anthropic-version": "2023-06-01",
                }),
            })
        );
    });

    it("should convert model role to assistant", async () => {
        (getEnabledToolDeclarations as ReturnType<typeof vi.fn>).mockResolvedValue([]);

        global.fetch = vi.fn().mockResolvedValue(createMockClaudeStreamResponse("Response"));

        await sendMessageClaude("test-key", "claude-3-opus", [
            { role: "user", content: "First" },
            { role: "model", content: "Middle" },
            { role: "user", content: "Last" },
        ]);

        const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
        const body = JSON.parse(fetchCall[1].body);

        expect(body.messages).toEqual([
            { role: "user", content: "First" },
            { role: "assistant", content: "Middle" },
            { role: "user", content: "Last" },
        ]);
    });

    it("should prepend user message if first message is assistant", async () => {
        (getEnabledToolDeclarations as ReturnType<typeof vi.fn>).mockResolvedValue([]);

        global.fetch = vi.fn().mockResolvedValue(createMockClaudeStreamResponse("Done"));

        await sendMessageClaude("test-key", "claude-3-opus", [
            { role: "model", content: "I start" },
            { role: "user", content: "Reply" },
        ]);

        const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
        const body = JSON.parse(fetchCall[1].body);

        expect(body.messages[0]).toEqual({ role: "user", content: "Hallo" });
        expect(body.messages[1]).toEqual({ role: "assistant", content: "I start" });
    });

    it("should handle API errors", async () => {
        (getEnabledToolDeclarations as ReturnType<typeof vi.fn>).mockResolvedValue([]);

        global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 403,
            text: () => Promise.resolve("Forbidden"),
        });

        await expect(
            sendMessageClaude("bad-key", "claude-3-opus", [{ role: "user", content: "Hello" }])
        ).rejects.toThrow("Claude API Error: 403 - Forbidden");
    });

    it("should handle tool calls", async () => {
        const mockTool = {
            name: "calculator",
            description: "Calculator",
            parameters: { properties: {}, required: [] },
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
                return Promise.resolve(createMockClaudeStreamResponse("", [{
                    id: "tool_123",
                    name: "calculator",
                    input: { expression: "21*2" }
                }]));
            } else {
                return Promise.resolve(createMockClaudeStreamResponse("The result is 42"));
            }
        });

        const result = await sendMessageClaude("test-key", "claude-3-opus", [
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
                properties: { arg: { type: "string" } },
                required: ["arg"],
            },
        }];

        (getEnabledToolDeclarations as ReturnType<typeof vi.fn>).mockResolvedValue(mockTools);

        global.fetch = vi.fn().mockResolvedValue(createMockClaudeStreamResponse("Done"));

        await sendMessageClaude("test-key", "claude-3-opus", [{ role: "user", content: "Test" }]);

        const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
        const body = JSON.parse(fetchCall[1].body);

        expect(body.tools).toBeDefined();
        expect(body.tools[0].name).toBe("test_tool");
        expect(body.tools[0].input_schema).toBeDefined();
    });

    it("should handle empty text content", async () => {
        (getEnabledToolDeclarations as ReturnType<typeof vi.fn>).mockResolvedValue([]);

        global.fetch = vi.fn().mockResolvedValue(createMockClaudeStreamResponse(""));

        const result = await sendMessageClaude("test-key", "claude-3-opus", [
            { role: "user", content: "Hello" },
        ]);

        expect(result.text).toBe("");
    });
});
