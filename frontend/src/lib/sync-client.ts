/**
 * Sync Client
 * 
 * Handles encrypted cross-device synchronization.
 * Uses HKDF for key derivation and AES-256-GCM for encryption.
 */

// =============================================================================
// Types
// =============================================================================

export interface SyncConfig {
    serverUrl: string;      // e.g., "https://your-server.com/sync"
    masterKey: string;      // Base64-encoded 32-byte master key
    apiKey?: string;        // Optional API key for server authentication
}

export interface SyncObject {
    objectId: string;
    lastModified: number;   // Unix timestamp
}

export interface SyncStatus {
    enabled: boolean;
    lastSync: number | null;
    objectCount: number;
}

// =============================================================================
// Cryptographic Functions (using Web Crypto API)
// =============================================================================

/**
 * Generate a new random master key (32 bytes = 256 bits)
 */
export async function generateMasterKey(): Promise<string> {
    const key = crypto.getRandomValues(new Uint8Array(32));
    return uint8ArrayToBase64(key);
}

/**
 * Derive auth key and encryption key from master key using HKDF
 */
export async function deriveKeys(masterKeyBase64: string): Promise<{
    authKey: Uint8Array;
    encryptKey: CryptoKey;
    userId: string;
}> {
    const masterKey = base64ToUint8Array(masterKeyBase64);

    // Import master key for HKDF
    // Create a new Uint8Array to ensure proper ArrayBuffer typing
    const keyData = new Uint8Array(masterKey);
    const baseKey = await crypto.subtle.importKey(
        'raw',
        keyData,
        'HKDF',
        false,
        ['deriveBits', 'deriveKey']
    );

    // Derive auth key (for userId)
    const authKeyBits = await crypto.subtle.deriveBits(
        {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: new TextEncoder().encode('procura-sync-v1'),
            info: new TextEncoder().encode('auth'),
        },
        baseKey,
        256
    );
    const authKey = new Uint8Array(authKeyBits);

    // Derive encryption key as CryptoKey for AES-GCM
    const encryptKey = await crypto.subtle.deriveKey(
        {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: new TextEncoder().encode('procura-sync-v1'),
            info: new TextEncoder().encode('encrypt'),
        },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );

    // Hash auth key to get userId
    const userIdBytes = await crypto.subtle.digest('SHA-256', authKey);
    const userId = uint8ArrayToHex(new Uint8Array(userIdBytes));

    return { authKey, encryptKey, userId };
}

/**
 * Encrypt data with AES-256-GCM
 */
export async function encrypt(data: string, encryptKey: CryptoKey): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for GCM
    const encoded = new TextEncoder().encode(data);

    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        encryptKey,
        encoded
    );

    // Prepend IV to ciphertext
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);

    return uint8ArrayToBase64(combined);
}

/**
 * Decrypt data with AES-256-GCM
 */
export async function decrypt(encryptedBase64: string, encryptKey: CryptoKey): Promise<string> {
    const combined = base64ToUint8Array(encryptedBase64);

    // Extract IV (first 12 bytes) and ciphertext
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        encryptKey,
        ciphertext
    );

    return new TextDecoder().decode(decrypted);
}

// =============================================================================
// API Client
// =============================================================================

export class SyncClient {
    private serverUrl: string;
    private userId: string;
    private encryptKey: CryptoKey;
    private apiKey?: string;

    constructor(serverUrl: string, userId: string, encryptKey: CryptoKey, apiKey?: string) {
        this.serverUrl = serverUrl.replace(/\/$/, ''); // Remove trailing slash
        this.userId = userId;
        this.encryptKey = encryptKey;
        this.apiKey = apiKey;
    }

    /**
     * Get headers for requests (includes Authorization if apiKey is set)
     */
    private getHeaders(contentType?: string): Record<string, string> {
        const headers: Record<string, string> = {};
        if (contentType) {
            headers['Content-Type'] = contentType;
        }
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }
        return headers;
    }

    /**
     * Create a SyncClient from master key
     */
    static async create(config: SyncConfig): Promise<SyncClient> {
        const { userId, encryptKey } = await deriveKeys(config.masterKey);
        return new SyncClient(config.serverUrl, userId, encryptKey, config.apiKey);
    }

    /**
     * List all synced objects
     */
    async listObjects(): Promise<SyncObject[]> {
        const response = await fetch(`${this.serverUrl}/${this.userId}`, {
            headers: this.getHeaders(),
        });

        if (!response.ok) {
            throw new Error(`Sync failed: ${response.status}`);
        }

        const result = await response.json();
        return result.objects || [];
    }

    /**
     * Get a single object (decrypted)
     */
    async getObject<T>(objectId: string): Promise<T | null> {
        const response = await fetch(`${this.serverUrl}/${this.userId}/${objectId}`, {
            headers: this.getHeaders(),
        });

        if (response.status === 404) {
            return null;
        }

        if (!response.ok) {
            throw new Error(`Sync failed: ${response.status}`);
        }

        const result = await response.json();
        const decrypted = await decrypt(result.data, this.encryptKey);
        return JSON.parse(decrypted);
    }

    /**
     * Put a single object (encrypted)
     */
    async putObject(objectId: string, data: unknown, lastModified: number): Promise<void> {
        const json = JSON.stringify(data);
        const encrypted = await encrypt(json, this.encryptKey);

        const response = await fetch(`${this.serverUrl}/${this.userId}/${objectId}`, {
            method: 'PUT',
            headers: this.getHeaders('application/json'),
            body: JSON.stringify({ data: encrypted, lastModified }),
        });

        if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            throw new Error(result.error || `Sync failed: ${response.status}`);
        }
    }

}

// =============================================================================
// Utility Functions
// =============================================================================

function uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function uint8ArrayToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Format master key as recovery phrase (24 words would require BIP39 library)
 * For simplicity, we use URL-safe base64 with visual separation
 * 
 * Standard base64 uses: A-Z, a-z, 0-9, +, /, =
 * URL-safe base64 uses: A-Z, a-z, 0-9, -, _ (no padding)
 * We use ' ' (space) as group separator to avoid confusion with URL-safe '-'
 * The master key is exactly 44 chars which divides into 4 groups of 11 chars
 */
export function formatMasterKey(masterKeyBase64: string): string {
    // Convert to URL-safe base64 (no padding, - instead of +, _ instead of /)
    const urlSafe = masterKeyBase64
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');

    // Split into 4 groups of 11 chars for readability, separated by spaces
    // Example: "XXXXXXXXXXX XXXXXXXXXXX XXXXXXXXXXX XXXXXXXXXXX"
    return urlSafe.match(/.{1,11}/g)?.join(' ') || urlSafe;
}

/**
 * Parse formatted master key back to standard base64
 * 
 * Input format: "XXXXXXXXXXX XXXXXXXXXXX XXXXXXXXXXX XXXXXXXXXXX" (44 URL-safe chars with 3 space separators)
 * Output: standard base64 string
 */
export function parseMasterKey(formatted: string): string {
    const clean = formatted.replace(/ /g, '');

    // Convert URL-safe base64 back to standard base64
    return clean
        .replace(/-/g, '+')
        .replace(/_/g, '/');
}
