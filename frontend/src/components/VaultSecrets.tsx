/**
 * Vault Secrets Management Component
 *
 * Allows users to store, view, and delete server-side secrets
 * (e.g. OPENWEATHERMAP_API_KEY, GOOGLE_CLIENT_ID) that are
 * encrypted on the backend using the client's API key (BYOK).
 */

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    KeyRound,
    Plus,
    Trash2,
    Loader2,
    Check,
    AlertCircle,
    Eye,
    EyeOff,
} from "lucide-react";

// =============================================================================
// Types
// =============================================================================

interface VaultSecret {
    name: string;
    set: boolean;
    updatedAt: number;
}

interface VaultSecretsProps {
    baseUrl: string;
    apiKey: string;
}

// =============================================================================
// Component
// =============================================================================

export function VaultSecrets({ baseUrl, apiKey }: VaultSecretsProps) {
    const [secrets, setSecrets] = useState<VaultSecret[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    // New secret form
    const [showAdd, setShowAdd] = useState(false);
    const [newName, setNewName] = useState("");
    const [newValue, setNewValue] = useState("");
    const [showValue, setShowValue] = useState(false);

    const cleanBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;

    const fetchSecrets = useCallback(async () => {
        if (!apiKey) return;
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${cleanBase}/vault/secrets`, {
                headers: { "X-API-Key": apiKey },
            });
            if (!res.ok) throw new Error(`Failed to load secrets: ${res.status}`);
            const data = (await res.json()) as { secrets: VaultSecret[] };
            setSecrets(data.secrets);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load secrets");
        } finally {
            setLoading(false);
        }
    }, [cleanBase, apiKey]);

    useEffect(() => {
        fetchSecrets();
    }, [fetchSecrets]);

    async function handleSave() {
        const name = newName.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
        const value = newValue.trim();
        if (!name || !value) return;

        setSaving(true);
        setError(null);
        try {
            const res = await fetch(`${cleanBase}/vault/secrets`, {
                method: "PUT",
                headers: {
                    "X-API-Key": apiKey,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ [name]: value }),
            });
            if (!res.ok) throw new Error(`Failed to save: ${res.status}`);
            setNewName("");
            setNewValue("");
            setShowAdd(false);
            setShowValue(false);
            await fetchSecrets();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to save secret");
        } finally {
            setSaving(false);
        }
    }

    async function handleDelete(name: string) {
        setError(null);
        try {
            const res = await fetch(`${cleanBase}/vault/secrets/${encodeURIComponent(name)}`, {
                method: "DELETE",
                headers: { "X-API-Key": apiKey },
            });
            if (!res.ok && res.status !== 404) throw new Error(`Failed to delete: ${res.status}`);
            await fetchSecrets();
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to delete secret");
        }
    }

    return (
        <div className="space-y-2 pt-2 border-t">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <KeyRound className="h-3 w-3" />
                    Server Secrets
                </div>
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => setShowAdd(!showAdd)}
                >
                    <Plus className="h-3 w-3 mr-1" />
                    Add
                </Button>
            </div>

            {/* Add new secret form */}
            {showAdd && (
                <div className="space-y-1.5 p-2 rounded-md bg-muted/50">
                    <Input
                        placeholder="SECRET_NAME"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))}
                        className="h-7 text-xs font-mono"
                    />
                    <div className="flex gap-1">
                        <div className="relative flex-1">
                            <Input
                                type={showValue ? "text" : "password"}
                                placeholder="Secret value..."
                                value={newValue}
                                onChange={(e) => setNewValue(e.target.value)}
                                className="h-7 text-xs font-mono pr-7"
                            />
                            <button
                                type="button"
                                onClick={() => setShowValue(!showValue)}
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            >
                                {showValue ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                            </button>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2"
                            onClick={handleSave}
                            disabled={saving || !newName.trim() || !newValue.trim()}
                        >
                            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                        </Button>
                    </div>
                </div>
            )}

            {/* Existing secrets list */}
            {loading && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground py-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading...
                </div>
            )}

            {!loading && secrets.length === 0 && (
                <p className="text-xs text-muted-foreground py-1">
                    No secrets stored. Add one to configure server-side services.
                </p>
            )}

            {secrets.map((secret) => (
                <div
                    key={secret.name}
                    className="flex items-center justify-between py-1 px-2 rounded text-xs hover:bg-muted/50 group"
                >
                    <span className="font-mono text-muted-foreground">{secret.name}</span>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity text-destructive"
                        onClick={() => handleDelete(secret.name)}
                        title="Delete secret"
                    >
                        <Trash2 className="h-3 w-3" />
                    </Button>
                </div>
            ))}

            {/* Error display */}
            {error && (
                <div className="flex items-center gap-1.5 text-xs text-destructive">
                    <AlertCircle className="h-3 w-3" />
                    {error}
                </div>
            )}
        </div>
    );
}
