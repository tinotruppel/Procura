/**
 * Vault Cryptography Utilities
 *
 * Provides AES-256-GCM encryption/decryption using the client's API Key
 * as the master key. The API Key is never stored on the server — it arrives
 * per-request in the X-API-Key header.
 *
 * Key derivation: PBKDF2(api_key, random_salt) → 256-bit AES key
 * Encryption:     AES-256-GCM with random IV
 * Identity:       SHA-256(api_key) → hex string (= key_id)
 */

import { createHash, randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv } from "crypto";

const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12;  // AES-GCM recommended
const SALT_LENGTH = 16;
const _TAG_LENGTH = 16; // 128-bit auth tag (used implicitly by AES-GCM)

/**
 * Derive a 256-bit AES key from the API key using PBKDF2.
 */
function deriveKey(apiKey: string, salt: Buffer): Buffer {
    return pbkdf2Sync(apiKey, salt, PBKDF2_ITERATIONS, KEY_LENGTH, "sha256");
}

export interface EncryptedPayload {
    salt: Buffer;
    iv: Buffer;
    tag: Buffer;
    ciphertext: Buffer;
}

/**
 * Encrypt a plaintext secret using the API key.
 * Returns salt, IV, auth tag, and ciphertext — all needed for decryption.
 */
export function encryptSecret(apiKey: string, plaintext: string): EncryptedPayload {
    const salt = randomBytes(SALT_LENGTH);
    const iv = randomBytes(IV_LENGTH);
    const key = deriveKey(apiKey, salt);

    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return { salt, iv, tag, ciphertext: encrypted };
}

/**
 * Decrypt a secret using the API key and the stored crypto parameters.
 * Throws if the key is wrong or data has been tampered with.
 */
export function decryptSecret(apiKey: string, payload: EncryptedPayload): string {
    const key = deriveKey(apiKey, payload.salt);

    const decipher = createDecipheriv("aes-256-gcm", key, payload.iv);
    decipher.setAuthTag(payload.tag);

    const decrypted = Buffer.concat([
        decipher.update(payload.ciphertext),
        decipher.final(),
    ]);

    return decrypted.toString("utf8");
}

/**
 * Compute the key_id from an API key: SHA-256 → hex string (64 chars).
 * This is the user identity stored in all DB tables.
 */
export function hashApiKey(apiKey: string): string {
    return createHash("sha256").update(apiKey).digest("hex");
}
