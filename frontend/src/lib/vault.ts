import { formatMasterKey, parseMasterKey } from "./sync-client";
import { platform } from "@/platform";

const VAULT_META_KEY = "procura_vault_meta";
const VAULT_SESSION_KEY = "procura_vault_session";
const VAULT_VERSION = 1;
const VAULT_PBKDF2_ITERATIONS = 200_000;
const VAULT_SALT_BYTES = 16;

interface VaultMetadata {
    version: number;
    saltBase64: string;
    iterations: number;
    keyHashBase64: string;
}

let cachedBaseKey: Uint8Array | null = null;
let cachedLocalKey: CryptoKey | null = null;
let cachedSyncMasterKey: string | null = null;

function uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function getSessionValue(): Promise<string | null> {
    if (typeof chrome !== "undefined" && chrome.storage?.session) {
        return new Promise((resolve) => {
            chrome.storage.session.get([VAULT_SESSION_KEY], (result) => {
                resolve((result[VAULT_SESSION_KEY] as string) || null);
            });
        });
    }
    if (typeof sessionStorage !== "undefined") {
        return sessionStorage.getItem(VAULT_SESSION_KEY);
    }
    return null;
}

async function setSessionValue(value: string | null): Promise<void> {
    if (typeof chrome !== "undefined" && chrome.storage?.session) {
        await new Promise<void>((resolve) => {
            if (value === null) {
                chrome.storage.session.remove([VAULT_SESSION_KEY], () => resolve());
                return;
            }
            chrome.storage.session.set({ [VAULT_SESSION_KEY]: value }, () => resolve());
        });
        return;
    }
    if (typeof sessionStorage !== "undefined") {
        if (value === null) {
            sessionStorage.removeItem(VAULT_SESSION_KEY);
        } else {
            sessionStorage.setItem(VAULT_SESSION_KEY, value);
        }
    }
}

function normalizeVaultKey(input: string): string {
    const cleaned = input.trim().replace(/\s+/g, "");
    return cleaned.replace(/-/g, "+").replace(/_/g, "/");
}

async function deriveBaseKeyBytes(vaultKeyBase64: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
    const vaultKeyBytes = base64ToUint8Array(vaultKeyBase64);
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        toArrayBuffer(vaultKeyBytes),
        "PBKDF2",
        false,
        ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
        {
            name: "PBKDF2",
            hash: "SHA-256",
            salt: toArrayBuffer(salt),
            iterations,
        },
        keyMaterial,
        256
    );
    return new Uint8Array(bits);
}

async function hashBaseKey(baseKey: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(baseKey));
    return uint8ArrayToBase64(new Uint8Array(digest));
}

async function deriveLocalKey(baseKey: Uint8Array): Promise<CryptoKey> {
    const hkdfKey = await crypto.subtle.importKey(
        "raw",
        toArrayBuffer(baseKey),
        "HKDF",
        false,
        ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
        {
            name: "HKDF",
            hash: "SHA-256",
            salt: new TextEncoder().encode("procura-vault-v1"),
            info: new TextEncoder().encode("local-encrypt"),
        },
        hkdfKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

async function deriveSyncMasterKey(baseKey: Uint8Array): Promise<string> {
    const hkdfKey = await crypto.subtle.importKey(
        "raw",
        toArrayBuffer(baseKey),
        "HKDF",
        false,
        ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
        {
            name: "HKDF",
            hash: "SHA-256",
            salt: new TextEncoder().encode("procura-vault-v1"),
            info: new TextEncoder().encode("sync-master"),
        },
        hkdfKey,
        256
    );
    return uint8ArrayToBase64(new Uint8Array(bits));
}

async function readVaultMeta(): Promise<VaultMetadata | null> {
    try {
        const result = await platform.storage.get<VaultMetadata>([VAULT_META_KEY]);
        return result[VAULT_META_KEY] || null;
    } catch {
        return null;
    }
}

async function writeVaultMeta(meta: VaultMetadata): Promise<void> {
    await platform.storage.set({ [VAULT_META_KEY]: meta });
}

export async function isVaultConfigured(): Promise<boolean> {
    return !!(await readVaultMeta());
}

export function isVaultUnlocked(): boolean {
    return cachedBaseKey !== null;
}

export function lockVault(): void {
    cachedBaseKey = null;
    cachedLocalKey = null;
    cachedSyncMasterKey = null;
    void setSessionValue(null);
}

export async function generateVaultKey(): Promise<string> {
    const key = crypto.getRandomValues(new Uint8Array(32));
    return uint8ArrayToBase64(key);
}

export function formatVaultKey(vaultKeyBase64: string): string {
    return formatMasterKey(vaultKeyBase64);
}

export function parseVaultKey(formatted: string): string {
    return parseMasterKey(formatted);
}

/** Syntactic validation only: key is non-empty, valid base64, decodes to 32 bytes. */
export function isVaultKeySyntaxValid(input: string): boolean {
    const normalized = normalizeVaultKey(input.trim());
    if (!normalized.length) return false;
    try {
        const bytes = base64ToUint8Array(normalized);
        return bytes.length === 32;
    } catch {
        return false;
    }
}

export async function configureVaultWithKey(vaultKeyInput: string): Promise<void> {
    const normalized = normalizeVaultKey(vaultKeyInput);
    const salt = crypto.getRandomValues(new Uint8Array(VAULT_SALT_BYTES));
    const baseKey = await deriveBaseKeyBytes(normalized, salt, VAULT_PBKDF2_ITERATIONS);
    const keyHashBase64 = await hashBaseKey(baseKey);
    const meta: VaultMetadata = {
        version: VAULT_VERSION,
        saltBase64: uint8ArrayToBase64(salt),
        iterations: VAULT_PBKDF2_ITERATIONS,
        keyHashBase64,
    };
    await writeVaultMeta(meta);
    cachedBaseKey = baseKey;
    cachedLocalKey = null;
    cachedSyncMasterKey = null;
    await setSessionValue(uint8ArrayToBase64(baseKey));
}

export async function unlockVault(vaultKeyInput: string): Promise<boolean> {
    const meta = await readVaultMeta();
    if (!meta) return false;
    const normalized = normalizeVaultKey(vaultKeyInput);
    const salt = base64ToUint8Array(meta.saltBase64);
    const baseKey = await deriveBaseKeyBytes(normalized, salt, meta.iterations);
    const keyHashBase64 = await hashBaseKey(baseKey);
    if (keyHashBase64 !== meta.keyHashBase64) {
        return false;
    }
    cachedBaseKey = baseKey;
    cachedLocalKey = null;
    cachedSyncMasterKey = null;
    await setSessionValue(uint8ArrayToBase64(baseKey));
    return true;
}

export async function restoreVaultFromSession(): Promise<boolean> {
    if (cachedBaseKey) {
        return true;
    }
    const meta = await readVaultMeta();
    if (!meta) return false;
    const stored = await getSessionValue();
    if (!stored) return false;
    const baseKey = base64ToUint8Array(stored);
    const keyHashBase64 = await hashBaseKey(baseKey);
    if (keyHashBase64 !== meta.keyHashBase64) {
        await setSessionValue(null);
        return false;
    }
    cachedBaseKey = baseKey;
    cachedLocalKey = null;
    cachedSyncMasterKey = null;
    return true;
}

export async function getVaultKeyHash(): Promise<string | null> {
    const meta = await readVaultMeta();
    return meta?.keyHashBase64 ?? null;
}

export interface VaultMeta {
    saltBase64: string;
    iterations: number;
    keyHashBase64: string;
}

export async function getVaultMeta(): Promise<VaultMeta | null> {
    const meta = await readVaultMeta();
    if (!meta) return null;
    return {
        saltBase64: meta.saltBase64,
        iterations: meta.iterations,
        keyHashBase64: meta.keyHashBase64,
    };
}

/**
 * Decrypt data using external vault parameters (salt, iterations, keyHash).
 * Used for cross-device import where the current vault has a different salt.
 * Requires the vault to be unlocked to get the vault key.
 */
export async function decryptWithExternalVaultParams<T>(
    encryptedBase64: string,
    externalMeta: VaultMeta,
    vaultKeyInput: string
): Promise<T> {
    const normalized = normalizeVaultKey(vaultKeyInput);
    const salt = base64ToUint8Array(externalMeta.saltBase64);
    const baseKey = await deriveBaseKeyBytes(normalized, salt, externalMeta.iterations);
    const keyHashBase64 = await hashBaseKey(baseKey);

    if (keyHashBase64 !== externalMeta.keyHashBase64) {
        throw new Error("Security key does not match export");
    }

    const localKey = await deriveLocalKey(baseKey);
    const combined = base64ToUint8Array(encryptedBase64);
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    try {
        const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, localKey, ciphertext);
        const json = new TextDecoder().decode(decrypted);
        return JSON.parse(json) as T;
    } catch (e) {
        throw new Error(`Decryption failed — the security key may be incorrect or the export file is corrupted (${(e as Error).name})`);
    }
}

async function getLocalKey(): Promise<CryptoKey> {
    if (!cachedBaseKey) {
        throw new Error("Vault is locked");
    }
    if (!cachedLocalKey) {
        cachedLocalKey = await deriveLocalKey(cachedBaseKey);
    }
    return cachedLocalKey;
}

export async function getSyncMasterKey(): Promise<string> {
    if (!cachedBaseKey) {
        throw new Error("Vault is locked");
    }
    if (!cachedSyncMasterKey) {
        cachedSyncMasterKey = await deriveSyncMasterKey(cachedBaseKey);
    }
    return cachedSyncMasterKey;
}

export async function encryptWithVault(value: unknown): Promise<string> {
    const key = await getLocalKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(JSON.stringify(value));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);
    return uint8ArrayToBase64(combined);
}

export async function decryptWithVault<T>(encryptedBase64: string): Promise<T> {
    const key = await getLocalKey();
    const combined = base64ToUint8Array(encryptedBase64);
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    const json = new TextDecoder().decode(decrypted);
    return JSON.parse(json) as T;
}
