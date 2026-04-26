/**
 * Tests for registry.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock storage
vi.mock("@/lib/storage", () => ({
    getToolConfigs: vi.fn(() => Promise.resolve({})),
    isMcpToolEnabled: vi.fn(() => Promise.resolve(true)),
}));

// Mock mcp-client
vi.mock("@/lib/mcp-client", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/mcp-client")>();
    return {
        callTool: vi.fn(),
        mcpToolToFunctionDeclaration: vi.fn((tool, id) => ({
            name: `mcp__${id.replace(/-/g, "_")}__${tool.name}`,
            description: tool.description,
        })),
        parseMcpToolName: vi.fn((name: string) => {
            if (!name.startsWith("mcp__")) return null;
            const rest = name.slice(5);
            const idx = rest.indexOf("__");
            if (idx <= 0) return null;
            return { serverId: rest.slice(0, idx), toolName: rest.slice(idx + 2) };
        }),
        AuthRequiredError: actual.AuthRequiredError,
    };
});

import {
    registerMcpServer,
    unregisterMcpServer,
    getConnectedMcpServers,
    getToolsWithConfig,
    getEnabledToolDeclarations,
    executeTool,
    getAuthMetadata,
} from "./registry";
import { getToolConfigs, isMcpToolEnabled } from "@/lib/storage";
import { callTool, AuthRequiredError } from "@/lib/mcp-client";

describe("registry", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Clear connected servers
        for (const s of getConnectedMcpServers()) {
            unregisterMcpServer(s.server.id);
        }
    });

    describe("MCP Server Management", () => {
        it("should register an MCP server", () => {
            const server = { id: "server-123", name: "Test Server", url: "http://test" };
            const tools = [{ name: "tool1", description: "Test tool", inputSchema: {} }];

            registerMcpServer(server as any, tools);

            const connected = getConnectedMcpServers();
            expect(connected).toHaveLength(1);
            expect(connected[0].server.id).toBe("server-123");
            expect(connected[0].tools).toHaveLength(1);
        });

        it("should replace existing server on re-register", () => {
            const server = { id: "server-123", name: "Test Server", url: "http://test" };
            registerMcpServer(server as any, [{ name: "tool1" }] as any);
            registerMcpServer(server as any, [{ name: "tool2" }, { name: "tool3" }] as any);

            const connected = getConnectedMcpServers();
            expect(connected).toHaveLength(1);
            expect(connected[0].tools).toHaveLength(2);
        });

        it("should unregister an MCP server", () => {
            const server = { id: "server-456", name: "Test", url: "http://test" };
            registerMcpServer(server as any, []);

            expect(getConnectedMcpServers()).toHaveLength(1);

            unregisterMcpServer("server-456");

            expect(getConnectedMcpServers()).toHaveLength(0);
        });
    });

    describe("getToolsWithConfig", () => {
        it("should return all tools with default config", async () => {
            (getToolConfigs as ReturnType<typeof vi.fn>).mockResolvedValue({});

            const result = await getToolsWithConfig();

            expect(result.length).toBeGreaterThan(0);
            expect(result[0]).toHaveProperty("tool");
            expect(result[0]).toHaveProperty("config");
        });

        it("should merge user config with defaults", async () => {
            (getToolConfigs as ReturnType<typeof vi.fn>).mockResolvedValue({
                calculator: { enabled: false, settings: { customSetting: "value" } },
            });

            const result = await getToolsWithConfig();
            const calculator = result.find(r => r.tool.name === "calculator");

            expect(calculator?.config.enabled).toBe(false);
            expect(calculator?.config.settings.customSetting).toBe("value");
        });

        it("should not have any Select options with empty string values", async () => {
            // This test prevents the Radix UI Select crash when value is empty string
            (getToolConfigs as ReturnType<typeof vi.fn>).mockResolvedValue({});

            const result = await getToolsWithConfig();

            // Flatten all select options from all tools
            const allSelectOptions = result
                .flatMap(({ tool }) => tool.settingsFields ?? [])
                .filter(field => field.type === "select" && field.options)
                .flatMap(field => field.options ?? []);

            // Verify none have empty string values
            for (const option of allSelectOptions) {
                expect(option.value).not.toBe("");
                expect(option.value.length).toBeGreaterThan(0);
            }
        });
    });

    describe("getEnabledToolDeclarations", () => {
        it("should return enabled local tool declarations", async () => {
            (getToolConfigs as ReturnType<typeof vi.fn>).mockResolvedValue({});

            const declarations = await getEnabledToolDeclarations();

            expect(declarations.length).toBeGreaterThan(0);
        });

        it("should exclude disabled tools", async () => {
            (getToolConfigs as ReturnType<typeof vi.fn>).mockResolvedValue({
                calculator: { enabled: false, settings: {} },
            });

            const declarations = await getEnabledToolDeclarations();
            const hasCalculator = declarations.some((d: any) => d.name === "calculator");

            expect(hasCalculator).toBe(false);
        });

        it("should include enabled MCP tools", async () => {
            const server = { id: "mcpserver-1234", name: "MCP", url: "http://mcp" };
            registerMcpServer(server as any, [{ name: "mcp_tool", description: "MCP Test" }] as any);

            (getToolConfigs as ReturnType<typeof vi.fn>).mockResolvedValue({});
            (isMcpToolEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(true);

            const declarations = await getEnabledToolDeclarations();
            const hasMcpTool = declarations.some((d: any) => d.name?.includes("mcp__"));

            expect(hasMcpTool).toBe(true);
        });
    });

    describe("executeTool", () => {
        it("should execute local tool", async () => {
            (getToolConfigs as ReturnType<typeof vi.fn>).mockResolvedValue({});

            const result = await executeTool("calculator", { expression: "2+2" });

            expect(result.success).toBe(true);
        });

        it("should return error for unknown tool", async () => {
            const result = await executeTool("nonexistent_tool", {});

            expect(result.success).toBe(false);
            expect(result.error).toContain("not found");
        });

        it("should return error for disabled tool", async () => {
            (getToolConfigs as ReturnType<typeof vi.fn>).mockResolvedValue({
                calculator: { enabled: false, settings: {} },
            });

            const result = await executeTool("calculator", { expression: "1+1" });

            expect(result.success).toBe(false);
            expect(result.error).toContain("deaktiviert");
        });

        it("should execute MCP tool", async () => {
            const server = { id: "mcptest-abcd", name: "MCP", url: "http://mcp" };
            registerMcpServer(server as any, [{ name: "remote" }] as any);

            (isMcpToolEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(true);
            (callTool as ReturnType<typeof vi.fn>).mockResolvedValue({
                isError: false,
                content: [{ type: "text", text: "MCP result" }],
            });

            const result = await executeTool("mcp__mcptest_abcd__remote", {});

            expect(result.success).toBe(true);
            expect(result.data).toBe("MCP result");
        });

        it("should handle MCP tool error", async () => {
            const server = { id: "mcperror-xyz", name: "MCP", url: "http://mcp" };
            registerMcpServer(server as any, [{ name: "failing" }] as any);

            (isMcpToolEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(true);
            (callTool as ReturnType<typeof vi.fn>).mockResolvedValue({
                isError: true,
                content: [{ type: "text", text: "Tool failed" }],
            });

            const result = await executeTool("mcp__mcperror_xyz__failing", {});

            expect(result.success).toBe(false);
            expect(result.error).toBe("Tool failed");
        });

        it("should handle disconnected MCP server", async () => {
            const result = await executeTool("mcp__unknown__tool", {});

            expect(result.success).toBe(false);
            expect(result.error).toContain("not connected");
        });

        it("should return error for disabled MCP tool", async () => {
            const server = { id: "mcpdisabled-abc", name: "MCP", url: "http://mcp" };
            registerMcpServer(server as any, [{ name: "disabled_tool" }] as any);

            (isMcpToolEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(false);

            const result = await executeTool("mcp__mcpdisabled_abc__disabled_tool", {});

            expect(result.success).toBe(false);
            expect(result.error).toContain("deaktiviert");
        });

        it("should handle MCP tool execution exception", async () => {
            const server = { id: "mcpexception-123", name: "MCP", url: "http://mcp" };
            registerMcpServer(server as any, [{ name: "throwing" }] as any);

            (isMcpToolEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(true);
            (callTool as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Connection failed"));

            const result = await executeTool("mcp__mcpexception_123__throwing", {});

            expect(result.success).toBe(false);
            expect(result.error).toBe("Connection failed");
        });

        it("should handle MCP tool with empty error content", async () => {
            const server = { id: "mcpempty-xyz", name: "MCP", url: "http://mcp" };
            registerMcpServer(server as any, [{ name: "empty_error" }] as any);

            (isMcpToolEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(true);
            (callTool as ReturnType<typeof vi.fn>).mockResolvedValue({
                isError: true,
                content: [], // Empty content
            });

            const result = await executeTool("mcp__mcpempty_xyz__empty_error", {});

            expect(result.success).toBe(false);
            expect(result.error).toBe("MCP tool error");
        });

        it("should handle MCP tool with non-text content", async () => {
            const server = { id: "mcpnontext-abc", name: "MCP", url: "http://mcp" };
            registerMcpServer(server as any, [{ name: "binary_tool" }] as any);

            (isMcpToolEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(true);
            (callTool as ReturnType<typeof vi.fn>).mockResolvedValue({
                isError: false,
                content: [{ type: "blob", data: "binary" }], // Non-text content
            });

            const result = await executeTool("mcp__mcpnontext_abc__binary_tool", {});

            expect(result.success).toBe(true);
            // When no text content, returns the original content array
            expect(result.data).toEqual([{ type: "blob", data: "binary" }]);
        });

        it("should return authRequired when AuthRequiredError is thrown", async () => {
            const server = { id: "mcpauth-001", name: "Google Docs", url: "http://mcp" };
            registerMcpServer(server as any, [{ name: "list_documents" }] as any);

            (isMcpToolEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(true);

            const authError = new AuthRequiredError("Authentication required");
            authError.resourceMetadataUrl = "http://mcp/.well-known/oauth-protected-resource";
            authError.scope = "docs.read";
            (callTool as ReturnType<typeof vi.fn>).mockRejectedValue(authError);

            const result = await executeTool("mcp__mcpauth_001__list_documents", {});

            expect(result.success).toBe(false);
            expect(result.authRequired).toBe(true);
            expect(result.serverId).toBe("mcpauth-001");
            expect(result.error).toContain("Authentication required");
        });

        it("should cache auth metadata when AuthRequiredError is thrown", async () => {
            const server = { id: "mcpauth-002", name: "Gmail", url: "http://mcp" };
            registerMcpServer(server as any, [{ name: "send_email" }] as any);

            (isMcpToolEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(true);

            const authError = new AuthRequiredError("Auth needed");
            authError.resourceMetadataUrl = "http://mcp/.well-known/oauth-protected-resource";
            authError.scope = "gmail.send";
            authError.useDirectAuthServer = true;
            (callTool as ReturnType<typeof vi.fn>).mockRejectedValue(authError);

            await executeTool("mcp__mcpauth_002__send_email", {});

            const meta = getAuthMetadata("mcpauth-002");
            expect(meta).toBeDefined();
            expect(meta?.resourceMetadataUrl).toBe("http://mcp/.well-known/oauth-protected-resource");
            expect(meta?.scope).toBe("gmail.send");
            expect(meta?.useDirectAuthServer).toBe(true);
        });
    });
});
