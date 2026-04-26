import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    LLMProvider,
    LLMApiKeys,
    LLMModels,
    GEMINI_MODELS,
    CLAUDE_MODELS,
    OPENAI_MODELS,
    PROVIDER_LABELS,
    DEFAULT_MODELS,
} from "@/lib/llm-types";
import {
    getProvider,
    setProvider as saveProvider,
    getApiKeys,
    setApiKeys as saveApiKeys,
    getModels,
    setModels as saveModels,
    getToolConfigs,
    setToolConfigs,
    getSystemPrompts,
    addSystemPrompt,
    updateSystemPrompt,
    deleteSystemPrompt,
    SystemPrompt,
    getDebugMode,
    setDebugMode as saveDebugMode,
    getLangfuseConfig,
    setLangfuseConfig as saveLangfuseConfig,
    LangfuseConfig,
    getPromptVariables,
    setPromptVariables as savePromptVariables,
    PromptVariable,
    exportConfig,
    importConfig,
    ExportedConfig,
    getCustomBaseUrl,
    setCustomBaseUrl as saveCustomBaseUrl,
    getTheme,
    setTheme as saveTheme,
    Theme,
} from "@/lib/storage";
import { fetchCustomModels } from "@/lib/custom-openai";
import { fetchModelsForProvider, clearModelCache, type ModelOption } from "@/lib/model-fetcher";
import { testLangfuseConnection } from "@/lib/langfuse";
import { allTools, ToolConfigMap } from "@/tools";
import { platform } from "@/platform";
import { ArrowLeft, Calculator, Camera, Fingerprint, Globe, MapPin, ChevronDown, ChevronUp, Download, Upload, Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { McpServerSettings } from "@/components/McpServerSettings";
import { CloudSettings } from "@/components/CloudSettings";
import { ToolConnectionTester } from "@/tools/types";
import {
    isBiometricAvailable,
    isBiometricEnrolled,
    enrollBiometric,
    removeBiometric,
} from "@/lib/vault";

interface SettingsProps {
    onBack: () => void;
}

const toolIcons: Record<string, React.ReactNode> = {
    calculator: <Calculator className="h-5 w-5" />,
    screenshot: <Camera className="h-5 w-5" />,
    http_request: <Globe className="h-5 w-5" />,
    geolocation: <MapPin className="h-5 w-5" />,
};

/**
 * Generic connection tester component that uses the tool's connectionTester config
 */
function ToolConnectionTesterUI({
    connectionTester,
    getToolSetting,
}: {
    connectionTester: ToolConnectionTester;
    getToolSetting: (key: string) => string;
}) {
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const [testing, setTesting] = useState(false);

    const canTest = connectionTester.requiredFields.every((f) => getToolSetting(f));

    const handleTest = async () => {
        setTesting(true);
        setTestResult(null);
        try {
            const result = await connectionTester.test(getToolSetting);
            setTestResult(result);
        } catch (e) {
            setTestResult({ success: false, message: e instanceof Error ? e.message : "Test failed" });
        }
        setTesting(false);
    };

    return (
        <>
            {connectionTester.apiLink && connectionTester.apiLink.url !== "#" && (
                <p className="text-xs text-muted-foreground">
                    API Key from{" "}
                    <a href={connectionTester.apiLink.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                        {connectionTester.apiLink.label}
                    </a>
                </p>
            )}
            {connectionTester.apiLink && connectionTester.apiLink.url === "#" && (
                <p className="text-xs text-muted-foreground">{connectionTester.apiLink.label}</p>
            )}
            <div className="flex items-center gap-3 pt-2 border-t">
                <Button size="sm" variant="outline" disabled={!canTest || testing} onClick={handleTest}>
                    {testing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                    Test Connection
                </Button>
                {testResult && (
                    <span className={`text-xs ${testResult.success ? "text-green-600" : "text-red-600"}`}>
                        {testResult.message}
                    </span>
                )}
            </div>
        </>
    );
}

/**
 * Generic custom action component that uses the tool's customAction config
 */
function ToolCustomActionUI({
    customAction,
}: {
    customAction: { label: string; description?: string; getDescription?: () => Promise<string>; variant?: 'default' | 'destructive'; action: () => Promise<{ success: boolean; message: string }>; confirmMessage?: string | (() => Promise<string>) };
}) {
    const [description, setDescription] = useState(customAction.description || "");
    const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
    const [executing, setExecuting] = useState(false);

    // Load dynamic description on mount and after action completes
    useEffect(() => {
        if (customAction.getDescription) {
            customAction.getDescription().then(setDescription);
        }
    }, [customAction, executing]);

    const handleAction = async () => {
        // Get confirmation message
        if (customAction.confirmMessage) {
            const confirmMsg = typeof customAction.confirmMessage === 'function'
                ? await customAction.confirmMessage()
                : customAction.confirmMessage;
            if (!confirm(confirmMsg)) {
                return;
            }
        }

        setExecuting(true);
        setResult(null);
        try {
            const actionResult = await customAction.action();
            setResult(actionResult);
        } catch (e) {
            setResult({ success: false, message: e instanceof Error ? e.message : "Action failed" });
        }
        setExecuting(false);
    };

    const isDestructive = customAction.variant === 'destructive';

    return (
        <div className="flex items-center justify-between pt-2 border-t">
            <span className="text-xs text-muted-foreground">{description}</span>
            <div className="flex items-center gap-2">
                {result && (
                    <span className={`text-xs ${result.success ? "text-green-600" : "text-red-600"}`}>
                        {result.message}
                    </span>
                )}
                <Button
                    size="sm"
                    variant="outline"
                    disabled={executing}
                    onClick={handleAction}
                    className={isDestructive ? "text-red-500 hover:text-red-600 hover:bg-red-50" : undefined}
                >
                    {executing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                    {customAction.label}
                </Button>
            </div>
        </div>
    );
}

export function BiometricSettings() {
    const [available, setAvailable] = useState(false);
    const [enrolled, setEnrolled] = useState(false);
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<{ success: boolean; message: string } | null>(null);

    useEffect(() => {
        async function check() {
            const avail = await isBiometricAvailable();
            setAvailable(avail);
            if (avail) {
                setEnrolled(await isBiometricEnrolled());
            }
        }
        check();
    }, []);

    if (!available) return null;

    const handleToggle = async () => {
        setLoading(true);
        setStatus(null);
        try {
            if (enrolled) {
                await removeBiometric();
                setEnrolled(false);
                setStatus({ success: true, message: "Biometric unlock removed" });
            } else {
                await enrollBiometric();
                setEnrolled(true);
                setStatus({ success: true, message: "Biometric unlock enabled" });
            }
        } catch (e) {
            setStatus({ success: false, message: e instanceof Error ? e.message : "Failed" });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                    <div className="flex-1">
                        <div className="flex items-center gap-2">
                            <Fingerprint className="h-4 w-4" />
                            Biometric Unlock
                        </div>
                        <p className="text-xs font-normal text-muted-foreground">
                            {enrolled
                                ? "Unlock with Face ID or fingerprint instead of your security key"
                                : "Enable biometric authentication for faster access"}
                        </p>
                    </div>
                    <button
                        onClick={handleToggle}
                        disabled={loading}
                        className={`relative w-11 h-6 rounded-full transition-colors ${enrolled ? "bg-primary" : "bg-muted"
                            } ${loading ? "opacity-50" : ""}`}
                    >
                        <span
                            className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${enrolled ? "translate-x-5" : "translate-x-0"
                                }`}
                        />
                    </button>
                </CardTitle>
            </CardHeader>
            {status && (
                <CardContent className="pt-0">
                    <p className={`text-xs ${status.success ? "text-green-600" : "text-destructive"}`}>
                        {status.message}
                    </p>
                </CardContent>
            )}
        </Card>
    );
}
// eslint-disable-next-line max-lines-per-function
export function Settings({ onBack }: SettingsProps) {
    const [provider, setProviderState] = useState<LLMProvider>("gemini");
    const [apiKeys, setApiKeysState] = useState<LLMApiKeys>({});
    const [apiKeyError, setApiKeyError] = useState<string | null>(null);
    const [models, setModelsState] = useState<LLMModels>(DEFAULT_MODELS);
    const [toolConfigs, setToolConfigsState] = useState<ToolConfigMap>({});
    const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
    const [systemPrompts, setSystemPromptsState] = useState<SystemPrompt[]>([]);
    const [debugMode, setDebugModeState] = useState(false);
    const [theme, setThemeState] = useState<Theme>("system");
    // Langfuse config state
    const [langfuseConfig, setLangfuseConfigState] = useState<LangfuseConfig>({
        enabled: false,
        publicKey: "",
        secretKey: "",
        host: "https://cloud.langfuse.com",
    });
    const [langfuseTestResult, setLangfuseTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const [langfuseTesting, setLangfuseTesting] = useState(false);

    // Prompt variables state
    const [promptVariables, setPromptVariablesState] = useState<PromptVariable[]>([]);
    const [newVarKey, setNewVarKey] = useState("");
    const [newVarValue, setNewVarValue] = useState("");

    // Prompt edit modal state
    const [editingPrompt, setEditingPrompt] = useState<SystemPrompt | null>(null);
    const [isAddingPrompt, setIsAddingPrompt] = useState(false);
    const [promptTitle, setPromptTitle] = useState("");
    const [promptText, setPromptText] = useState("");
    // Custom provider state
    const [customBaseUrl, setCustomBaseUrlState] = useState("");
    const [customModels, setCustomModels] = useState<Array<{ id: string; name: string }>>([]);
    const [customModelsLoading, setCustomModelsLoading] = useState(false);
    const [customModelsError, setCustomModelsError] = useState<string | null>(null);
    const [mcpRefreshKey, setMcpRefreshKey] = useState(0);
    // Dynamic model list state (fetched from provider APIs)
    const [dynamicModels, setDynamicModels] = useState<ModelOption[]>([]);
    const [modelsLoading, setModelsLoading] = useState(false);

    const loadSettings = useCallback(async () => {
        const storedProvider = await getProvider();
        const storedApiKeys = await getApiKeys();
        const storedModels = await getModels();
        const storedToolConfigs = await getToolConfigs();
        const storedSystemPrompts = await getSystemPrompts();
        const storedDebugMode = await getDebugMode();
        const storedLangfuseConfig = await getLangfuseConfig();
        const storedPromptVariables = await getPromptVariables();
        const storedCustomBaseUrl = await getCustomBaseUrl();
        const storedTheme = await getTheme();
        setProviderState(storedProvider);
        setApiKeysState(storedApiKeys);
        setModelsState(storedModels);
        setToolConfigsState(storedToolConfigs);
        setSystemPromptsState(storedSystemPrompts);
        setDebugModeState(storedDebugMode);
        setLangfuseConfigState(storedLangfuseConfig);
        setPromptVariablesState(storedPromptVariables);
        setCustomBaseUrlState(storedCustomBaseUrl);
        setThemeState(storedTheme);

        // Auto-load custom models if custom provider is active with credentials
        if (storedProvider === "custom" && storedCustomBaseUrl && storedApiKeys.custom) {
            try {
                setCustomModelsLoading(true);
                const models = await fetchCustomModels(storedCustomBaseUrl, storedApiKeys.custom);
                setCustomModels(models);
            } catch (error) {
                console.error("[Settings] Failed to auto-load custom models:", error);
                setCustomModelsError(error instanceof Error ? error.message : "Failed to load models");
            } finally {
                setCustomModelsLoading(false);
            }
        }
    }, []);

    useEffect(() => {
        loadSettings();
    }, [loadSettings]);

    // Auto-save handlers - save immediately on change
    const updateProvider = (p: LLMProvider) => {
        setProviderState(p);
        saveProvider(p);
    };

    const updateApiKey = (p: LLMProvider, key: string) => {
        const updated = { ...apiKeys, [p]: key };
        setApiKeysState(updated);
        clearModelCache(p);
        saveApiKeys(updated).then(
            () => setApiKeyError(null),
            () => setApiKeyError("Vault is locked. Enter your security key in Sync Settings.")
        );
    };

    const updateModel = (p: LLMProvider, model: string) => {
        const updated = { ...models, [p]: model };
        setModelsState(updated);
        saveModels(updated);
    };

    // Helper to get models for current provider (dynamic with fallback)
    const getModelsForProvider = (p: LLMProvider) => {
        switch (p) {
            case "gemini": return dynamicModels.length > 0 ? dynamicModels : GEMINI_MODELS;
            case "claude": return dynamicModels.length > 0 ? dynamicModels : CLAUDE_MODELS;
            case "openai": return dynamicModels.length > 0 ? dynamicModels : OPENAI_MODELS;
            case "custom": return customModels;
        }
    };

    // Fetch dynamic models when provider or API key changes
    useEffect(() => {
        if (provider === "custom") {
            setDynamicModels([]);
            return;
        }
        const key = apiKeys[provider];
        if (!key) {
            setDynamicModels([]);
            return;
        }
        let cancelled = false;
        setModelsLoading(true);
        fetchModelsForProvider(provider, key).then(({ models: fetched }) => {
            if (!cancelled) {
                setDynamicModels(fetched);
                setModelsLoading(false);
            }
        });
        return () => { cancelled = true; };
    }, [provider, apiKeys]);

    // Helper to get API key link for provider
    const getApiKeyLink = (p: LLMProvider) => {
        switch (p) {
            case "gemini": return { url: "https://aistudio.google.com/apikey", name: "Google AI Studio" };
            case "claude": return { url: "https://console.anthropic.com/settings/keys", name: "Anthropic Console" };
            case "openai": return { url: "https://platform.openai.com/api-keys", name: "OpenAI Platform" };
            case "custom": return null;
        }
    };

    // Custom provider: update base URL and save
    const updateCustomBaseUrl = (url: string) => {
        setCustomBaseUrlState(url);
        saveCustomBaseUrl(url);
        // Clear models when URL changes
        setCustomModels([]);
        setCustomModelsError(null);
    };

    // Custom provider: fetch models from API
    const loadCustomModels = async () => {
        if (!customBaseUrl || !apiKeys.custom) {
            setCustomModelsError("Base URL and API Key required");
            return;
        }
        setCustomModelsLoading(true);
        setCustomModelsError(null);
        try {
            const fetchedModels = await fetchCustomModels(customBaseUrl, apiKeys.custom);
            setCustomModels(fetchedModels);
            // If no model selected yet, select first one
            if (!models.custom && fetchedModels.length > 0) {
                updateModel("custom", fetchedModels[0].id);
            }
        } catch (error) {
            setCustomModelsError(error instanceof Error ? error.message : "Failed to load models");
        } finally {
            setCustomModelsLoading(false);
        }
    };

    const toggleTool = (toolName: string, enabled: boolean) => {
        const updated = {
            ...toolConfigs,
            [toolName]: {
                ...toolConfigs[toolName],
                enabled,
                settings: toolConfigs[toolName]?.settings || {},
            },
        };
        setToolConfigsState(updated);
        setToolConfigs(updated);
    };

    const toggleExpanded = (toolName: string) => {
        setExpandedTools((prev) => {
            const newSet = new Set(prev);
            if (newSet.has(toolName)) {
                newSet.delete(toolName);
            } else {
                newSet.add(toolName);
            }
            return newSet;
        });
    };

    const getToolSetting = (toolName: string, key: string): string => {
        const config = toolConfigs[toolName];
        if (config?.settings && key in config.settings) {
            return String(config.settings[key]);
        }
        // Fall back to default
        const tool = allTools.find((t) => t.name === toolName);
        if (tool?.defaultConfig && key in tool.defaultConfig) {
            return String(tool.defaultConfig[key]);
        }
        return "";
    };

    const setToolSetting = (toolName: string, key: string, value: string) => {
        const updated = {
            ...toolConfigs,
            [toolName]: {
                ...toolConfigs[toolName],
                enabled: toolConfigs[toolName]?.enabled ?? allTools.find((t) => t.name === toolName)?.enabledByDefault ?? true,
                settings: {
                    ...toolConfigs[toolName]?.settings,
                    [key]: value,
                },
            },
        };
        setToolConfigsState(updated);
        setToolConfigs(updated);
    };

    const isToolEnabled = (toolName: string) => {
        const config = toolConfigs[toolName];
        if (typeof config !== "undefined" && typeof config.enabled !== "undefined") {
            return config.enabled;
        }
        // Fall back to default
        const tool = allTools.find((t) => t.name === toolName);
        return tool?.enabledByDefault ?? true;
    };

    const hasSettings = (toolName: string) => {
        const tool = allTools.find((t) => t.name === toolName);
        return (tool?.settingsFields && tool.settingsFields.length > 0) ||
            !!tool?.connectionTester ||
            !!tool?.customAction;
    };

    const handleExport = async () => {
        try {
            const config = await exportConfig();
            const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `procura-config-${new Date().toISOString().split("T")[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error("Export failed:", e);
        }
    };

    const handleImport = () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json";
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                const config: ExportedConfig = JSON.parse(text);
                try {
                    await importConfig(config);
                    window.location.reload();
                } catch (importError) {
                    const errorMsg = importError instanceof Error ? importError.message : "Unknown error";
                    if (errorMsg.includes("Provide the vault key")) {
                        // Cross-device import - prompt for vault key
                        const vaultKey = prompt(
                            "This export is from a different device. " +
                            "Enter your vault security key to decrypt the secrets:"
                        );
                        if (vaultKey) {
                            await importConfig(config, vaultKey);
                            window.location.reload();
                        }
                    } else {
                        throw importError;
                    }
                }
            } catch (e) {
                console.error("Import failed:", e);
                alert(`Import failed: ${e instanceof Error ? e.message : "Invalid config file"}`);
            }
        };
        input.click();
    };

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center gap-2 p-4 border-b">
                <Button variant="ghost" size="icon" onClick={onBack}>
                    <ArrowLeft className="h-5 w-5" />
                </Button>
                <h1 className="text-lg font-semibold flex-1">Settings</h1>
                <Button variant="ghost" size="icon" onClick={handleExport} title="Export Config">
                    <Download className="h-5 w-5" />
                </Button>
                <Button variant="ghost" size="icon" onClick={handleImport} title="Import Config">
                    <Upload className="h-5 w-5" />
                </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6">
                <Card>
                    <CardHeader className="pb-4">
                        <CardTitle className="text-base">AI Provider</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Provider</label>
                            <Select value={provider} onValueChange={(v) => updateProvider(v as LLMProvider)}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select provider..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {(["gemini", "claude", "openai", "custom"] as LLMProvider[]).map((p) => (
                                        <SelectItem key={p} value={p}>
                                            {PROVIDER_LABELS[p]}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Custom provider: Base URL field */}
                        {provider === "custom" && (
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Base URL</label>
                                <Input
                                    type="url"
                                    placeholder="https://your-api-endpoint.com"
                                    value={customBaseUrl}
                                    onChange={(e) => updateCustomBaseUrl(e.target.value)}
                                />
                                <p className="text-xs text-muted-foreground">
                                    The base URL of your OpenAI-compatible API (e.g., LiteLLM, Ollama)
                                </p>
                            </div>
                        )}

                        <div className="space-y-2">
                            <label className="text-sm font-medium">{PROVIDER_LABELS[provider]} API Key</label>
                            <Input
                                type="password"
                                placeholder={`Your ${PROVIDER_LABELS[provider]} API Key...`}
                                value={apiKeys[provider] || ""}
                                onChange={(e) => updateApiKey(provider, e.target.value)}
                            />
                            {apiKeyError && (
                                <p className="text-xs text-destructive">{apiKeyError}</p>
                            )}
                            {getApiKeyLink(provider) && (
                                <p className="text-xs text-muted-foreground">
                                    You can create your API Key at{" "}
                                    <a
                                        href={getApiKeyLink(provider)!.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-primary hover:underline"
                                    >
                                        {getApiKeyLink(provider)!.name}
                                    </a>
                                    .
                                </p>
                            )}
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Model</label>
                            {provider === "custom" ? (
                                <>
                                    <div className="flex gap-2">
                                        <Select
                                            value={models[provider] || ""}
                                            onValueChange={(v) => updateModel(provider, v)}
                                            onOpenChange={(open) => {
                                                if (open && customBaseUrl && apiKeys.custom) {
                                                    loadCustomModels();
                                                }
                                            }}
                                        >
                                            <SelectTrigger className="flex-1">
                                                <SelectValue placeholder={customModelsLoading ? "Loading models..." : "Select model..."} />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {customModelsLoading && customModels.length === 0 && (
                                                    <div className="flex items-center justify-center py-2 text-sm text-muted-foreground">
                                                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                                        Loading...
                                                    </div>
                                                )}
                                                {!customModelsLoading && customModels.length === 0 && (
                                                    <div className="py-2 text-sm text-muted-foreground text-center">
                                                        No models found
                                                    </div>
                                                )}
                                                {customModels.map((model) => (
                                                    <SelectItem key={model.id} value={model.id}>
                                                        {model.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    {customModelsError && (
                                        <p className="text-xs text-destructive">{customModelsError}</p>
                                    )}
                                    {customModels.length > 0 && (
                                        <p className="text-xs text-muted-foreground">
                                            {customModels.length} model(s) available
                                        </p>
                                    )}
                                </>
                            ) : (
                                <Select
                                    value={models[provider]}
                                    onValueChange={(v) => updateModel(provider, v)}
                                    disabled={modelsLoading}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder={modelsLoading ? "Loading models…" : "Select model..."} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {getModelsForProvider(provider).map((model) => (
                                            <SelectItem key={model.id} value={model.id}>
                                                {model.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center gap-2">
                            <div className="flex-1">
                                <div>Debug Mode</div>
                                <p className="text-xs font-normal text-muted-foreground">
                                    Show LLM calls, tool executions, and timing info
                                </p>
                            </div>
                            <button
                                onClick={() => {
                                    setDebugModeState(!debugMode);
                                    saveDebugMode(!debugMode);
                                }}
                                className={`relative w-11 h-6 rounded-full transition-colors ${debugMode ? "bg-primary" : "bg-muted"
                                    }`}
                            >
                                <span
                                    className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${debugMode ? "translate-x-5" : "translate-x-0"
                                        }`}
                                />
                            </button>
                        </CardTitle>
                    </CardHeader>
                </Card>


                <Card>
                    <CardHeader className="pb-4">
                        <CardTitle className="text-base">Appearance</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-3">
                            <span className="text-sm font-medium">Theme</span>
                            <div className="flex gap-2">
                                {(["light", "dark", "system"] as Theme[]).map((t) => (
                                    <button
                                        key={t}
                                        onClick={() => {
                                            setThemeState(t);
                                            saveTheme(t);
                                        }}
                                        className={`px-4 py-2 text-sm rounded-md border transition-colors ${theme === t
                                            ? "bg-primary text-primary-foreground border-primary"
                                            : "bg-background text-foreground border-input hover:bg-muted"
                                            }`}
                                    >
                                        {{ light: "Light", dark: "Dark", system: "System" }[t]}
                                    </button>
                                ))}
                            </div>
                            <p className="text-xs text-muted-foreground">
                                System follows your device preference
                            </p>
                        </div>
                    </CardContent>
                </Card>

                {/* Biometric Unlock — hidden: WebAuthn PRF unreliable across devices */}
                {/* <BiometricSettings /> */}

                <Card>
                    <CardHeader className="pb-4">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-base">System Prompts</CardTitle>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                    setIsAddingPrompt(true);
                                    setEditingPrompt(null);
                                    setPromptTitle("");
                                    setPromptText("");
                                }}
                            >
                                <Plus className="h-4 w-4 mr-1" />
                                Add
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        {/* Add New Prompt Form (only when adding, not editing) */}
                        {isAddingPrompt && (
                            <div className="border rounded-md p-3 mb-3 bg-muted/30 space-y-3">
                                <Input
                                    placeholder="Prompt Title"
                                    value={promptTitle}
                                    onChange={(e) => setPromptTitle(e.target.value)}
                                    className="text-sm"
                                />
                                <textarea
                                    className="w-full min-h-[100px] p-3 text-sm border rounded-md bg-background resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                                    placeholder="Instructions for the agent..."
                                    value={promptText}
                                    onChange={(e) => setPromptText(e.target.value)}
                                />
                                <div className="flex gap-2 justify-end">
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                            setIsAddingPrompt(false);
                                            setPromptTitle("");
                                            setPromptText("");
                                        }}
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        size="sm"
                                        disabled={!promptTitle.trim() || !promptText.trim()}
                                        onClick={async () => {
                                            await addSystemPrompt(promptTitle.trim(), promptText.trim());
                                            const updated = await getSystemPrompts();
                                            setSystemPromptsState(updated);
                                            setIsAddingPrompt(false);
                                            setPromptTitle("");
                                            setPromptText("");
                                        }}
                                    >
                                        Add
                                    </Button>
                                </div>
                            </div>
                        )}

                        {/* Prompts List */}
                        {systemPrompts.length === 0 && !isAddingPrompt ? (
                            <p className="text-sm text-muted-foreground py-2">
                                No system prompts configured. Add one to customize the agent's behavior.
                            </p>
                        ) : (
                            <div className="space-y-2">
                                {systemPrompts.map((prompt) => (
                                    editingPrompt?.id === prompt.id ? (
                                        /* Inline Edit Form - replaces the card when editing */
                                        <div key={prompt.id} className="border rounded-md p-3 bg-muted/30 space-y-3">
                                            <Input
                                                placeholder="Prompt Title"
                                                value={promptTitle}
                                                onChange={(e) => setPromptTitle(e.target.value)}
                                                className="text-sm"
                                            />
                                            <textarea
                                                className="w-full min-h-[100px] p-3 text-sm border rounded-md bg-background resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                                                placeholder="Instructions for the agent..."
                                                value={promptText}
                                                onChange={(e) => setPromptText(e.target.value)}
                                            />
                                            <div className="flex gap-2 justify-end">
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => {
                                                        setEditingPrompt(null);
                                                        setPromptTitle("");
                                                        setPromptText("");
                                                    }}
                                                >
                                                    Cancel
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    disabled={!promptTitle.trim() || !promptText.trim()}
                                                    onClick={async () => {
                                                        await updateSystemPrompt(editingPrompt.id, promptTitle.trim(), promptText.trim());
                                                        const updated = await getSystemPrompts();
                                                        setSystemPromptsState(updated);
                                                        setEditingPrompt(null);
                                                        setPromptTitle("");
                                                        setPromptText("");
                                                    }}
                                                >
                                                    Save
                                                </Button>
                                            </div>
                                        </div>
                                    ) : (
                                        /* Prompt Card */
                                        <div
                                            key={prompt.id}
                                            className="flex items-start justify-between p-3 border rounded-md bg-background"
                                        >
                                            <div className="flex-1 min-w-0 mr-2">
                                                <p className="text-sm font-medium truncate">{prompt.title}</p>
                                                <p className="text-xs text-muted-foreground truncate">
                                                    {prompt.prompt.substring(0, 80)}{prompt.prompt.length > 80 ? "..." : ""}
                                                </p>
                                            </div>
                                            <div className="flex gap-1 shrink-0">
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className="h-7 w-7"
                                                    onClick={() => {
                                                        setEditingPrompt(prompt);
                                                        setIsAddingPrompt(false);
                                                        setPromptTitle(prompt.title);
                                                        setPromptText(prompt.prompt);
                                                    }}
                                                >
                                                    <Pencil className="h-3 w-3" />
                                                </Button>
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className="h-7 w-7 text-destructive hover:text-destructive"
                                                    onClick={async () => {
                                                        if (confirm(`Delete "${prompt.title}"?`)) {
                                                            await deleteSystemPrompt(prompt.id);
                                                            const updated = await getSystemPrompts();
                                                            setSystemPromptsState(updated);
                                                        }
                                                    }}
                                                >
                                                    <Trash2 className="h-3 w-3" />
                                                </Button>
                                            </div>
                                        </div>
                                    )
                                ))}
                            </div>
                        )}
                        <p className="text-xs text-muted-foreground pt-2">
                            System prompts influence the agent's behavior. Select one when starting a new chat.
                        </p>
                    </CardContent>
                </Card>

                {/* Langfuse Integration */}
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center gap-2">
                            <div className="flex-1">
                                <div>Langfuse Integration</div>
                                <p className="text-xs font-normal text-muted-foreground">
                                    Remote prompts and tracing for observability
                                </p>
                            </div>
                            <button
                                onClick={() => {
                                    const updated = { ...langfuseConfig, enabled: !langfuseConfig.enabled };
                                    setLangfuseConfigState(updated);
                                    saveLangfuseConfig(updated);
                                    setLangfuseTestResult(null);
                                }}
                                className={`relative w-11 h-6 rounded-full transition-colors ${langfuseConfig.enabled ? "bg-primary" : "bg-muted"
                                    }`}
                            >
                                <span
                                    className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${langfuseConfig.enabled ? "translate-x-5" : "translate-x-0"
                                        }`}
                                />
                            </button>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">

                        {langfuseConfig.enabled && (
                            <>
                                <div className="space-y-2">
                                    <label className="text-xs font-medium">Host (optional)</label>
                                    <Input
                                        type="url"
                                        placeholder="https://cloud.langfuse.com"
                                        value={langfuseConfig.host}
                                        onChange={(e) => {
                                            const updated = { ...langfuseConfig, host: e.target.value };
                                            setLangfuseConfigState(updated);
                                            saveLangfuseConfig(updated);
                                        }}
                                        className="text-sm"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <label className="text-xs font-medium">Public Key</label>
                                    <Input
                                        type="text"
                                        placeholder="pk-lf-..."
                                        value={langfuseConfig.publicKey}
                                        onChange={(e) => {
                                            const updated = { ...langfuseConfig, publicKey: e.target.value };
                                            setLangfuseConfigState(updated);
                                            saveLangfuseConfig(updated);
                                        }}
                                        className="text-sm font-mono"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <label className="text-xs font-medium">Secret Key</label>
                                    <Input
                                        type="password"
                                        placeholder="sk-lf-..."
                                        value={langfuseConfig.secretKey}
                                        onChange={(e) => {
                                            const updated = { ...langfuseConfig, secretKey: e.target.value };
                                            setLangfuseConfigState(updated);
                                            saveLangfuseConfig(updated);
                                        }}
                                        className="text-sm font-mono"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <label className="text-xs font-medium">Prompt Tags (optional)</label>
                                    <Input
                                        type="text"
                                        placeholder="e.g. production, procura"
                                        value={(langfuseConfig.tags ?? []).join(", ")}
                                        onChange={(e) => {
                                            const raw = e.target.value;
                                            const tags = raw.split(",").map(t => t.trim());
                                            const updated = { ...langfuseConfig, tags };
                                            setLangfuseConfigState(updated);
                                            saveLangfuseConfig(updated);
                                        }}
                                        className="text-sm"
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        Comma-separated list. Only prompts with at least one matching tag will be shown.
                                    </p>
                                </div>

                                <div className="flex items-center gap-3">
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={!langfuseConfig.publicKey || !langfuseConfig.secretKey || langfuseTesting}
                                        onClick={async () => {
                                            setLangfuseTesting(true);
                                            setLangfuseTestResult(null);
                                            const result = await testLangfuseConnection(langfuseConfig);
                                            if (result.success) {
                                                const tags = langfuseConfig.tags?.filter(t => t.length > 0) ?? [];
                                                if (tags.length > 0 && result.promptCount !== undefined) {
                                                    const { fetchLangfusePromptList } = await import("@/lib/langfuse");
                                                    const all = await fetchLangfusePromptList(langfuseConfig);
                                                    const filtered = all.filter(p => p.tags?.some(t => tags.includes(t)));
                                                    setLangfuseTestResult({
                                                        success: true,
                                                        message: `Connected! Found ${filtered.length} of ${all.length} prompt(s) matching tags.`,
                                                    });
                                                } else {
                                                    setLangfuseTestResult({
                                                        success: true,
                                                        message: `Connected! Found ${result.promptCount} prompt(s).`,
                                                    });
                                                }
                                            } else {
                                                setLangfuseTestResult({
                                                    success: false,
                                                    message: result.error || "Connection failed",
                                                });
                                            }
                                            setLangfuseTesting(false);
                                        }}
                                    >
                                        {langfuseTesting ? (
                                            <Loader2 className="h-4 w-4 animate-spin mr-1" />
                                        ) : null}
                                        Test Connection
                                    </Button>
                                    {langfuseTestResult && (
                                        <span className={`text-xs ${langfuseTestResult.success ? "text-green-600" : "text-red-600"}`}>
                                            {langfuseTestResult.message}
                                        </span>
                                    )}
                                </div>

                            </>
                        )}
                    </CardContent>
                </Card>

                {/* Prompt Variables (for Langfuse template substitution) */}
                {langfuseConfig.enabled && (
                    <Card>
                        <CardHeader className="pb-4">
                            <CardTitle className="text-base">Prompt Variables</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <p className="text-xs text-muted-foreground">
                                Define values for {"{{variable}}"} placeholders in Langfuse prompts
                            </p>

                            {/* Existing variables */}
                            {promptVariables.length > 0 && (
                                <div className="space-y-2">
                                    {promptVariables.map((v, idx) => (
                                        <div key={idx} className="flex gap-2 items-center">
                                            <Input
                                                value={v.key}
                                                onChange={(e) => {
                                                    const updated = [...promptVariables];
                                                    updated[idx] = { ...v, key: e.target.value };
                                                    setPromptVariablesState(updated);
                                                    savePromptVariables(updated);
                                                }}
                                                placeholder="Key"
                                                className="text-sm flex-1"
                                            />
                                            <Input
                                                value={v.value}
                                                onChange={(e) => {
                                                    const updated = [...promptVariables];
                                                    updated[idx] = { ...v, value: e.target.value };
                                                    setPromptVariablesState(updated);
                                                    savePromptVariables(updated);
                                                }}
                                                placeholder="Value"
                                                className="text-sm flex-1"
                                            />
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => {
                                                    const updated = promptVariables.filter((_, i) => i !== idx);
                                                    setPromptVariablesState(updated);
                                                    savePromptVariables(updated);
                                                }}
                                                className="h-8 w-8 text-red-500 hover:text-red-700"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Add new variable */}
                            <div className="flex gap-2 items-center pt-2 border-t">
                                <Input
                                    value={newVarKey}
                                    onChange={(e) => setNewVarKey(e.target.value)}
                                    placeholder="Variable name"
                                    className="text-sm flex-1"
                                />
                                <Input
                                    value={newVarValue}
                                    onChange={(e) => setNewVarValue(e.target.value)}
                                    placeholder="Value"
                                    className="text-sm flex-1"
                                />
                                <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={() => {
                                        if (newVarKey.trim()) {
                                            const updated = [...promptVariables, { key: newVarKey.trim(), value: newVarValue }];
                                            setPromptVariablesState(updated);
                                            savePromptVariables(updated);
                                            setNewVarKey("");
                                            setNewVarValue("");
                                        }
                                    }}
                                    disabled={!newVarKey.trim()}
                                    className="h-8 w-8"
                                >
                                    <Plus className="h-4 w-4" />
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                )}

                <CloudSettings onSyncComplete={loadSettings} onMcpServersChanged={() => setMcpRefreshKey((k) => k + 1)} />

                <McpServerSettings refreshKey={mcpRefreshKey} />

                <Card>
                    <CardHeader className="pb-4">
                        <CardTitle className="text-base">Tools</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {[...allTools].sort((a, b) => a.name.localeCompare(b.name)).map((tool) => {
                            // Check if tool is supported on current platform
                            const isSupported = !tool.supportedPlatforms || tool.supportedPlatforms.includes(platform.name);
                            
                            // Check Langfuse requirements for the prompt editor tool
                            const isLangfusePromptEditor = tool.name === "langfuse_prompt_editor";
                            const langfuseReady = langfuseConfig.enabled && !!langfuseConfig.publicKey && !!langfuseConfig.secretKey;
                            const langfuseDisabled = isLangfusePromptEditor && !langfuseReady;
                            
                            const isToolDisabled = !isSupported || langfuseDisabled;
                            
                            const disableReason = (() => {
                                if (!isSupported) return `This tool is only available in the Chrome extension (requires ${tool.supportedPlatforms?.join(', ')} APIs)`;
                                if (langfuseDisabled) return "This tool requires Langfuse Integration to be fully configured and enabled above.";
                                return undefined;
                            })();

                            return (
                                <div
                                    key={tool.name}
                                    className={`rounded-lg border bg-background overflow-hidden ${isToolDisabled ? 'opacity-50' : ''}`}
                                    title={disableReason}
                                >
                                    <div className="flex items-center justify-between p-3">
                                        <div className="flex items-center gap-3 flex-1 min-w-0">
                                            <div className="text-muted-foreground flex-shrink-0">
                                                {toolIcons[tool.name] || <Globe className="h-5 w-5" />}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="font-medium text-sm flex items-center gap-2">
                                                    {tool.name}
                                                    {!isSupported && (
                                                        <span className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">Extension only</span>
                                                    )}
                                                    {langfuseDisabled && (
                                                        <span className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">Requires Config</span>
                                                    )}
                                                </div>
                                                <div className="text-xs text-muted-foreground truncate" title={tool.description}>
                                                    {tool.description}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            {hasSettings(tool.name) && !isToolDisabled && (
                                                <button
                                                    onClick={() => toggleExpanded(tool.name)}
                                                    className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                                                >
                                                    {expandedTools.has(tool.name) ? (
                                                        <ChevronUp className="h-4 w-4" />
                                                    ) : (
                                                        <ChevronDown className="h-4 w-4" />
                                                    )}
                                                </button>
                                            )}
                                            <button
                                                onClick={() => toggleTool(tool.name, !isToolEnabled(tool.name))}
                                                disabled={isToolDisabled}
                                                className={`relative w-11 h-6 rounded-full transition-colors ${isToolEnabled(tool.name) && !isToolDisabled ? "bg-primary" : "bg-muted"
                                                    } ${isToolDisabled ? 'cursor-not-allowed' : ''}`}
                                            >
                                                <span
                                                    className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${isToolEnabled(tool.name) && !isToolDisabled ? "translate-x-5" : "translate-x-0"
                                                        }`}
                                                />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Expandable settings section */}
                                    {hasSettings(tool.name) && expandedTools.has(tool.name) && (
                                        <div className="border-t p-3 space-y-3 bg-muted/30">
                                            {tool.settingsFields?.map((field) => (
                                                <div key={field.key} className="space-y-1">
                                                    <label className="text-xs font-medium">{field.label}</label>
                                                    {field.type === "select" ? (
                                                        <Select
                                                            value={getToolSetting(tool.name, field.key)}
                                                            onValueChange={(value) => setToolSetting(tool.name, field.key, value)}
                                                        >
                                                            <SelectTrigger className="h-8 text-xs">
                                                                <SelectValue placeholder={field.placeholder || "Select..."} />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                {field.options?.map((option) => (
                                                                    <SelectItem key={option.value} value={option.value}>
                                                                        {option.label}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    ) : (
                                                        <Input
                                                            type={field.type}
                                                            placeholder={field.placeholder}
                                                            value={getToolSetting(tool.name, field.key)}
                                                            onChange={(e) => setToolSetting(tool.name, field.key, e.target.value)}
                                                            className="h-8 text-xs"
                                                        />
                                                    )}
                                                </div>
                                            ))}
                                            {tool.connectionTester && (
                                                <ToolConnectionTesterUI
                                                    connectionTester={tool.connectionTester}
                                                    getToolSetting={(key) => getToolSetting(tool.name, key)}
                                                />
                                            )}
                                            {tool.customAction && (
                                                <ToolCustomActionUI customAction={tool.customAction} />
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </CardContent>
                </Card>

                <p className="text-center text-xs text-muted-foreground pb-2">
                    Procura v{__APP_VERSION__}{__DEV_BUILD__ ? "-dev" : ""}
                </p>

            </div >
        </div >
    );
}
