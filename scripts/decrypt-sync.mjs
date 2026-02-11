#!/usr/bin/env node
/**
 * Decrypt sync data using the master key
 * 
 * Usage: node decrypt-sync.mjs [encrypted-data-file]
 * 
 * Reads PROCURA_SYNC_KEY from .env file in the same directory
 */

import { readFileSync, existsSync } from 'fs';
import { webcrypto } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const crypto = webcrypto;
const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env file
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
        if (match) {
            env[match[1].trim()] = match[2].trim();
        }
    }

    return env;
}

// Derive encryption key from master key using HKDF
async function deriveEncryptKey(masterKeyBase64) {
    const masterKeyBinary = Buffer.from(masterKeyBase64, 'base64');
    console.log('Master key bytes:', masterKeyBinary.length);

    const baseKey = await crypto.subtle.importKey(
        'raw',
        masterKeyBinary,
        'HKDF',
        false,
        ['deriveBits', 'deriveKey']
    );

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

    return encryptKey;
}

// Decrypt with AES-256-GCM (IV is prepended to ciphertext)
async function decrypt(encryptedData, encryptKey) {
    const combined = encryptedData;

    // Extract IV (first 12 bytes) and ciphertext
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    console.log('IV length:', iv.length);
    console.log('Ciphertext length:', ciphertext.length);

    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        encryptKey,
        ciphertext
    );

    return new TextDecoder().decode(decrypted);
}

async function main() {
    const args = process.argv.slice(2);
    const dataFile = args[0] || join(__dirname, '..', 'sync_objects-encrypted_blob.bin');

    // Load keys from .env
    const env = loadEnv();
    const formattedKey = env.PROCURA_SYNC_KEY;

    if (!formattedKey) {
        console.error('PROCURA_SYNC_KEY not found in .env');
        process.exit(1);
    }

    console.log('Using key from .env:', formattedKey.slice(0, 10) + '...');
    console.log('Data file:', dataFile);

    if (!existsSync(dataFile)) {
        console.error('Data file not found:', dataFile);
        process.exit(1);
    }

    // Read encrypted data
    const encryptedData = readFileSync(dataFile);
    console.log('Encrypted data size:', encryptedData.length, 'bytes');

    try {
        // Parse key: remove hyphens, take first 44 chars as base64url
        const cleaned = formattedKey.replace(/-/g, '');
        console.log('Cleaned key length:', cleaned.length);

        // Base64url to base64
        let base64 = cleaned.slice(0, 44).replace(/_/g, '/').replace(/-/g, '+');
        while (base64.length % 4 !== 0) {
            base64 += '=';
        }

        const encryptKey = await deriveEncryptKey(base64);
        console.log('Derived encryption key successfully\n');

        const decrypted = await decrypt(encryptedData, encryptKey);

        console.log('=== DECRYPTED DATA ===\n');

        // Pretty print JSON
        try {
            const json = JSON.parse(decrypted);
            console.log(JSON.stringify(json, null, 2));
        } catch {
            console.log(decrypted);
        }
    } catch (err) {
        console.error('Decryption failed:', err.message);
        console.error(err.stack);
    }
}

main();
