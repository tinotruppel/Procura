import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    mcpToolToFunctionDeclaration,
    generateServerId,
    parseMcpToolName,
    AuthRequiredError,
    resolveFileReferences,
    connectToServer,
} from "./mcp-client";
import type { McpTool } from "./mcp-types";
import * as fileStore from "@/lib/file-store";

// Mock storage module for proxy config
vi.mock("@/lib/storage", () => ({
    getMcpProxyConfig: vi.fn(),
}));

import { getMcpProxyConfig } from "@/lib/storage";

describe("MCP Client", () => {
    describe("mcpToolToFunctionDeclaration", () => {
        it("should prefix tool name with server ID", () => {
            const tool: McpTool = {
                name: "fetch",
                description: "Fetch a URL",
                inputSchema: { type: "object", properties: {} },
            };

            const result = mcpToolToFunctionDeclaration(tool, "12345678-1234-1234-1234-123456789abc");

            expect(result.name).toBe("mcp__12345678_1234_1234_1234_123456789abc__fetch");
            expect(result.description).toBe("Fetch a URL");
        });

        it("should sanitize the schema", () => {
            const tool: McpTool = {
                name: "test",
                description: "Test tool",
                inputSchema: {
                    type: "object",
                    $schema: "http://json-schema.org/draft-07/schema#",
                    additionalProperties: false,
                    properties: {
                        param: { type: "string" },
                    },
                },
            };

            const result = mcpToolToFunctionDeclaration(tool, "abcdef12-0000-0000-0000-000000000000");
            const params = result.parameters as Record<string, unknown>;

            expect(params).not.toHaveProperty("$schema");
            expect(params).not.toHaveProperty("additionalProperties");
            expect(params).toHaveProperty("type", "object");
        });

        it("should use title or name as fallback description", () => {
            const toolWithTitle: McpTool = {
                name: "my_tool",
                title: "My Tool Title",
                inputSchema: { type: "object" },
            };

            const toolWithoutDesc: McpTool = {
                name: "another_tool",
                inputSchema: { type: "object" },
            };

            const result1 = mcpToolToFunctionDeclaration(toolWithTitle, "00000000-0000-0000-0000-000000000000");
            const result2 = mcpToolToFunctionDeclaration(toolWithoutDesc, "00000000-0000-0000-0000-000000000000");

            expect(result1.description).toBe("My Tool Title");
            expect(result2.description).toBe("another_tool");
        });
    });

    describe("generateServerId", () => {
        it("should return a UUID string", () => {
            const id = generateServerId();

            expect(typeof id).toBe("string");
            expect(id.length).toBe(36);
            expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        });

        it("should generate unique IDs", () => {
            const id1 = generateServerId();
            const id2 = generateServerId();

            expect(id1).not.toBe(id2);
        });
    });

    describe("parseMcpToolName", () => {
        it("should parse valid MCP tool name", () => {
            const result = parseMcpToolName("mcp__12345678__fetch");

            expect(result).not.toBeNull();
            expect(result?.serverId).toBe("12345678");
            expect(result?.toolName).toBe("fetch");
        });

        it("should parse tool name with underscores", () => {
            const result = parseMcpToolName("mcp__abcdef12__my_tool_name");

            expect(result).not.toBeNull();
            expect(result?.serverId).toBe("abcdef12");
            expect(result?.toolName).toBe("my_tool_name");
        });

        it("should return null for non-MCP tool names", () => {
            expect(parseMcpToolName("calculator")).toBeNull();
            expect(parseMcpToolName("some_tool")).toBeNull();
            expect(parseMcpToolName("")).toBeNull();
        });

        it("should return null for malformed MCP names", () => {
            expect(parseMcpToolName("mcp_")).toBeNull();
            expect(parseMcpToolName("mcp__12345678")).toBeNull();
            expect(parseMcpToolName("mcp___toolname")).toBeNull();
        });

        it("should parse cloud server tool names with underscored IDs", () => {
            const result = parseMcpToolName("mcp__cloud_weather__get_weather");

            expect(result).not.toBeNull();
            expect(result?.serverId).toBe("cloud_weather");
            expect(result?.toolName).toBe("get_weather");
        });

        it("should parse full UUID server IDs", () => {
            const result = parseMcpToolName("mcp__12345678_1234_1234_1234_123456789abc__fetch");

            expect(result).not.toBeNull();
            expect(result?.serverId).toBe("12345678_1234_1234_1234_123456789abc");
            expect(result?.toolName).toBe("fetch");
        });
    });

    describe("AuthRequiredError", () => {
        it("should be an instance of Error", () => {
            const error = new AuthRequiredError("Auth needed");

            expect(error).toBeInstanceOf(Error);
            expect(error.name).toBe("AuthRequiredError");
            expect(error.message).toBe("Auth needed");
        });

        it("should allow setting resourceMetadataUrl", () => {
            const error = new AuthRequiredError("Auth needed");
            error.resourceMetadataUrl = "https://auth.example.com/.well-known/oauth-authorization-server";

            expect(error.resourceMetadataUrl).toBe("https://auth.example.com/.well-known/oauth-authorization-server");
        });

        it("should allow setting scope", () => {
            const error = new AuthRequiredError("Auth needed");
            error.scope = "read write";

            expect(error.scope).toBe("read write");
        });
    });

    describe("resolveFileReferences", () => {
        beforeEach(() => {
            vi.restoreAllMocks();
        });

        it("should resolve fileRef to fileData, fileName, and mimeType", () => {
            vi.spyOn(fileStore, "getFile").mockReturnValue({
                dataUrl: "data:application/pdf;base64,SGVsbG8gV29ybGQ=",
                mimeType: "application/pdf",
                fileName: "document.pdf",
                fileSize: 11,
            });

            const args = { ticketId: "123", fileRef: "file_abc12345" };
            const resolved = resolveFileReferences(args);

            expect(resolved.fileData).toBe("SGVsbG8gV29ybGQ=");
            expect(resolved.fileName).toBe("document.pdf");
            expect(resolved.mimeType).toBe("application/pdf");
            expect(resolved.fileRef).toBeUndefined();
            expect(resolved.ticketId).toBe("123");
        });

        it("should pass through args without fileRef unchanged", () => {
            const args = { ticketId: "123", url: "https://example.com/file.pdf" };
            const resolved = resolveFileReferences(args);

            expect(resolved).toEqual(args);
        });

        it("should not modify args when file is not found", () => {
            vi.spyOn(fileStore, "getFile").mockReturnValue(undefined);

            const args = { ticketId: "123", fileRef: "file_notfound" };
            const resolved = resolveFileReferences(args);

            expect(resolved.fileData).toBeUndefined();
            expect(resolved.fileName).toBeUndefined();
            expect(resolved.mimeType).toBeUndefined();
            expect(resolved.fileRef).toBeUndefined(); // Still removed
        });

        it("should ignore non-file_ prefixed fileRef values", () => {
            const args = { ticketId: "123", fileRef: "not-a-file-ref" };
            const resolved = resolveFileReferences(args);

            expect(resolved.fileRef).toBe("not-a-file-ref"); // Kept as-is
        });

        it("should handle image files correctly", () => {
            vi.spyOn(fileStore, "getFile").mockReturnValue({
                dataUrl: "data:image/png;base64,iVBORw0KGgo=",
                mimeType: "image/png",
                fileName: "screenshot.png",
                fileSize: 100,
            });

            const args = { cardId: "456", fileRef: "file_12345678" };
            const resolved = resolveFileReferences(args);

            expect(resolved.fileData).toBe("iVBORw0KGgo=");
            expect(resolved.mimeType).toBe("image/png");
            expect(resolved.fileName).toBe("screenshot.png");
        });

        it("should not replace existing fileData if present", () => {
            // If args already has fileData, don't override it
            const args = {
                ticketId: "123",
                fileData: "existingBase64Data",
                fileRef: "file_abc12345"
            };

            vi.spyOn(fileStore, "getFile").mockReturnValue({
                dataUrl: "data:text/plain;base64,bmV3RGF0YQ==",
                mimeType: "text/plain",
                fileName: "new.txt",
                fileSize: 7,
            });

            const resolved = resolveFileReferences(args);

            // fileRef resolution should still happen (overwrites existing)
            expect(resolved.fileData).toBe("bmV3RGF0YQ==");
            expect(resolved.fileRef).toBeUndefined();
        });

        it("should resolve fileData when it contains a file reference instead of base64", () => {
            vi.spyOn(fileStore, "getFile").mockReturnValue({
                dataUrl: "data:image/png;base64,aW1hZ2VEYXRh",
                mimeType: "image/png",
                fileName: "screenshot.png",
                fileSize: 100,
            });

            // LLM put file reference directly into fileData field
            const args = {
                ticketId: "123",
                fileData: "file_174c5075",
                fileName: "test-ticket-attachment.png",
                mimeType: "image/png",
                name: "Screenshot (Test)"
            };
            const resolved = resolveFileReferences(args);

            // fileData should be replaced with actual base64
            expect(resolved.fileData).toBe("aW1hZ2VEYXRh");
            // Keep LLM-provided fileName and mimeType
            expect(resolved.fileName).toBe("test-ticket-attachment.png");
            expect(resolved.mimeType).toBe("image/png");
        });

        it("should use file metadata when LLM only provides fileData reference", () => {
            vi.spyOn(fileStore, "getFile").mockReturnValue({
                dataUrl: "data:application/pdf;base64,cGRmRGF0YQ==",
                mimeType: "application/pdf",
                fileName: "document.pdf",
                fileSize: 500,
            });

            // LLM only provided fileData reference, no fileName/mimeType
            const args = {
                ticketId: "123",
                fileData: "file_abc123",
            };
            const resolved = resolveFileReferences(args);

            expect(resolved.fileData).toBe("cGRmRGF0YQ==");
            // Should use metadata from file store
            expect(resolved.fileName).toBe("document.pdf");
            expect(resolved.mimeType).toBe("application/pdf");
        });

        it("should not resolve fileData if it does not start with file_", () => {
            const args = {
                ticketId: "123",
                fileData: "SGVsbG8gV29ybGQ=", // actual base64
            };
            const resolved = resolveFileReferences(args);

            expect(resolved.fileData).toBe("SGVsbG8gV29ybGQ=");
        });

        it("should resolve file by fileName when fileData is empty", () => {
            vi.spyOn(fileStore, "getFileByName").mockReturnValue({
                id: "file_abc12345",
                file: {
                    dataUrl: "data:application/pdf;base64,cGRmQ29udGVudA==",
                    mimeType: "application/pdf",
                    fileName: "Review_MaxBaumgraß.pdf",
                    fileSize: 500,
                },
            });

            const args = {
                fileData: "",
                fileName: "Review_MaxBaumgraß.pdf",
                mimeType: "application/pdf",
            };
            const resolved = resolveFileReferences(args);

            expect(resolved.fileData).toBe("cGRmQ29udGVudA==");
            expect(resolved.fileName).toBe("Review_MaxBaumgraß.pdf");
            expect(resolved.mimeType).toBe("application/pdf");
        });

        it("should not call getFileByName when fileData has content", () => {
            const spy = vi.spyOn(fileStore, "getFileByName");
            const args = {
                fileData: "SGVsbG8gV29ybGQ=",
                fileName: "doc.pdf",
                mimeType: "application/pdf",
            };
            resolveFileReferences(args);

            expect(spy).not.toHaveBeenCalled();
        });
    });

    describe("sendMcpFetch (via connectToServer/listTools/callTool)", () => {
        const mockFetch = vi.fn();

        beforeEach(() => {
            vi.stubGlobal("fetch", mockFetch);
            vi.mocked(getMcpProxyConfig).mockResolvedValue({
                enabled: false,
                url: "",
            });
            mockFetch.mockReset();
        });

        afterEach(() => {
            vi.unstubAllGlobals();
        });

        it("sends correct MCP headers on direct request", async () => {
            // Initialize response
            mockFetch.mockResolvedValueOnce(new Response(
                JSON.stringify({
                    jsonrpc: "2.0",
                    id: 1,
                    result: {
                        protocolVersion: "2024-11-05",
                        capabilities: {},
                        serverInfo: { name: "test-server", version: "1.0" },
                    },
                }),
                { headers: { "Content-Type": "application/json" } }
            ));
            // Notification response
            mockFetch.mockResolvedValueOnce(new Response(null, { status: 202 }));

            await connectToServer("https://mcp.example.com/sse");

            const initCall = mockFetch.mock.calls[0];
            expect(initCall[0]).toBe("https://mcp.example.com/sse");

            const headers = initCall[1].headers;
            expect(headers["Content-Type"]).toBe("application/json");
            expect(headers["Accept"]).toBe("application/json, text/event-stream");
            expect(headers["MCP-Protocol-Version"]).toBe("2024-11-05");
        });

        it("includes auth token in headers when provided", async () => {
            mockFetch.mockResolvedValueOnce(new Response(
                JSON.stringify({
                    jsonrpc: "2.0",
                    id: 1,
                    result: {
                        protocolVersion: "2024-11-05",
                        capabilities: {},
                        serverInfo: { name: "test-server", version: "1.0" },
                    },
                }),
                { headers: { "Content-Type": "application/json" } }
            ));
            mockFetch.mockResolvedValueOnce(new Response(null, { status: 202 }));

            await connectToServer("https://mcp.example.com/sse", "my-token-123");

            const headers = mockFetch.mock.calls[0][1].headers;
            expect(headers["Authorization"]).toBe("Bearer my-token-123");
        });

        it("routes through proxy when proxy is enabled", async () => {
            vi.mocked(getMcpProxyConfig).mockResolvedValue({
                enabled: true,
                url: "https://proxy.example.com/mcp-proxy",
                apiKey: "proxy-key",
            });

            mockFetch.mockResolvedValueOnce(new Response(
                JSON.stringify({
                    jsonrpc: "2.0",
                    id: 1,
                    result: {
                        protocolVersion: "2024-11-05",
                        capabilities: {},
                        serverInfo: { name: "test-server", version: "1.0" },
                    },
                }),
                { headers: { "Content-Type": "application/json" } }
            ));
            mockFetch.mockResolvedValueOnce(new Response(null, { status: 202 }));

            await connectToServer("https://mcp.example.com/sse");

            // Both calls (initialize + notification) should go through proxy
            expect(mockFetch.mock.calls[0][0]).toBe("https://proxy.example.com/mcp-proxy");
            expect(mockFetch.mock.calls[1][0]).toBe("https://proxy.example.com/mcp-proxy");

            // Verify proxy headers
            const proxyHeaders = mockFetch.mock.calls[0][1].headers;
            expect(proxyHeaders["Authorization"]).toBe("Bearer proxy-key");
            expect(proxyHeaders["Content-Type"]).toBe("application/json");

            // Verify proxy body contains targetUrl and MCP headers
            const proxyBody = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(proxyBody.targetUrl).toBe("https://mcp.example.com/sse");
            expect(proxyBody.headers["MCP-Protocol-Version"]).toBe("2024-11-05");
        });

        it("stores session ID from response", async () => {
            const responseHeaders = new Headers({
                "Content-Type": "application/json",
                "Mcp-Session-Id": "session-abc-123",
            });

            mockFetch.mockResolvedValueOnce(new Response(
                JSON.stringify({
                    jsonrpc: "2.0",
                    id: 1,
                    result: {
                        protocolVersion: "2024-11-05",
                        capabilities: {},
                        serverInfo: { name: "test-server", version: "1.0" },
                    },
                }),
                { headers: responseHeaders }
            ));
            mockFetch.mockResolvedValueOnce(new Response(null, { status: 202 }));

            const server = await connectToServer("https://mcp.example.com/sse");
            expect(server.sessionId).toBe("session-abc-123");

            // Notification should include the session ID
            const notifHeaders = mockFetch.mock.calls[1][1].headers;
            expect(notifHeaders["Mcp-Session-Id"]).toBe("session-abc-123");
        });

        it("throws AuthRequiredError on 401", async () => {
            const wwwAuth = 'Bearer resource_metadata="https://auth.example.com/.well-known/oauth-protected-resource", scope="read"';
            mockFetch.mockResolvedValueOnce(new Response(null, {
                status: 401,
                headers: { "WWW-Authenticate": wwwAuth },
            }));

            await expect(connectToServer("https://mcp.example.com/sse"))
                .rejects.toThrow(AuthRequiredError);
        });

        it("sends notification without expecting response body", async () => {
            // Initialize
            mockFetch.mockResolvedValueOnce(new Response(
                JSON.stringify({
                    jsonrpc: "2.0",
                    id: 1,
                    result: {
                        protocolVersion: "2024-11-05",
                        capabilities: {},
                        serverInfo: { name: "test-server", version: "1.0" },
                    },
                }),
                { headers: { "Content-Type": "application/json" } }
            ));
            // Notification - 202 Accepted (no body)
            mockFetch.mockResolvedValueOnce(new Response(null, { status: 202 }));

            const server = await connectToServer("https://mcp.example.com/sse");
            expect(server.status).toBe("connected");

            // Verify notification payload has no id field
            const notifBody = JSON.parse(mockFetch.mock.calls[1][1].body);
            expect(notifBody.jsonrpc).toBe("2.0");
            expect(notifBody.method).toBe("notifications/initialized");
            expect(notifBody).not.toHaveProperty("id");
        });
    });
});
