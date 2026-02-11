import { LLMProvider, LLMApiKeys, LLMModels, DEFAULT_MODELS } from "../llm-types";
import {
    isVaultConfigured,
    isVaultUnlocked,
    encryptWithVault,
} from "../vault";
import { storage } from "./adapter";
import { STORAGE_KEYS } from "./keys";
import { readEncryptedOrFallback } from "./vault-helper";

// ============================================================================
// Provider Selection
// ============================================================================

export async function getProvider(): Promise<LLMProvider> {
    return storage.getValueOrDefault<LLMProvider>(STORAGE_KEYS.PROVIDER, "gemini");
}

export async function setProvider(provider: LLMProvider): Promise<void> {
    await storage.set({
        [STORAGE_KEYS.PROVIDER]: provider,
        [STORAGE_KEYS.SETTINGS_LAST_MODIFIED]: Date.now(),
    });
}

// ============================================================================
// API Keys (per provider)
// ============================================================================

export async function getApiKeys(): Promise<LLMApiKeys> {
    const configured = await isVaultConfigured();
    if (!configured) {
        return storage.getValueOrDefault<LLMApiKeys>(STORAGE_KEYS.API_KEYS, {});
    }
    return readEncryptedOrFallback<LLMApiKeys>(STORAGE_KEYS.API_KEYS_ENC, {});
}

export async function setApiKeys(apiKeys: LLMApiKeys): Promise<void> {
    const configured = await isVaultConfigured();
    if (!configured) {
        await storage.set({
            [STORAGE_KEYS.API_KEYS]: apiKeys,
            [STORAGE_KEYS.SETTINGS_LAST_MODIFIED]: Date.now(),
        });
        return;
    }
    if (!isVaultUnlocked()) {
        throw new Error("Vault is locked");
    }
    const encrypted = await encryptWithVault(apiKeys);
    await storage.set({
        [STORAGE_KEYS.API_KEYS_ENC]: encrypted,
        [STORAGE_KEYS.SETTINGS_LAST_MODIFIED]: Date.now(),
    });
    await storage.remove(STORAGE_KEYS.API_KEYS);
}

export async function getApiKeyForProvider(provider: LLMProvider): Promise<string> {
    const keys = await getApiKeys();
    return keys[provider] || "";
}

export async function setApiKeyForProvider(provider: LLMProvider, key: string): Promise<void> {
    const keys = await getApiKeys();
    keys[provider] = key;
    await setApiKeys(keys);
}

// ============================================================================
// Models (per provider)
// ============================================================================

export async function getModels(): Promise<LLMModels> {
    return storage.getValueOrDefault<LLMModels>(STORAGE_KEYS.MODELS, DEFAULT_MODELS);
}

export async function setModels(models: LLMModels): Promise<void> {
    await storage.set({
        [STORAGE_KEYS.MODELS]: models,
        [STORAGE_KEYS.SETTINGS_LAST_MODIFIED]: Date.now(),
    });
}

export async function getModelForProvider(provider: LLMProvider): Promise<string> {
    const models = await getModels();
    return models[provider] || DEFAULT_MODELS[provider];
}

export async function setModelForProvider(provider: LLMProvider, model: string): Promise<void> {
    const models = await getModels();
    models[provider] = model;
    await setModels(models);
}

// ============================================================================
// Custom Provider Base URL
// ============================================================================

export async function getCustomBaseUrl(): Promise<string> {
    return storage.getValueOrDefault<string>(STORAGE_KEYS.CUSTOM_BASE_URL, "");
}

export async function setCustomBaseUrl(url: string): Promise<void> {
    await storage.set({
        [STORAGE_KEYS.CUSTOM_BASE_URL]: url,
        [STORAGE_KEYS.SETTINGS_LAST_MODIFIED]: Date.now(),
    });
}
