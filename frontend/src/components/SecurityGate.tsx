import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Check, Copy, Fingerprint, Key, Lock, Upload } from "lucide-react";
import {
    configureVaultWithKey,
    formatVaultKey,
    generateVaultKey,
    isVaultConfigured,
    isVaultKeySyntaxValid,
    restoreVaultFromSession,
    unlockVault,
    isBiometricEnrolled,
    unlockWithBiometric,
} from "@/lib/vault";
import { importConfig, ExportedConfig } from "@/lib/storage";

interface SecurityGateProps {
    onUnlocked: () => void;
}

type GateMode = "unlock" | "generate" | "import";

export function SecurityGate({ onUnlocked }: SecurityGateProps) {
    const [mode, setMode] = useState<GateMode>("unlock");
    const [configured, setConfigured] = useState(false);
    const [inputKey, setInputKey] = useState("");
    const [generatedKey, setGeneratedKey] = useState<string | null>(null);
    const [keyCopied, setKeyCopied] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [biometricAvailable, setBiometricAvailable] = useState(false);

    const handleBiometricUnlock = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const success = await unlockWithBiometric();
            if (success) {
                onUnlocked();
            } else {
                setError("Biometric unlock failed. Please use your security key.");
            }
        } catch (e) {
            setError(`Biometric unlock failed: ${e}`);
        } finally {
            setLoading(false);
        }
    }, [onUnlocked]);

    useEffect(() => {
        async function init() {
            await restoreVaultFromSession();
            const isConfigured = await isVaultConfigured();
            setConfigured(isConfigured);
            setMode(isConfigured ? "unlock" : "generate");

            // Check biometric enrollment and auto-trigger if available
            if (isConfigured) {
                const enrolled = await isBiometricEnrolled();
                setBiometricAvailable(enrolled);
                if (enrolled) {
                    handleBiometricUnlock();
                }
            }
        }
        init();
    }, [handleBiometricUnlock]);

    const handleUnlock = async () => {
        const key = inputKey.trim();
        if (!key) {
            setError("Please enter your security key");
            return;
        }
        if (!isVaultKeySyntaxValid(key)) {
            setError("Invalid key format. Use the 44-character key (with or without spaces/dashes).");
            return;
        }
        setLoading(true);
        setError(null);
        try {
            if (configured) {
                // Vault exists - key must match
                const matched = await unlockVault(key);
                if (!matched) {
                    setError("Security key does not match. Please check your key and try again.");
                    return;
                }
            } else {
                // No vault exists - configure with this key
                await configureVaultWithKey(key);
            }
            onUnlocked();
        } catch (e) {
            setError(`Unlock failed: ${e}`);
        } finally {
            setLoading(false);
        }
    };

    const handleGenerate = async () => {
        setLoading(true);
        setError(null);
        try {
            const key = await generateVaultKey();
            await configureVaultWithKey(key);
            setGeneratedKey(formatVaultKey(key));
        } catch (e) {
            setError(`Key generation failed: ${e}`);
        } finally {
            setLoading(false);
        }
    };

    const copyKey = async () => {
        if (!generatedKey) return;
        await navigator.clipboard.writeText(generatedKey);
        setKeyCopied(true);
        setTimeout(() => setKeyCopied(false), 2000);
    };

    const handleImport = () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json";
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            setLoading(true);
            setError(null);
            try {
                const text = await file.text();
                const config: ExportedConfig = JSON.parse(text);

                // For import from another device, we need the vault key
                const vaultKey = prompt(
                    "Enter your vault security key to import settings from another device:"
                );
                if (!vaultKey) {
                    setError("Import cancelled - vault key required");
                    return;
                }

                // Configure vault with the provided key first
                await configureVaultWithKey(vaultKey);

                // Now import the config
                await importConfig(config, vaultKey);
                onUnlocked();
            } catch (e) {
                console.error("Import failed:", e);
                let msg = "Invalid config file";
                if (e instanceof Error) {
                    if (e.name === "OperationError" || e.message.includes("decrypt")) {
                        msg = "Decryption failed — wrong security key or corrupted export file";
                    } else {
                        msg = e.message || e.name;
                    }
                }
                setError(`Import failed: ${msg}`);
            } finally {
                setLoading(false);
            }
        };
        input.click();
    };

    if (generatedKey) {
        return (
            <div className="h-dvh w-full bg-background flex items-center justify-center p-4">
                <Card className="w-full max-w-lg">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center gap-2">
                            <Key className="h-4 w-4" />
                            Save Your Security Key
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                            <p className="text-sm text-yellow-600 dark:text-yellow-400 font-medium mb-2 flex items-center gap-1">
                                <AlertTriangle className="h-4 w-4" />
                                This key will only be shown once!
                            </p>
                            <p className="text-xs text-muted-foreground">
                                Save it in a secure location. You will need it to unlock the app on this device and connect other devices.
                            </p>
                        </div>

                        <div className="relative">
                            <code className="block p-3 bg-muted rounded-lg text-xs font-mono break-all pr-10">
                                {generatedKey}
                            </code>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="absolute right-1 top-1 h-8 w-8"
                                onClick={copyKey}
                            >
                                {keyCopied ? (
                                    <Check className="h-4 w-4 text-green-500" />
                                ) : (
                                    <Copy className="h-4 w-4" />
                                )}
                            </Button>
                        </div>

                        <Button onClick={onUnlocked} className="w-full">
                            I have saved my key
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="h-dvh w-full bg-background flex items-center justify-center p-4">
            <Card className="w-full max-w-lg">
                <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                        <Lock className="h-4 w-4" />
                        Security Key Required
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <p className="text-xs text-muted-foreground">
                        {configured
                            ? "Enter your security key to unlock the app. You can also generate a new key or import settings."
                            : "Generate a new security key to get started, or import settings from another device."}
                    </p>

                    {configured && (
                        <div className="flex gap-2">
                            <Button
                                variant={mode === "unlock" ? "default" : "outline"}
                                size="sm"
                                className="flex-1"
                                onClick={() => setMode("unlock")}
                            >
                                Use Existing Key
                            </Button>
                            <Button
                                variant={mode === "generate" ? "default" : "outline"}
                                size="sm"
                                className="flex-1"
                                onClick={() => setMode("generate")}
                            >
                                Generate New Key
                            </Button>
                        </div>
                    )}

                    {mode === "unlock" ? (
                        <div className="space-y-2">
                            {biometricAvailable && (
                                <Button
                                    onClick={handleBiometricUnlock}
                                    disabled={loading}
                                    className="w-full"
                                    variant="default"
                                >
                                    <Fingerprint className="h-4 w-4 mr-2" />
                                    {loading ? "Authenticating..." : "Unlock with Biometrics"}
                                </Button>
                            )}
                            <label className="text-xs font-medium">Security Key</label>
                            <Input
                                type="password"
                                placeholder="Enter your security key..."
                                value={inputKey}
                                onChange={(e) => setInputKey(e.target.value)}
                                className="h-8 text-xs font-mono"
                            />
                            <Button onClick={handleUnlock} disabled={loading} className="w-full" variant={biometricAvailable ? "outline" : "default"}>
                                {loading ? "Unlocking..." : "Unlock with Key"}
                            </Button>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <Button onClick={handleGenerate} disabled={loading} className="w-full">
                                {loading ? "Generating..." : "Generate Security Key"}
                            </Button>
                        </div>
                    )}

                    {/* Import Settings - available for both fresh install and existing vault */}
                    <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                            <span className="w-full border-t" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                            <span className="bg-background px-2 text-muted-foreground">or</span>
                        </div>
                    </div>
                    <Button
                        variant="outline"
                        onClick={handleImport}
                        disabled={loading}
                        className="w-full"
                    >
                        <Upload className="h-4 w-4 mr-2" />
                        Import Settings
                    </Button>

                    {error && (
                        <div className="text-xs text-destructive">{error}</div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
