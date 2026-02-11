/**
 * Sync Settings Component
 * 
 * UI for configuring cross-device sync:
 * - Enable/disable sync
 * - Create new sync (shows key once)
 * - Connect to existing sync (enter key)
 * - Manual sync trigger
 */

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Cloud,
    CloudOff,
    RefreshCw,
    AlertCircle,
    AlertTriangle,
    Loader2,
} from 'lucide-react';
import {
    getSyncSettings,
    setupNewSync,
    disableSync,
    performSync,
    getSyncUserId,
    SyncSettings as SyncSettingsType,
} from '@/lib/sync-service';
import { isVaultUnlocked, restoreVaultFromSession } from '@/lib/vault';

// Default sync server URL (configurable via VITE_API_BASE_URL)
const DEFAULT_SYNC_SERVER = import.meta.env.VITE_API_BASE_URL ? `${import.meta.env.VITE_API_BASE_URL}/sync` : '';

interface SyncSettingsProps {
    /** Called after a successful sync that pulled items, to allow parent to refresh its state */
    onSyncComplete?: () => void;
}

export function SyncSettings({ onSyncComplete }: SyncSettingsProps) {
    const [settings, setSettings] = useState<SyncSettingsType | null>(null);
    const [userId, setUserId] = useState<string | null>(null);
    const [serverUrl, setServerUrl] = useState(DEFAULT_SYNC_SERVER);
    const [apiKey, setApiKey] = useState('');
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastSyncResult, setLastSyncResult] = useState<string | null>(null);
    const [initError, setInitError] = useState(false);

    // Load settings on mount
    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = async () => {
        try {
            await restoreVaultFromSession();
            const s = await getSyncSettings();
            setSettings(s);
            if (s.serverUrl) setServerUrl(s.serverUrl);
            if (s.apiKey) setApiKey(s.apiKey);
            if (s.enabled) {
                const id = await getSyncUserId();
                setUserId(id);
            }
        } catch (e) {
            console.error('[SyncSettings] Failed to load settings:', e);
            setInitError(true);
        }
    };

    const handleSetupNew = async () => {
        setLoading(true);
        setError(null);
        try {
            await setupNewSync(serverUrl, apiKey || null);
            await loadSettings();
        } catch (e) {
            setError(`Setup failed: ${e}`);
        } finally {
            setLoading(false);
        }
    };

    const handleDisable = async () => {
        if (!confirm('Disable sync? Your local data will be kept.')) return;
        setLoading(true);
        try {
            await disableSync();
            await loadSettings();
        } finally {
            setLoading(false);
        }
    };

    const handleSync = async () => {
        setSyncing(true);
        setLastSyncResult(null);
        try {
            const result = await performSync();
            if (result.success) {
                setLastSyncResult(`Synced: ↓${result.pulled} ↑${result.pushed}`);
                // If we pulled items, notify parent to refresh its state
                if (result.pulled > 0 && onSyncComplete) {
                    onSyncComplete();
                }
            } else {
                setLastSyncResult(`Sync failed: ${result.errors.join(', ')}`);
            }
            await loadSettings();
        } catch (e) {
            setLastSyncResult(`Sync error: ${e}`);
        } finally {
            setSyncing(false);
        }
    };

    // If storage access failed, hide the component entirely (optional feature)
    if (initError) return null;

    if (!settings) return null;

    // Sync enabled view
    if (settings.enabled) {
        return (
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                        <Cloud className="h-4 w-4 text-green-500" />
                        Sync Enabled
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {!isVaultUnlocked() && (
                        <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="h-3 w-3 mt-0.5" />
                            <div>
                                <p className="font-medium">Vault locked</p>
                                <p>Enter your security key to sync and decrypt local secrets.</p>
                            </div>
                        </div>
                    )}
                    <div className="text-xs text-muted-foreground space-y-1">
                        <p>Server: {settings.serverUrl}</p>
                        {userId && <p className="font-mono break-all">ID: {userId}</p>}
                        <p>
                            Last sync: {settings.lastSync ? new Date(settings.lastSync).toLocaleString() : 'Never'}
                            {lastSyncResult && <span className="ml-2">({lastSyncResult})</span>}
                        </p>
                    </div>

                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleSync}
                            disabled={syncing || !isVaultUnlocked()}
                            className="flex-1"
                        >
                            {syncing ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                                <RefreshCw className="h-4 w-4 mr-2" />
                            )}
                            Sync Now
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleDisable}
                            disabled={loading}
                        >
                            <CloudOff className="h-4 w-4" />
                        </Button>
                    </div>
                </CardContent>
            </Card>
        );
    }

    // Sync disabled: enable with API key
    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                    <CloudOff className="h-4 w-4 text-muted-foreground" />
                    Cross-Device Sync
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                    Sync your settings and chats across devices with end-to-end encryption.
                </p>
                <div className="space-y-1">
                    <label className="text-xs font-medium">Sync Server URL</label>
                    <Input
                        type="url"
                        placeholder="https://api.your-server.com"
                        value={serverUrl}
                        onChange={(e) => setServerUrl(e.target.value)}
                        className="h-8 text-xs"
                    />
                </div>

                <div className="space-y-1">
                    <label className="text-xs font-medium">API Key</label>
                    <Input
                        type="password"
                        placeholder="Enter API key..."
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        className="h-8 text-xs font-mono"
                    />
                </div>

                {error && (
                    <div className="flex items-center gap-2 text-xs text-destructive">
                        <AlertCircle className="h-3 w-3" />
                        {error}
                    </div>
                )}

                <Button
                    size="sm"
                    onClick={handleSetupNew}
                    disabled={loading || !serverUrl}
                    className="w-full"
                >
                    {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                    Enable Sync
                </Button>
            </CardContent>
        </Card>
    );
}
