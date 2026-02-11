/**
 * Tests for Langfuse Prompt Management Client
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    fetchLangfusePromptList,
    testLangfuseConnection,
    sendLangfuseBatch,
    replacePromptVariables,
} from "./langfuse";
import { LangfuseConfig } from "./storage";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock btoa for Node.js environment
global.btoa = (str: string) => Buffer.from(str).toString("base64");

describe("langfuse", () => {
    const validConfig: LangfuseConfig = {
        enabled: true,
        publicKey: "pk-lf-test",
        secretKey: "sk-lf-test",
        host: "https://cloud.langfuse.com",
    };

    const disabledConfig: LangfuseConfig = {
        enabled: false,
        publicKey: "pk-lf-test",
        secretKey: "sk-lf-test",
        host: "https://cloud.langfuse.com",
    };

    beforeEach(() => {
        mockFetch.mockReset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("replacePromptVariables", () => {
        it("should replace single variable", () => {
            const content = "Hello, {{userName}}! Welcome.";
            const variables = [{ key: "userName", value: "Tino" }];
            const { result, missing } = replacePromptVariables(content, variables);
            expect(result).toBe("Hello, Tino! Welcome.");
            expect(missing).toEqual([]);
        });

        it("should replace multiple variables", () => {
            const content = "Hello, {{userName}}! Your role is {{role}}.";
            const variables = [
                { key: "userName", value: "Tino" },
                { key: "role", value: "Admin" },
            ];
            const { result, missing } = replacePromptVariables(content, variables);
            expect(result).toBe("Hello, Tino! Your role is Admin.");
            expect(missing).toEqual([]);
        });

        it("should track missing variables", () => {
            const content = "Hello, {{userName}}! Your role is {{role}}.";
            const variables = [{ key: "userName", value: "Tino" }];
            const { result, missing } = replacePromptVariables(content, variables);
            expect(result).toBe("Hello, Tino! Your role is {{role}}.");
            expect(missing).toEqual(["role"]);
        });

        it("should handle no variables in content", () => {
            const content = "Hello, World!";
            const variables = [{ key: "userName", value: "Tino" }];
            const { result, missing } = replacePromptVariables(content, variables);
            expect(result).toBe("Hello, World!");
            expect(missing).toEqual([]);
        });

        it("should handle empty variables array", () => {
            const content = "Hello, {{userName}}!";
            const { result, missing } = replacePromptVariables(content, []);
            expect(result).toBe("Hello, {{userName}}!");
            expect(missing).toEqual(["userName"]);
        });

        it("should not duplicate missing variables", () => {
            const content = "Hello, {{name}}! Goodbye, {{name}}!";
            const { result, missing } = replacePromptVariables(content, []);
            expect(result).toBe("Hello, {{name}}! Goodbye, {{name}}!");
            expect(missing).toEqual(["name"]);
        });

        it("should handle empty content", () => {
            const { result, missing } = replacePromptVariables("", [{ key: "test", value: "val" }]);
            expect(result).toBe("");
            expect(missing).toEqual([]);
        });
    });

    describe("fetchLangfusePromptList", () => {
        it("should return empty array when config is disabled", async () => {
            const result = await fetchLangfusePromptList(disabledConfig);
            expect(result).toEqual([]);
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it("should return empty array when publicKey is missing", async () => {
            const config = { ...validConfig, publicKey: "" };
            const result = await fetchLangfusePromptList(config);
            expect(result).toEqual([]);
        });

        it("should return empty array when secretKey is missing", async () => {
            const config = { ...validConfig, secretKey: "" };
            const result = await fetchLangfusePromptList(config);
            expect(result).toEqual([]);
        });

        it("should fetch prompts successfully", async () => {
            const mockResponse = {
                data: [
                    { name: "prompt-1", versions: [1, 2], labels: ["production"], tags: [] },
                    { name: "prompt-2", versions: [1], labels: [], tags: ["test"] },
                ],
                meta: { page: 1, limit: 100, totalItems: 2, totalPages: 1 },
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResponse,
            });

            const result = await fetchLangfusePromptList(validConfig);

            expect(result).toHaveLength(2);
            expect(result[0].name).toBe("prompt-1");
            expect(result[1].name).toBe("prompt-2");
            expect(mockFetch).toHaveBeenCalledWith(
                "https://cloud.langfuse.com/api/public/v2/prompts?limit=100",
                expect.objectContaining({
                    method: "GET",
                    headers: expect.objectContaining({
                        "Authorization": expect.stringMatching(/^Basic /),
                    }),
                })
            );
        });

        it("should throw error on 401 unauthorized", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 401,
            });

            await expect(fetchLangfusePromptList(validConfig)).rejects.toThrow(
                "Langfuse authentication failed"
            );
        });

        it("should throw error on other API errors", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
            });

            await expect(fetchLangfusePromptList(validConfig)).rejects.toThrow(
                "Langfuse API error: 500"
            );
        });

        it("should handle custom host with trailing slash", async () => {
            const configWithTrailingSlash = {
                ...validConfig,
                host: "https://custom.langfuse.com/",
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ data: [], meta: {} }),
            });

            await fetchLangfusePromptList(configWithTrailingSlash);

            expect(mockFetch).toHaveBeenCalledWith(
                "https://custom.langfuse.com/api/public/v2/prompts?limit=100",
                expect.anything()
            );
        });
    });

    describe("testLangfuseConnection", () => {
        it("should return success with prompt count", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    data: [{ name: "p1" }, { name: "p2" }, { name: "p3" }],
                    meta: {},
                }),
            });

            const result = await testLangfuseConnection(validConfig);

            expect(result.success).toBe(true);
            expect(result.promptCount).toBe(3);
            expect(result.error).toBeUndefined();
        });

        it("should return failure with error message on auth error", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 401,
            });

            const result = await testLangfuseConnection(validConfig);

            expect(result.success).toBe(false);
            expect(result.error).toBe("Langfuse authentication failed. Check your API keys.");
            expect(result.promptCount).toBeUndefined();
        });

        it("should return failure with generic message on unknown error", async () => {
            mockFetch.mockRejectedValueOnce("Network error");

            const result = await testLangfuseConnection(validConfig);

            expect(result.success).toBe(false);
            expect(result.error).toBe("Connection failed");
        });
    });

    describe("sendLangfuseBatch", () => {
        it("should not send when disabled", async () => {
            await sendLangfuseBatch(disabledConfig, {
                trace: { id: "trace-123", name: "test" },
                generation: {
                    id: "gen-123",
                    traceId: "trace-123",
                    name: "llm-call",
                    model: "gpt-4",
                    startTime: new Date(),
                },
            });

            expect(mockFetch).not.toHaveBeenCalled();
        });

        it("should batch trace and generation in single request", async () => {
            mockFetch.mockResolvedValueOnce({ ok: true });

            const startTime = new Date("2024-01-01T12:00:00Z");
            const endTime = new Date("2024-01-01T12:00:01Z");

            await sendLangfuseBatch(validConfig, {
                trace: {
                    id: "trace-123",
                    name: "chat-turn",
                    sessionId: "session-456",
                    input: "Hello",
                    output: "Hi there!",
                    metadata: { provider: "openai" },
                },
                generation: {
                    id: "gen-123",
                    traceId: "trace-123",
                    name: "llm-generation",
                    model: "gpt-4",
                    input: { system: "You are helpful", user: "Hello" },
                    output: "Hi there!",
                    startTime,
                    endTime,
                    usage: { input: 10, output: 5, total: 15 },
                },
            });

            expect(mockFetch).toHaveBeenCalledTimes(1);
            const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(callBody.batch).toHaveLength(2);
            expect(callBody.batch[0].type).toBe("trace-create");
            expect(callBody.batch[1].type).toBe("generation-create");
            expect(callBody.batch[1].body.type).toBe("GENERATION");
        });

        it("should include spans in batch", async () => {
            mockFetch.mockResolvedValueOnce({ ok: true });

            await sendLangfuseBatch(validConfig, {
                trace: { id: "trace-123", name: "test" },
                generation: {
                    id: "gen-123",
                    traceId: "trace-123",
                    name: "llm-call",
                    model: "gpt-4",
                    startTime: new Date(),
                },
                spans: [
                    {
                        id: "span-1",
                        traceId: "trace-123",
                        name: "tool_calculator",
                        startTime: new Date(),
                        endTime: new Date(),
                        input: { expression: "2+2" },
                        output: { result: 4 },
                    },
                    {
                        id: "span-2",
                        traceId: "trace-123",
                        name: "tool_calculator",
                        startTime: new Date(),
                    },
                ],
            });

            const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(callBody.batch).toHaveLength(4); // trace + generation + 2 spans
            expect(callBody.batch[2].type).toBe("span-create");
            expect(callBody.batch[3].type).toBe("span-create");
        });

        it("should include promptName and promptVersion in generation", async () => {
            mockFetch.mockResolvedValueOnce({ ok: true });

            await sendLangfuseBatch(validConfig, {
                trace: { id: "trace-123", name: "test" },
                generation: {
                    id: "gen-123",
                    traceId: "trace-123",
                    name: "llm-call",
                    model: "gpt-4",
                    startTime: new Date(),
                    promptName: "Default Agent",
                    promptVersion: 3,
                },
            });

            const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(callBody.batch[1].body.promptName).toBe("Default Agent");
            expect(callBody.batch[1].body.promptVersion).toBe(3);
        });

        it("should handle API errors gracefully", async () => {
            const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => { });
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
                text: async () => "Internal Server Error",
            });

            await sendLangfuseBatch(validConfig, {
                trace: { id: "trace-123", name: "test" },
                generation: {
                    id: "gen-123",
                    traceId: "trace-123",
                    name: "llm-call",
                    model: "gpt-4",
                    startTime: new Date(),
                },
            });

            expect(consoleSpy).toHaveBeenCalledWith(
                "[Langfuse] Ingestion failed:",
                expect.anything(),
                expect.anything()
            );
            consoleSpy.mockRestore();
        });
    });

    describe("sendLangfuseScore", () => {
        // Need to import sendLangfuseScore
        let sendLangfuseScore: typeof import("./langfuse").sendLangfuseScore;

        beforeEach(async () => {
            const module = await import("./langfuse");
            sendLangfuseScore = module.sendLangfuseScore;
        });

        it("should not send score when config is disabled", async () => {
            await sendLangfuseScore(disabledConfig, {
                traceId: "trace-123",
                name: "user-feedback",
                value: 1,
            });

            expect(mockFetch).not.toHaveBeenCalled();
        });

        it("should send score with valid config", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
            });

            await sendLangfuseScore(validConfig, {
                traceId: "trace-123",
                name: "user-feedback",
                value: 1,
            });

            expect(mockFetch).toHaveBeenCalledWith(
                "https://cloud.langfuse.com/api/public/scores",
                expect.objectContaining({
                    method: "POST",
                    headers: expect.objectContaining({
                        "Content-Type": "application/json",
                    }),
                })
            );

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.traceId).toBe("trace-123");
            expect(body.name).toBe("user-feedback");
            expect(body.value).toBe(1);
            expect(body.comment).toBeUndefined();
        });

        it("should include comment when provided", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
            });

            await sendLangfuseScore(validConfig, {
                traceId: "trace-123",
                name: "user-feedback",
                value: -1,
                comment: "Not helpful response",
            });

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.value).toBe(-1);
            expect(body.comment).toBe("Not helpful response");
        });

        it("should handle failed response", async () => {
            const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => { });

            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 400,
            });

            await sendLangfuseScore(validConfig, {
                traceId: "trace-123",
                name: "user-feedback",
                value: 1,
            });

            expect(consoleSpy).toHaveBeenCalledWith(
                "Failed to send Langfuse score:",
                400
            );
            consoleSpy.mockRestore();
        });

        it("should handle fetch error", async () => {
            const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => { });

            mockFetch.mockRejectedValueOnce(new Error("Network error"));

            await sendLangfuseScore(validConfig, {
                traceId: "trace-123",
                name: "user-feedback",
                value: 1,
            });

            expect(consoleSpy).toHaveBeenCalledWith(
                "Error sending Langfuse score:",
                expect.any(Error)
            );
            consoleSpy.mockRestore();
        });

        it("should use custom host when provided", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
            });

            const customHostConfig = {
                ...validConfig,
                host: "https://custom.langfuse.com",
            };

            await sendLangfuseScore(customHostConfig, {
                traceId: "trace-123",
                name: "user-feedback",
                value: 1,
            });

            expect(mockFetch).toHaveBeenCalledWith(
                "https://custom.langfuse.com/api/public/scores",
                expect.anything()
            );
        });
    });
});
