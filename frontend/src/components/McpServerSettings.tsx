import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Plus,
    Trash2,
    RefreshCw,
    ChevronDown,
    ChevronUp,
    Server,
    AlertCircle,
    CheckCircle,
    Loader2,
    LogIn,
    Cloud
} from "lucide-react";
import { McpServer, McpTool } from "@/lib/mcp-types";
import {
    connectToServer,
    listTools,
    disconnectServer,
    AuthRequiredError,
    generateServerId
} from "@/lib/mcp-client";
import { launchOAuthPopup } from "@/lib/mcp-oauth";
import {
    getMcpServers,
    addMcpServer,
    removeMcpServer,
    getMcpProxyConfig,
    getMcpToolStates,
    setMcpToolEnabled,
    getMcpToolKey,
    updateMcpServer,
} from "@/lib/storage";
import type { StoredMcpServer } from "@/lib/storage";
import {
    registerMcpServer,
    unregisterMcpServer
} from "@/tools/registry";

interface McpServerWithTools {
    server: McpServer;
    tools: McpTool[];
}

interface McpServerSettingsProps {
    refreshKey?: number;
}

export function McpServerSettings({ refreshKey }: McpServerSettingsProps) {
    const [servers, setServers] = useState<McpServerWithTools[]>([]);
    const [newServerUrl, setNewServerUrl] = useState("");
    const [newServerToken, setNewServerToken] = useState("");
    const [isConnecting, setIsConnecting] = useState(false);
    const [isAddingServer, setIsAddingServer] = useState(false);
    const [isAuthenticating, setIsAuthenticating] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());
    const [toolStates, setToolStates] = useState<Record<string, boolean>>({});
    const [savedServerMeta, setSavedServerMeta] = useState<Map<string, StoredMcpServer>>(new Map());

    // Load saved servers on mount and when refreshKey changes
    useEffect(() => {
        loadSavedServers();
    }, [refreshKey]);

    async function loadSavedServers() {
        const savedServers = await getMcpServers();
        const toolStatesMap = await getMcpToolStates();

        // Store server metadata (including source) for cloud badge / delete logic
        const meta = new Map<string, StoredMcpServer>();
        for (const s of savedServers) {
            meta.set(s.id, s);
        }
        setSavedServerMeta(meta);

        // Convert tool states to simple enabled map
        const enabledMap: Record<string, boolean> = {};
        for (const [key, state] of Object.entries(toolStatesMap)) {
            enabledMap[key] = state.enabled;
        }
        setToolStates(enabledMap);

        // Remove servers that are no longer in storage (e.g. cloud servers after disable)
        const savedIds = new Set(savedServers.map((s) => s.id));

        // Unregister removed servers from tool registry, then remove from state
        setServers((prev) => {
            for (const s of prev) {
                if (!savedIds.has(s.server.id)) {
                    unregisterMcpServer(s.server.id);
                }
            }
            return prev.filter((s) => savedIds.has(s.server.id));
        });

        // Reconnect to saved servers
        for (const saved of savedServers) {
            await tryConnectServer({
                id: saved.id,
                url: saved.url,
                name: saved.name,
                description: saved.description,
                authToken: saved.authToken,
                status: "connecting",
            });
        }

        // Cross-pollinate: try tokens from connected servers on auth_required ones
        setServers((current) => {
            const connected = current.filter(s => s.server.status === "connected" && s.server.authToken);
            const authRequired = current.filter(s => s.server.status === "auth_required");

            for (const sibling of authRequired) {
                const donor = connected.find(c => c.server.authToken);
                if (donor?.server.authToken) {
                    const siblingWithToken: McpServer = {
                        ...sibling.server,
                        authToken: donor.server.authToken,
                        status: "connecting",
                        error: undefined,
                    };
                    updateMcpServer(siblingWithToken).then(() => tryConnectServer(siblingWithToken));
                }
            }
            return current;
        });
    }

    async function tryConnectServer(server: McpServer) {
        try {
            const connectedServer = await connectToServer(server.url, server.authToken);
            // Keep original ID
            connectedServer.id = server.id;
            const tools = await listTools(connectedServer);

            setServers((prev) => {
                const existing = prev.find((s) => s.server.id === server.id);
                if (existing) {
                    return prev.map((s) =>
                        s.server.id === server.id ? { server: connectedServer, tools } : s
                    );
                }
                return [...prev, { server: connectedServer, tools }];
            });
            registerMcpServer(connectedServer, tools);
        } catch (e) {
            // Handle auth required
            if (e instanceof AuthRequiredError) {
                const authServer: McpServer = {
                    ...server,
                    status: "auth_required",
                    error: "Authentication required",
                    resourceMetadataUrl: e.resourceMetadataUrl,
                    requiredScope: e.scope,
                    useDirectAuthServer: e.useDirectAuthServer,
                };
                setServers((prev) => {
                    const existing = prev.find((s) => s.server.id === server.id);
                    if (existing) {
                        return prev.map((s) =>
                            s.server.id === server.id ? { server: authServer, tools: [] } : s
                        );
                    }
                    return [...prev, { server: authServer, tools: [] }];
                });
            } else {
                // Regular error
                const errorServer: McpServer = {
                    ...server,
                    status: "error",
                    error: e instanceof Error ? e.message : "Connection failed",
                };
                setServers((prev) => {
                    const existing = prev.find((s) => s.server.id === server.id);
                    if (existing) {
                        return prev.map((s) =>
                            s.server.id === server.id ? { server: errorServer, tools: [] } : s
                        );
                    }
                    return [...prev, { server: errorServer, tools: [] }];
                });
            }
        }
    }

    async function handleAddServer() {
        if (!newServerUrl.trim()) return;

        setIsConnecting(true);
        setError(null);

        try {
            // Validate URL
            new URL(newServerUrl);

            const server: McpServer = {
                id: generateServerId(),
                url: newServerUrl,
                name: new URL(newServerUrl).hostname,
                status: "connecting",
                authToken: newServerToken || undefined,
            };

            // Add to list immediately with connecting status
            setServers((prev) => [...prev, { server, tools: [] }]);
            setNewServerUrl("");
            setNewServerToken("");
            setIsAddingServer(false);

            // Try to connect
            await tryConnectServer(server);

            // Save to storage (tryConnectServer updates the state)
            const current = servers.find((s) => s.server.id === server.id);
            if (current?.server.status === "connected") {
                await addMcpServer(current.server);
            } else {
                // Save even if auth required - user might login later
                await addMcpServer(server);
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : "Connection failed");
        } finally {
            setIsConnecting(false);
        }
    }

    async function handleLogin(serverId: string) {
        const serverWithTools = servers.find((s) => s.server.id === serverId);
        if (!serverWithTools) return;

        const { server } = serverWithTools;
        if (!server.resourceMetadataUrl) {
            setError("No OAuth configuration available");
            return;
        }

        setIsAuthenticating(serverId);

        try {
            const proxyConfig = await getMcpProxyConfig();
            const token = await launchOAuthPopup(
                server.url,
                server.resourceMetadataUrl,
                server.requiredScope,
                server.useDirectAuthServer,
                proxyConfig?.apiKey
            );

            // Update server with token
            const updatedServer: McpServer = {
                ...server,
                authToken: token,
                status: "connecting",
                error: undefined,
            };

            // Update in storage
            await updateMcpServer(updatedServer);

            // Try to connect with token
            await tryConnectServer(updatedServer);

            // Try token on all other auth_required servers (harmless 401 if incompatible)
            const siblings = servers.filter(
                (s) =>
                    s.server.id !== serverId &&
                    s.server.status === "auth_required"
            );
            for (const sibling of siblings) {
                const siblingWithToken: McpServer = {
                    ...sibling.server,
                    authToken: token,
                    status: "connecting",
                    error: undefined,
                };
                await updateMcpServer(siblingWithToken);
                await tryConnectServer(siblingWithToken);
            }
        } catch (e) {
            setServers((prev) =>
                prev.map((s) =>
                    s.server.id === serverId
                        ? {
                            ...s,
                            server: {
                                ...s.server,
                                error: e instanceof Error ? e.message : "Login failed",
                            },
                        }
                        : s
                )
            );
        } finally {
            setIsAuthenticating(null);
        }
    }

    async function handleRemoveServer(serverId: string) {
        // Disconnect and remove
        const serverWithTools = servers.find((s) => s.server.id === serverId);
        if (serverWithTools) {
            disconnectServer(serverWithTools.server);
        }

        unregisterMcpServer(serverId);
        await removeMcpServer(serverId);

        setServers((prev) => prev.filter((s) => s.server.id !== serverId));
    }

    async function handleReconnect(serverId: string) {
        const serverWithTools = servers.find((s) => s.server.id === serverId);
        if (!serverWithTools) return;

        // Update status to connecting
        setServers((prev) =>
            prev.map((s) =>
                s.server.id === serverId
                    ? { ...s, server: { ...s.server, status: "connecting" as const, error: undefined } }
                    : s
            )
        );

        await tryConnectServer(serverWithTools.server);
    }

    function toggleExpanded(serverId: string) {
        setExpandedServers((prev) => {
            const newSet = new Set(prev);
            if (newSet.has(serverId)) {
                newSet.delete(serverId);
            } else {
                newSet.add(serverId);
            }
            return newSet;
        });
    }

    async function handleToggleTool(serverId: string, toolName: string) {
        const key = getMcpToolKey(serverId, toolName);
        const currentEnabled = toolStates[key] ?? true;
        const newEnabled = !currentEnabled;

        await setMcpToolEnabled(serverId, toolName, newEnabled);
        setToolStates((prev) => ({ ...prev, [key]: newEnabled }));
    }

    function isToolEnabled(serverId: string, toolName: string): boolean {
        const key = getMcpToolKey(serverId, toolName);
        return toolStates[key] ?? true;
    }

    function getStatusIcon(status: McpServer["status"]) {
        switch (status) {
            case "connected":
                return <CheckCircle className="h-4 w-4 text-green-500" />;
            case "connecting":
                return <Loader2 className="h-4 w-4 text-yellow-500 animate-spin" />;
            case "auth_required":
                return <LogIn className="h-4 w-4 text-orange-500" />;
            case "error":
                return <AlertCircle className="h-4 w-4 text-red-500" />;
            default:
                return <Server className="h-4 w-4 text-muted-foreground" />;
        }
    }

    return (
        <Card>
            <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-base">MCP Server</CardTitle>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                            setIsAddingServer(true);
                            setNewServerUrl("");
                            setNewServerToken("");
                            setError(null);
                        }}
                    >
                        <Plus className="h-4 w-4 mr-1" />
                        Add
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Add new server form (collapsible) */}
                {isAddingServer && (
                    <div className="border rounded-md p-3 bg-muted/30 space-y-3">
                        <Input
                            type="url"
                            placeholder="https://remote.mcpservers.org/fetch/mcp"
                            value={newServerUrl}
                            onChange={(e) => setNewServerUrl(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleAddServer()}
                            className="text-sm"
                        />
                        <Input
                            type="password"
                            placeholder="Bearer Token (optional)"
                            value={newServerToken}
                            onChange={(e) => setNewServerToken(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleAddServer()}
                            className="h-8 text-xs"
                        />
                        <div className="flex gap-2 justify-end">
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                    setIsAddingServer(false);
                                    setNewServerUrl("");
                                    setNewServerToken("");
                                    setError(null);
                                }}
                            >
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                onClick={handleAddServer}
                                disabled={isConnecting || !newServerUrl.trim()}
                            >
                                {isConnecting ? (
                                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                                ) : (
                                    <Plus className="h-4 w-4 mr-1" />
                                )}
                                Add
                            </Button>
                        </div>
                    </div>
                )}

                {error && (
                    <div className="text-sm text-red-500 flex items-center gap-2">
                        <AlertCircle className="h-4 w-4" />
                        {error}
                    </div>
                )}

                {/* Server list */}
                {servers.length === 0 && !isAddingServer ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                        No MCP servers connected
                    </p>
                ) : (
                    <div className="space-y-2">
                        {servers.map(({ server, tools }) => (
                            <div
                                key={server.id}
                                className="rounded-lg border bg-background overflow-hidden"
                            >
                                {/* Server header */}
                                <div className="flex items-center gap-2 p-3">
                                    {getStatusIcon(server.status)}
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium text-sm truncate">
                                            {server.name}
                                        </div>
                                        <div className="text-xs text-muted-foreground truncate">
                                            {server.url}
                                        </div>
                                        {server.error && (
                                            <div className="text-xs text-red-500 truncate">
                                                {server.error}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1">
                                        {/* Login button for auth_required */}
                                        {server.status === "auth_required" && server.resourceMetadataUrl && (
                                            <Button
                                                variant="default"
                                                size="sm"
                                                className="h-8"
                                                onClick={() => handleLogin(server.id)}
                                                disabled={isAuthenticating === server.id}
                                            >
                                                {isAuthenticating === server.id ? (
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                ) : (
                                                    <>
                                                        <LogIn className="h-4 w-4 mr-1" />
                                                        Login
                                                    </>
                                                )}
                                            </Button>
                                        )}
                                        {server.status === "error" && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8"
                                                onClick={() => handleReconnect(server.id)}
                                            >
                                                <RefreshCw className="h-4 w-4" />
                                            </Button>
                                        )}
                                        {tools.length > 0 && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8"
                                                onClick={() => toggleExpanded(server.id)}
                                            >
                                                {expandedServers.has(server.id) ? (
                                                    <ChevronUp className="h-4 w-4" />
                                                ) : (
                                                    <ChevronDown className="h-4 w-4" />
                                                )}
                                            </Button>
                                        )}
                                        {savedServerMeta.get(server.id)?.source === "cloud" ? (
                                            <span title="Cloud-managed server" className="p-2">
                                                <Cloud className="h-3.5 w-3.5 text-blue-500" />
                                            </span>
                                        ) : (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 text-red-500 hover:text-red-600"
                                                onClick={() => handleRemoveServer(server.id)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        )}
                                    </div>
                                </div>

                                {/* Tools list (expanded) */}
                                {expandedServers.has(server.id) && tools.length > 0 && (
                                    <div className="border-t p-3 space-y-2 bg-muted/30">
                                        <div className="text-xs font-medium text-muted-foreground">
                                            {tools.length} Tool{tools.length !== 1 ? "s" : ""}
                                        </div>
                                        {tools.map((tool) => (
                                            <div
                                                key={tool.name}
                                                className="flex items-center justify-between py-1"
                                            >
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-sm font-medium truncate">
                                                        {tool.title || tool.name}
                                                    </div>
                                                    {tool.description && (
                                                        <div className="text-xs text-muted-foreground truncate">
                                                            {tool.description}
                                                        </div>
                                                    )}
                                                </div>
                                                <button
                                                    onClick={() => handleToggleTool(server.id, tool.name)}
                                                    className={`relative w-9 h-5 rounded-full transition-colors ${isToolEnabled(server.id, tool.name)
                                                        ? "bg-primary"
                                                        : "bg-muted"
                                                        }`}
                                                >
                                                    <span
                                                        className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${isToolEnabled(server.id, tool.name)
                                                            ? "translate-x-4"
                                                            : "translate-x-0"
                                                            }`}
                                                    />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                <p className="text-xs text-muted-foreground">
                    MCP servers provide additional tools.{" "}
                    <a
                        href="https://modelcontextprotocol.io"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                    >
                        Learn more
                    </a>
                </p>
            </CardContent>
        </Card>
    );
}

