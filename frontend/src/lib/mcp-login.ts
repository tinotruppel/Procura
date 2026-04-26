/**
 * MCP Login — Shared OAuth login logic for MCP servers
 *
 * Used by both McpServerSettings (Settings UI) and MessageList (Chat UI)
 * to trigger the same OAuth popup flow when authentication is required.
 */

import { launchOAuthPopup } from "@/lib/mcp-oauth";
import {
    getMcpServers,
    getMcpProxyConfig,
    updateMcpServer,
    getCloudConfig,
} from "@/lib/storage";
import {
    connectToServer,
    disconnectServer,
    listTools,
} from "@/lib/mcp-client";
import { registerMcpServer, getAuthMetadata } from "@/tools/registry";

/**
 * Perform OAuth login for an MCP server by its ID.
 *
 * 1. Gets OAuth metadata from the runtime registry (cached from last 401)
 * 2. Launches OAuth popup to obtain a session token
 * 3. Reconnects the server with the new token
 * 4. Re-registers the server's tools in the tool registry
 *
 * @param serverId - The MCP server ID to authenticate
 * @returns true if login succeeded, false otherwise
 */
export async function loginMcpServer(serverId: string): Promise<boolean> {
    // Get OAuth metadata from runtime cache (set when tools/call returned 401)
    const authMeta = getAuthMetadata(serverId);
    if (!authMeta?.resourceMetadataUrl) {
        console.error(`[mcp-login] No OAuth metadata for server ${serverId}`);
        return false;
    }

    // Find server URL from storage
    const storedServers = await getMcpServers();
    const stored = storedServers.find((s) => s.id === serverId);
    if (!stored) {
        console.error(`[mcp-login] Server ${serverId} not found in storage`);
        return false;
    }

    console.log(`[mcp-login] Starting login for server ${serverId}`);
    console.log(`[mcp-login] Stored URL: ${stored.url}`);
    console.log(`[mcp-login] Auth metadata:`, authMeta);

    // For cloud-managed servers, derive URL from current Cloud Config base URL.
    // This prevents mismatch when stored URL points to production but OAuth ran locally.
    let effectiveUrl = stored.url;
    const isCloudServer = stored.source === "cloud" || stored.id.startsWith("cloud-");
    if (isCloudServer) {
        const cloudConfig = await getCloudConfig();
        if (cloudConfig.enabled && cloudConfig.baseUrl) {
            const base = cloudConfig.baseUrl.endsWith("/")
                ? cloudConfig.baseUrl.slice(0, -1)
                : cloudConfig.baseUrl;
            // Extract relative endpoint from stored URL (e.g. "/mcp/google-drive")
            try {
                const urlObj = new URL(stored.url);
                effectiveUrl = `${base}${urlObj.pathname}`;
                if (effectiveUrl !== stored.url) {
                    console.log(`[mcp-login] Overriding URL from cloud config: ${effectiveUrl}`);
                }
            } catch {
                // URL parse failed, use stored URL as-is
            }
        }
    }

    try {
        const proxyConfig = await getMcpProxyConfig();
        console.log(`[mcp-login] Proxy config:`, proxyConfig ? { url: proxyConfig.url, hasApiKey: !!proxyConfig.apiKey } : 'none');

        const token = await launchOAuthPopup(
            effectiveUrl,
            authMeta.resourceMetadataUrl,
            authMeta.scope,
            authMeta.useDirectAuthServer,
            proxyConfig?.apiKey
        );

        console.log(`[mcp-login] OAuth popup returned token: ${token ? token.substring(0, 20) + '...' : 'EMPTY'}`);

        // Disconnect old connection if any
        disconnectServer({
            id: stored.id,
            url: effectiveUrl,
            name: stored.name || new URL(effectiveUrl).hostname,
            status: "disconnected",
        });
        console.log(`[mcp-login] Disconnected old connection`);

        // Connect with new token (connectToServer creates a fresh McpServer)
        console.log(`[mcp-login] Reconnecting to ${effectiveUrl} with token...`);
        const connectedServer = await connectToServer(effectiveUrl, token);
        connectedServer.id = stored.id; // Keep original ID
        console.log(`[mcp-login] Connected successfully, server status: ${connectedServer.status}`);

        // List tools
        const tools = await listTools(connectedServer);
        console.log(`[mcp-login] Listed ${tools.length} tools`);

        // Persist updated server state
        await updateMcpServer(connectedServer);

        // Register tools in the global registry
        registerMcpServer(connectedServer, tools);
        console.log(`[mcp-login] Login complete for ${serverId}`);

        // Try the same token on sibling servers that also need auth
        for (const sibling of storedServers) {
            if (sibling.id === serverId) continue;
            const sibAuthMeta = getAuthMetadata(sibling.id);
            if (!sibAuthMeta?.resourceMetadataUrl) continue;

            try {
                // Derive effective URL for siblings too
                let sibUrl = sibling.url;
                if (sibling.source === "cloud" || sibling.id.startsWith("cloud-")) {
                    try {
                        const sibUrlObj = new URL(sibling.url);
                        const cloudConfig = await getCloudConfig();
                        const base = cloudConfig.baseUrl.endsWith("/")
                            ? cloudConfig.baseUrl.slice(0, -1)
                            : cloudConfig.baseUrl;
                        sibUrl = `${base}${sibUrlObj.pathname}`;
                    } catch { /* use original */ }
                }
                console.log(`[mcp-login] Trying token on sibling: ${sibling.id} (${sibUrl})`);
                const sibConnected = await connectToServer(sibUrl, token);
                sibConnected.id = sibling.id;
                const sibTools = await listTools(sibConnected);
                await updateMcpServer(sibConnected);
                registerMcpServer(sibConnected, sibTools);
                console.log(`[mcp-login] Sibling ${sibling.id} authenticated successfully`);
            } catch {
                // Sibling auth failed — different scope, that's fine
                console.log(`[mcp-login] Sibling ${sibling.id} auth skipped (different scope)`);
            }
        }

        return true;
    } catch (error) {
        console.error("[mcp-login] Login failed for server", serverId, error);
        return false;
    }
}
