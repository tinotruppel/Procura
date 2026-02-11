#!/usr/bin/env node
/**
 * Test vault decryption of an exported config.
 * Replicates the browser's decryptWithExternalVaultParams logic.
 *
 * Usage: node decrypt-vault-export.mjs <config.json>
 *
 * Reads PROCURA_SECURITY_KEY from .env in the same directory.
 */

import { readFileSync, existsSync } from 'fs';
import { webcrypto } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const crypto = webcrypto;
const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env
function loadEnv() {
    const envPath = join(__dirname, '.env');
    if (!existsSync(envPath)) {
        console.error('No .env file found in', __dirname);
        process.exit(1);
    }
    const content = readFileSync(envPath, 'utf8');
    const env = {};
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const match = trimmed.match(/^([^=]+)\s*=\s*"?([^"]*)"?$/);
        if (match) env[match[1].trim()] = match[2].trim();
    }
    return env;
}

// Normalize vault key: strip whitespace, convert base64url to base64
function normalizeVaultKey(input) {
    const cleaned = input.trim().replace(/\s+/g, '');
    return cleaned.replace(/-/g, '+').replace(/_/g, '/');
}

function base64ToUint8Array(base64) {
    return new Uint8Array(Buffer.from(base64, 'base64'));
}

function toArrayBuffer(uint8) {
    return uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength);
}

// Derive base key bytes via PBKDF2
async function deriveBaseKeyBytes(vaultKeyBase64, salt, iterations) {
    const vaultKeyBytes = base64ToUint8Array(vaultKeyBase64);
    const keyMaterial = await crypto.subtle.importKey(
        'raw', toArrayBuffer(vaultKeyBytes), 'PBKDF2', false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt: toArrayBuffer(salt), iterations },
        keyMaterial, 256
    );
    return new Uint8Array(bits);
}

// Hash base key via SHA-256
async function hashBaseKey(baseKey) {
    const hash = await crypto.subtle.digest('SHA-256', toArrayBuffer(baseKey));
    return Buffer.from(hash).toString('base64');
}

// Derive local encryption key via HKDF
async function deriveLocalKey(baseKey) {
    const hkdfKey = await crypto.subtle.importKey(
        'raw', toArrayBuffer(baseKey), 'HKDF', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: new TextEncoder().encode('procura-vault-v1'),
            info: new TextEncoder().encode('local-encrypt'),
        },
        hkdfKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

async function main() {
    const args = process.argv.slice(2);
    const configFile = args[0] || join(__dirname, 'procura-config-2026-02-11.json');

    const env = loadEnv();
    const vaultKeyRaw = env.PROCURA_SECURITY_KEY;
    if (!vaultKeyRaw) {
        console.error('PROCURA_SECURITY_KEY not found in .env');
        console.error('Add: PROCURA_SECURITY_KEY=<your-44-char-vault-key>');
        process.exit(1);
    }

    if (!existsSync(configFile)) {
        console.error('Config file not found:', configFile);
        process.exit(1);
    }

    const config = JSON.parse(readFileSync(configFile, 'utf8'));
    const enc = config.encryptedSecrets;
    if (!enc) {
        console.error('No encryptedSecrets in config');
        process.exit(1);
    }

    console.log('Config version:', config.version);
    console.log('Vault key hash from export:', enc.vaultKeyHash);
    console.log('Salt from export:', enc.vaultMeta?.saltBase64);
    console.log('Iterations:', enc.vaultMeta?.iterations);
    console.log('Payload length:', enc.payload.length, 'chars');
    console.log();

    const normalized = normalizeVaultKey(vaultKeyRaw);
    console.log('Normalized key (first 10):', normalized.slice(0, 10) + '...');
    console.log('Normalized key length:', normalized.length);

    const salt = base64ToUint8Array(enc.vaultMeta.saltBase64);
    const iterations = enc.vaultMeta.iterations;

    console.log('\n--- Step 1: Derive base key (PBKDF2) ---');
    const baseKey = await deriveBaseKeyBytes(normalized, salt, iterations);
    console.log('Base key derived, length:', baseKey.length, 'bytes');

    console.log('\n--- Step 2: Hash check ---');
    const keyHashBase64 = await hashBaseKey(baseKey);
    console.log('Computed hash:', keyHashBase64);
    console.log('Export hash:  ', enc.vaultKeyHash);
    console.log('Match:', keyHashBase64 === enc.vaultKeyHash ? '✅ YES' : '❌ NO');

    if (keyHashBase64 !== enc.vaultKeyHash) {
        console.error('\n❌ Key hash does not match — wrong vault key!');
        process.exit(1);
    }

    console.log('\n--- Step 3: Derive local key (HKDF) ---');
    const localKey = await deriveLocalKey(baseKey);
    console.log('Local key derived');

    console.log('\n--- Step 4: Decrypt (AES-GCM) ---');
    const combined = base64ToUint8Array(enc.payload);
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    console.log('IV length:', iv.length);
    console.log('Ciphertext length:', ciphertext.length);

    try {
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv }, localKey, ciphertext
        );
        const json = new TextDecoder().decode(decrypted);
        console.log('\n✅ Decryption successful!\n');
        console.log('=== DECRYPTED SECRETS ===\n');
        const parsed = JSON.parse(json);
        // Redact actual API keys for safety
        const redacted = { ...parsed };
        if (redacted.apiKeys) {
            for (const [k, v] of Object.entries(redacted.apiKeys)) {
                if (v) redacted.apiKeys[k] = v.slice(0, 8) + '...(redacted)';
            }
        }
        console.log(JSON.stringify(redacted, null, 2));
    } catch (err) {
        console.error('\n❌ Decryption failed:', err.name, err.message);
        console.error('This means the key matched (hash verified) but decryption still failed.');
        console.error('Possible cause: corrupted payload or incompatible encryption parameters.');
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
