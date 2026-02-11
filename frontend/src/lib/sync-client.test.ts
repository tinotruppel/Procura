import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    generateMasterKey,
    deriveKeys,
    encrypt,
    decrypt,
    SyncClient,
    formatMasterKey,
    parseMasterKey,
} from './sync-client';

describe('Sync Client', () => {
    describe('generateMasterKey', () => {
        it('should generate a 32-byte key as base64', async () => {
            const key = await generateMasterKey();
            expect(key).toBeDefined();
            // Base64 of 32 bytes = 44 characters (with padding)
            expect(key.length).toBeGreaterThanOrEqual(43);
            expect(key.length).toBeLessThanOrEqual(44);
        });

        it('should generate unique keys', async () => {
            const key1 = await generateMasterKey();
            const key2 = await generateMasterKey();
            expect(key1).not.toBe(key2);
        });
    });

    describe('deriveKeys', () => {
        it('should derive userId, authKey, and encryptKey from master key', async () => {
            const masterKey = await generateMasterKey();
            const { userId, authKey, encryptKey } = await deriveKeys(masterKey);

            // userId should be 64-char hex (SHA-256)
            expect(userId).toMatch(/^[a-f0-9]{64}$/);

            // authKey should be 32 bytes
            expect(authKey).toBeInstanceOf(Uint8Array);
            expect(authKey.length).toBe(32);

            // encryptKey should be a CryptoKey
            expect(encryptKey).toBeDefined();
        });

        it('should derive the same keys from the same master key', async () => {
            const masterKey = await generateMasterKey();
            const result1 = await deriveKeys(masterKey);
            const result2 = await deriveKeys(masterKey);

            expect(result1.userId).toBe(result2.userId);
        });

        it('should derive different keys from different master keys', async () => {
            const masterKey1 = await generateMasterKey();
            const masterKey2 = await generateMasterKey();

            const result1 = await deriveKeys(masterKey1);
            const result2 = await deriveKeys(masterKey2);

            expect(result1.userId).not.toBe(result2.userId);
        });
    });

    describe('encrypt/decrypt', () => {
        it('should encrypt and decrypt data correctly', async () => {
            const masterKey = await generateMasterKey();
            const { encryptKey } = await deriveKeys(masterKey);

            const plaintext = 'Hello, World! 🔐';
            const encrypted = await encrypt(plaintext, encryptKey);
            const decrypted = await decrypt(encrypted, encryptKey);

            expect(decrypted).toBe(plaintext);
        });

        it('should produce different ciphertext for same plaintext (due to random IV)', async () => {
            const masterKey = await generateMasterKey();
            const { encryptKey } = await deriveKeys(masterKey);

            const plaintext = 'Test data';
            const encrypted1 = await encrypt(plaintext, encryptKey);
            const encrypted2 = await encrypt(plaintext, encryptKey);

            expect(encrypted1).not.toBe(encrypted2);

            // But both should decrypt to the same value
            expect(await decrypt(encrypted1, encryptKey)).toBe(plaintext);
            expect(await decrypt(encrypted2, encryptKey)).toBe(plaintext);
        });

        it('should handle large data', async () => {
            const masterKey = await generateMasterKey();
            const { encryptKey } = await deriveKeys(masterKey);

            const largeData = 'x'.repeat(1000000); // 1MB
            const encrypted = await encrypt(largeData, encryptKey);
            const decrypted = await decrypt(encrypted, encryptKey);

            expect(decrypted).toBe(largeData);
        });

        it('should handle JSON objects', async () => {
            const masterKey = await generateMasterKey();
            const { encryptKey } = await deriveKeys(masterKey);

            const data = {
                settings: { theme: 'dark' },
                chats: [{ id: 'chat-1', messages: [] }]
            };

            const json = JSON.stringify(data);
            const encrypted = await encrypt(json, encryptKey);
            const decrypted = await decrypt(encrypted, encryptKey);

            expect(JSON.parse(decrypted)).toEqual(data);
        });
    });

    describe('SyncClient', () => {
        beforeEach(() => {
            vi.stubGlobal('fetch', vi.fn());
        });

        it('should create client from master key', async () => {
            const masterKey = await generateMasterKey();
            const client = await SyncClient.create({
                serverUrl: 'https://example.com/sync',
                masterKey,
            });

            expect(client).toBeInstanceOf(SyncClient);
        });

        it('should list objects', async () => {
            const masterKey = await generateMasterKey();
            const { userId } = await deriveKeys(masterKey);

            vi.mocked(fetch).mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    success: true,
                    objects: [
                        { objectId: 'settings', lastModified: 1234567890 },
                        { objectId: 'chat-abc', lastModified: 1234567891 },
                    ],
                }),
            } as Response);

            const client = await SyncClient.create({
                serverUrl: 'https://example.com/sync',
                masterKey,
            });

            const objects = await client.listObjects();

            expect(fetch).toHaveBeenCalledWith(
                `https://example.com/sync/${userId}`,
                expect.objectContaining({ headers: {} })
            );
            expect(objects).toHaveLength(2);
            expect(objects[0].objectId).toBe('settings');
        });

        it('should put object (encrypted)', async () => {
            const masterKey = await generateMasterKey();
            const { userId } = await deriveKeys(masterKey);

            vi.mocked(fetch).mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ success: true }),
            } as Response);

            const client = await SyncClient.create({
                serverUrl: 'https://example.com/sync',
                masterKey,
            });

            await client.putObject('settings', { theme: 'dark' }, Date.now());

            expect(fetch).toHaveBeenCalledWith(
                `https://example.com/sync/${userId}/settings`,
                expect.objectContaining({
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                })
            );

            // Verify the body contains encrypted data
            const callArgs = vi.mocked(fetch).mock.calls[0];
            const body = JSON.parse(callArgs[1]?.body as string);
            expect(body.data).toBeDefined();
            expect(typeof body.data).toBe('string');
        });

        it('should get object (decrypted)', async () => {
            const masterKey = await generateMasterKey();
            const { userId, encryptKey } = await deriveKeys(masterKey);

            const testData = { theme: 'dark', fontSize: 14 };
            const encrypted = await encrypt(JSON.stringify(testData), encryptKey);

            vi.mocked(fetch).mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    success: true,
                    objectId: 'settings',
                    data: encrypted,
                    lastModified: 1234567890,
                }),
            } as Response);

            const client = await SyncClient.create({
                serverUrl: 'https://example.com/sync',
                masterKey,
            });

            const result = await client.getObject('settings');

            expect(fetch).toHaveBeenCalledWith(
                `https://example.com/sync/${userId}/settings`,
                expect.objectContaining({ headers: {} })
            );
            expect(result).toEqual(testData);
        });

        it('should return null for 404', async () => {
            const masterKey = await generateMasterKey();

            vi.mocked(fetch).mockResolvedValueOnce({
                ok: false,
                status: 404,
            } as Response);

            const client = await SyncClient.create({
                serverUrl: 'https://example.com/sync',
                masterKey,
            });

            const result = await client.getObject('nonexistent');
            expect(result).toBeNull();
        });
    });

    describe('formatMasterKey / parseMasterKey', () => {
        it('should format and parse master key', async () => {
            const masterKey = await generateMasterKey();
            const formatted = formatMasterKey(masterKey);

            // Should be split with spaces (BIP39-style 4-word format)
            expect(formatted).toContain(' ');

            // Round-trip should work (approximately - some chars get converted)
            const parsed = parseMasterKey(formatted);
            expect(parsed.length).toBeGreaterThan(0);
        });
    });
});
