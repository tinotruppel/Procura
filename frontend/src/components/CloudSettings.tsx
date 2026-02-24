/**
 * Cloud Settings Component
 *
 * Unified configuration for the Procura backend:
 * - Base URL + API Key → derives sync, MCP proxy, MCP directory URLs
 * - On enable: activates sync, MCP proxy, discovers MCP servers
 * - On disable: cleans up all cloud-managed resources
 * - Health checks: probes sync, proxy, and directory on load
 */

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Cloud,
    CloudOff,
    RefreshCw,
    AlertCircle,
    AlertTriangle,
    Loader2,
    CheckCircle,
    XCircle,
} from "lucide-react";
import {
    getCloudConfig,
    setCloudConfig,
    getCloudSyncUrl,
    getCloudProxyUrl,
    getCloudDirectoryUrl,
    setMcpProxyConfig,
    getMcpServers,
    setMcpServers,
} from "@/lib/storage";
import type { CloudConfig, StoredMcpServer } from "@/lib/storage";
import {
    setupNewSync,
    disableSync,
    performSync,
} from "@/lib/sync-service";
import { isVaultUnlocked, restoreVaultFromSession } from "@/lib/vault";

// =============================================================================
// Types
// =============================================================================

interface McpDirectoryEntry {
    name: string;
    title: string;
    endpoint: string;
    description: string;
}

interface CloudSettingsProps {
    onSyncComplete?: () => void;
    onMcpServersChanged?: () => void;
}

interface ServiceHealth {
    sync: boolean | null;   // null = not checked yet
    proxy: boolean | null;
    directory: boolean | null;
}

// =============================================================================
// Helpers
// =============================================================================

async function fetchMcpDirectory(
    baseUrl: string,
    apiKey: string,
): Promise<McpDirectoryEntry[]> {
    const url = getCloudDirectoryUrl(baseUrl);
    const res = await fetch(url, {
        headers: { "X-API-Key": apiKey },
    });
    if (!res.ok) {
        throw new Error(`Directory fetch failed: ${res.status}`);
    }
    const data = (await res.json()) as { servers: McpDirectoryEntry[] };
    return data.servers;
}

function cloudServerIdFromName(name: string): string {
    return `cloud-${name}`;
}

async function addCloudServers(
    baseUrl: string,
    apiKey: string,
    entries: McpDirectoryEntry[],
): Promise<void> {
    const existing = await getMcpServers();
    // Remove old cloud servers
    const manual = existing.filter((s) => s.source !== "cloud");

    const cleanBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    const cloudServers: StoredMcpServer[] = entries.map((entry) => ({
        id: cloudServerIdFromName(entry.name),
        url: `${cleanBase}${entry.endpoint}`,
        name: entry.name,
        description: entry.description,
        authToken: apiKey,
        source: "cloud" as const,
    }));

    await setMcpServers([...manual, ...cloudServers]);
}

async function removeCloudServers(): Promise<void> {
    const existing = await getMcpServers();
    const manual = existing.filter((s) => s.source !== "cloud");
    await setMcpServers(manual);
}

/** Fetch the /health endpoint, return the list of available services */
async function fetchHealth(
    baseUrl: string,
    apiKey: string,
): Promise<{ status: string; services: string[] }> {
    const cleanBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    const res = await fetch(`${cleanBase}/health`, {
        headers: { "X-API-Key": apiKey },
        signal: AbortSignal.timeout(5000),
    });
    return (await res.json()) as { status: string; services: string[] };
}

// =============================================================================
// Component
// =============================================================================

export function CloudSettings({ onSyncComplete, onMcpServersChanged }: CloudSettingsProps) {
    const [config, setConfig] = useState<CloudConfig>({
        enabled: false,
        baseUrl: import.meta.env.VITE_API_BASE_URL || "",
        apiKey: "",
    });
    const [baseUrlInput, setBaseUrlInput] = useState(config.baseUrl);
    const [apiKeyInput, setApiKeyInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [cloudServerCount, setCloudServerCount] = useState(0);

    const [configExpanded, setConfigExpanded] = useState(false);
    const [health, setHealth] = useState<ServiceHealth>({
        sync: null,
        proxy: null,
        directory: null,
    });

    // Load settings on mount
    useEffect(() => {
        loadSettings();
    }, []);

    async function loadSettings() {
        try {
            await restoreVaultFromSession();
            const cloud = await getCloudConfig();
            setConfig(cloud);
            setBaseUrlInput(cloud.baseUrl);
            setApiKeyInput(cloud.apiKey);

            if (cloud.enabled) {
                setConfigExpanded(true);
                // Count cloud servers
                const servers = await getMcpServers();
                setCloudServerCount(
                    servers.filter((s) => s.source === "cloud").length,
                );

                // Health checks (run in parallel, don't block UI)
                if (cloud.apiKey) {
                    runHealthChecks(cloud.baseUrl, cloud.apiKey);
                }
            }
        } catch (e) {
            console.error("[CloudSettings] Failed to load:", e);
        }
    }

    async function runHealthChecks(baseUrl: string, apiKey: string) {
        try {
            const data = await fetchHealth(baseUrl, apiKey);
            const services = data.services ?? [];
            setHealth({
                sync: services.includes("sync"),
                proxy: services.includes("mcp-proxy"),
                directory: services.includes("mcp-directory"),
            });
        } catch {
            setHealth({ sync: false, proxy: false, directory: false });
        }
    }

    async function handleTestConnection() {
        if (!baseUrlInput.trim() || !apiKeyInput.trim()) {
            setError("Base URL and API Key are required");
            return;
        }

        setLoading(true);
        setError(null);

        try {
            // 1. Run health check
            const data = await fetchHealth(baseUrlInput.trim(), apiKeyInput.trim());
            const services = data.services ?? [];
            const healthResult: ServiceHealth = {
                sync: services.includes("sync"),
                proxy: services.includes("mcp-proxy"),
                directory: services.includes("mcp-directory"),
            };
            setHealth(healthResult);

            // Check if all services are healthy
            if (!healthResult.sync || !healthResult.proxy || !healthResult.directory) {
                setError("Some services are not available");
                return;
            }

            // 2. All healthy — enable cloud
            const baseUrl = baseUrlInput.trim();
            const apiKey = apiKeyInput.trim();

            const newConfig: CloudConfig = {
                enabled: true,
                baseUrl,
                apiKey,
            };
            await setCloudConfig(newConfig);
            setConfig(newConfig);

            // Enable sync
            await setupNewSync(getCloudSyncUrl(baseUrl), apiKey);

            // Enable MCP proxy
            await setMcpProxyConfig({
                enabled: true,
                url: getCloudProxyUrl(baseUrl),
                apiKey,
            });

            // Fetch and register MCP directory servers
            try {
                const entries = await fetchMcpDirectory(baseUrl, apiKey);
                await addCloudServers(baseUrl, apiKey, entries);
                setCloudServerCount(entries.length);
                onMcpServersChanged?.();
            } catch (dirErr) {
                console.warn(
                    "[CloudSettings] Directory fetch failed, continuing without:",
                    dirErr,
                );
            }


            await loadSettings();
        } catch (e) {
            setHealth({ sync: false, proxy: false, directory: false });
            setError(
                e instanceof Error ? e.message : "Connection test failed",
            );
        } finally {
            setLoading(false);
        }
    }

    async function handleDisable() {
        setLoading(true);
        try {
            // 1. Disable sync
            await disableSync();

            // 2. Disable MCP proxy
            await setMcpProxyConfig({
                enabled: false,
                url: "",
                apiKey: "",
            });

            // 3. Remove cloud MCP servers
            await removeCloudServers();
            onMcpServersChanged?.();

            // 4. Save disabled config (keep API key for easy re-enable)
            await setCloudConfig({
                enabled: false,
                baseUrl: config.baseUrl,
                apiKey: config.apiKey,
            });

            setConfig({
                enabled: false,
                baseUrl: config.baseUrl,
                apiKey: config.apiKey,
            });
            setCloudServerCount(0);
            setHealth({ sync: null, proxy: null, directory: null });
        } finally {
            setLoading(false);
        }
    }

    async function handleSync() {
        setSyncing(true);
        try {
            const result = await performSync();
            if (result.success) {
                if (result.pulled > 0 && onSyncComplete) {
                    onSyncComplete();
                }
            }
        } catch {
            // Sync error — silently handled
        } finally {
            setSyncing(false);
        }
    }

    // Note: initError is logged but we still render the UI so users can configure Cloud

    // =========================================================================
    // Status icon helper
    // =========================================================================
    function StatusIcon({ ok }: { ok: boolean | null }) {
        if (ok === null) {
            return <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />;
        }
        if (ok) {
            return <CheckCircle className="h-3 w-3 text-green-500" />;
        }
        return <XCircle className="h-3 w-3 text-red-500" />;
    }

    // =========================================================================
    // Toggle state: ON when enabled or when user expanded config to set up
    // =========================================================================
    const toggleOn = config.enabled || configExpanded;

    function handleToggle() {
        if (config.enabled) {
            // Disable cloud and collapse config
            setConfigExpanded(false);
            handleDisable();
        } else if (configExpanded) {
            // Collapse config without action
            setConfigExpanded(false);
            setError(null);
            setHealth({ sync: null, proxy: null, directory: null });
        } else {
            // Expand config for setup
            setConfigExpanded(true);
        }
    }

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                    {config.enabled ? (
                        <Cloud className="h-4 w-4 text-green-500" />
                    ) : (
                        <CloudOff className="h-4 w-4 text-muted-foreground" />
                    )}
                    <div className="flex-1">
                        <div>Procura Cloud</div>
                        {!toggleOn && (
                            <p className="text-xs font-normal text-muted-foreground">
                                Sync, MCP proxy, and auto-discovered servers
                            </p>
                        )}
                    </div>
                    <button
                        onClick={handleToggle}
                        disabled={loading}
                        className={`relative w-11 h-6 rounded-full transition-colors ${toggleOn ? "bg-primary" : "bg-muted"
                            } ${loading ? "cursor-not-allowed opacity-50" : ""}`}
                    >
                        <span
                            className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${toggleOn ? "translate-x-5" : "translate-x-0"
                                }`}
                        />
                    </button>
                </CardTitle>
            </CardHeader>

            {/* Only show content when toggle is on */}
            {toggleOn && (
                <CardContent className="space-y-3">
                    {/* Vault lock warning */}
                    {config.enabled && !isVaultUnlocked() && (
                        <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="h-3 w-3 mt-0.5" />
                            <div>
                                <p className="font-medium">Vault locked</p>
                                <p>
                                    Enter your security key to sync and decrypt
                                    secrets.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Config inputs */}
                    {configExpanded && (
                        <>
                            <div className="space-y-1">
                                <label className="text-xs font-medium">Base URL</label>
                                <Input
                                    type="url"
                                    placeholder="https://api.your-server.com"
                                    value={baseUrlInput}
                                    onChange={(e) => setBaseUrlInput(e.target.value)}
                                    className="h-8 text-xs"
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="text-xs font-medium">API Key</label>
                                <Input
                                    type="password"
                                    placeholder="Enter API key..."
                                    value={apiKeyInput}
                                    onChange={(e) => setApiKeyInput(e.target.value)}
                                    className="h-8 text-xs font-mono"
                                />
                            </div>

                            {/* Apply button + inline status */}
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleTestConnection}
                                    disabled={loading || !baseUrlInput.trim() || !apiKeyInput.trim()}
                                >
                                    {loading ? (
                                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                    ) : (
                                        <CheckCircle className="h-4 w-4 mr-2" />
                                    )}
                                    Apply
                                </Button>

                                {/* Inline status icons */}
                                {(health.sync !== null || health.proxy !== null || health.directory !== null) && (
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <span className="flex items-center gap-1" title="MCP Proxy">
                                            <StatusIcon ok={health.proxy} />
                                            <span>Proxy</span>
                                        </span>
                                        <span className="flex items-center gap-1" title="MCP Directory">
                                            <StatusIcon ok={health.directory} />
                                            <span>{cloudServerCount > 0 ? `${cloudServerCount} MCPs` : "Dir"}</span>
                                        </span>
                                        <span className="flex items-center gap-1" title="Sync">
                                            <StatusIcon ok={health.sync} />
                                            <span>Sync</span>
                                        </span>
                                        {config.enabled && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-5 w-5 ml-1"
                                                onClick={handleSync}
                                                disabled={syncing || !isVaultUnlocked()}
                                                title="Sync Now"
                                            >
                                                {syncing ? (
                                                    <Loader2 className="h-3 w-3 animate-spin" />
                                                ) : (
                                                    <RefreshCw className="h-3 w-3" />
                                                )}
                                            </Button>
                                        )}
                                    </div>
                                )}
                            </div>
                        </>
                    )}

                    {/* Error display */}
                    {error && (
                        <div className="flex items-center gap-2 text-xs text-destructive">
                            <AlertCircle className="h-3 w-3" />
                            {error}
                        </div>
                    )}
                </CardContent>
            )}
        </Card>
    );
}
