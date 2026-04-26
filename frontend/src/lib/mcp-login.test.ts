/**
 * Tests for MCP Login — OAuth login flow for MCP servers
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all dependencies before importing
vi.mock("@/lib/mcp-oauth", () => ({
    launchOAuthPopup: vi.fn().mockResolvedValue("mock-oauth-token"),
}));

vi.mock("@/lib/storage", () => ({
    getMcpServers: vi.fn().mockResolvedValue([
        { id: "server-1", url: "https://api.example.com/mcp/gmail", name: "Gmail", source: "cloud" },
        { id: "cloud-drive", url: "https://api.example.com/mcp/drive", name: "Drive", source: "cloud" },
    ]),
    getMcpProxyConfig: vi.fn().mockResolvedValue({ url: "https://proxy.example.com", apiKey: "proxy-key" }),
    updateMcpServer: vi.fn().mockResolvedValue(undefined),
    getCloudConfig: vi.fn().mockResolvedValue({ enabled: true, baseUrl: "https://api.example.com" }),
}));

vi.mock("@/lib/mcp-client", () => ({
    connectToServer: vi.fn().mockResolvedValue({
        id: "temp-id",
        url: "https://api.example.com/mcp/gmail",
        name: "Gmail",
        status: "connected",
    }),
    disconnectServer: vi.fn(),
    listTools: vi.fn().mockResolvedValue([
        { name: "search_emails", description: "Search emails", inputSchema: { type: "object" } },
    ]),
}));

vi.mock("@/tools/registry", () => ({
    registerMcpServer: vi.fn(),
    getAuthMetadata: vi.fn().mockImplementation((id: string) => {
        if (id === "server-1") {
            return {
                resourceMetadataUrl: "https://api.example.com/mcp/gmail/.well-known/oauth-protected-resource",
                scope: "google",
                useDirectAuthServer: false,
            };
        }
        if (id === "cloud-drive") {
            return {
                resourceMetadataUrl: "https://api.example.com/mcp/drive/.well-known/oauth-protected-resource",
                scope: "google",
                useDirectAuthServer: false,
            };
        }
        return undefined;
    }),
}));

import { loginMcpServer } from "./mcp-login";
import { launchOAuthPopup } from "./mcp-oauth";
import { connectToServer, disconnectServer, listTools } from "./mcp-client";
import { registerMcpServer, getAuthMetadata } from "../tools/registry";
import { updateMcpServer } from "./storage";

describe("loginMcpServer", () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Re-apply default mock implementations
        vi.mocked(launchOAuthPopup).mockResolvedValue("mock-oauth-token");
        vi.mocked(connectToServer).mockResolvedValue({
            id: "temp-id",
            url: "https://api.example.com/mcp/gmail",
            name: "Gmail",
            status: "connected",
        });
        vi.mocked(listTools).mockResolvedValue([
            { name: "search_emails", description: "Search emails", inputSchema: { type: "object" } },
        ]);
        vi.mocked(getAuthMetadata).mockImplementation((id: string) => {
            if (id === "server-1") {
                return {
                    resourceMetadataUrl: "https://api.example.com/mcp/gmail/.well-known/oauth-protected-resource",
                    scope: "google",
                    useDirectAuthServer: false,
                };
            }
            if (id === "cloud-drive") {
                return {
                    resourceMetadataUrl: "https://api.example.com/mcp/drive/.well-known/oauth-protected-resource",
                    scope: "google",
                    useDirectAuthServer: false,
                };
            }
            return undefined;
        });
    });

    it("should return false when no auth metadata exists", async () => {
        vi.mocked(getAuthMetadata).mockReturnValue(undefined);
        const result = await loginMcpServer("unknown-server");
        expect(result).toBe(false);
    });

    it("should return false when server is not found in storage", async () => {
        const result = await loginMcpServer("nonexistent-server");
        expect(result).toBe(false);
    });

    it("should complete successful login flow", async () => {
        const result = await loginMcpServer("server-1");

        expect(result).toBe(true);
        expect(launchOAuthPopup).toHaveBeenCalledWith(
            expect.stringContaining("api.example.com"),
            expect.stringContaining("oauth-protected-resource"),
            "google",
            false,
            "proxy-key",
        );
        expect(disconnectServer).toHaveBeenCalled();
        expect(connectToServer).toHaveBeenCalledWith(
            expect.stringContaining("api.example.com/mcp/gmail"),
            "mock-oauth-token",
        );
        expect(listTools).toHaveBeenCalled();
        expect(updateMcpServer).toHaveBeenCalled();
        expect(registerMcpServer).toHaveBeenCalled();
    });

    it("should try token on sibling servers", async () => {
        await loginMcpServer("server-1");

        // Should also attempt to connect cloud-drive sibling
        expect(connectToServer).toHaveBeenCalledTimes(2); // primary + sibling
    });

    it("should return false when OAuth popup fails", async () => {
        vi.mocked(launchOAuthPopup).mockRejectedValue(new Error("OAuth cancelled"));
        const result = await loginMcpServer("server-1");
        expect(result).toBe(false);
    });

    it("should return false when connection fails", async () => {
        vi.mocked(connectToServer).mockRejectedValue(new Error("Connection failed"));
        const result = await loginMcpServer("server-1");
        expect(result).toBe(false);
    });

    it("should handle sibling auth failure gracefully", async () => {
        let callCount = 0;
        vi.mocked(connectToServer).mockImplementation(async () => {
            callCount++;
            if (callCount > 1) throw new Error("Sibling auth failed");
            return {
                id: "temp-id",
                url: "https://api.example.com/mcp/gmail",
                name: "Gmail",
                status: "connected",
            };
        });

        const result = await loginMcpServer("server-1");
        expect(result).toBe(true); // Primary should still succeed
    });

    it("should override URL from cloud config for cloud servers", async () => {
        await loginMcpServer("server-1");

        // The connectToServer should be called with the effective URL
        expect(connectToServer).toHaveBeenCalledWith(
            "https://api.example.com/mcp/gmail",
            "mock-oauth-token",
        );
    });
});
