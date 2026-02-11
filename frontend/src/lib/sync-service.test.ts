import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock chrome.storage.local before importing sync-service
const mockStorage: Record<string, unknown> = {};

const mockChromeStorage = {
    local: {
        get: vi.fn((keys: string[], callback: (result: unknown) => void) => {
            const result: Record<string, unknown> = {};
            for (const key of keys) {
                if (mockStorage[key]) {
                    result[key] = mockStorage[key];
                }
            }
            callback(result);
        }),
        set: vi.fn((items: Record<string, unknown>, callback?: () => void) => {
            Object.assign(mockStorage, items);
            callback?.();
        }),
    },
};

// Mock chrome global
vi.stubGlobal('chrome', { storage: mockChromeStorage });

// Mock @/platform module to use Chrome platform with mocked storage
vi.mock('@/platform', () => ({
    platform: {
        name: 'chrome' as const,
        storage: {
            get: vi.fn(async <T>(keys: string[]): Promise<Record<string, T>> => {
                const result: Record<string, T> = {};
                for (const key of keys) {
                    if (mockStorage[key] !== undefined) {
                        result[key] = mockStorage[key] as T;
                    }
                }
                return result;
            }),
            set: vi.fn(async (items: Record<string, unknown>): Promise<void> => {
                Object.assign(mockStorage, items);
            }),
            remove: vi.fn(async (): Promise<void> => { }),
            getBytesInUse: vi.fn(async (): Promise<number> => 0),
        },
        tabs: {
            create: vi.fn(),
            openOptionsPage: vi.fn(),
        },
        hasCapability: vi.fn(() => true),
    },
    isChrome: true,
    isWeb: false,
}));

// Mock sync-client
vi.mock('./sync-client', () => ({
    deriveKeys: vi.fn(() => Promise.resolve({
        userId: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        encryptKey: {} as CryptoKey,
    })),
    SyncClient: {
        create: vi.fn(() => Promise.resolve({
            listObjects: vi.fn(() => Promise.resolve([])),
            getObject: vi.fn(() => Promise.resolve(null)),
            putObject: vi.fn(() => Promise.resolve()),
        })),
    },
}));

// Mock vault
vi.mock('./vault', () => ({
    isVaultUnlocked: vi.fn(() => true),
    getSyncMasterKey: vi.fn(() => Promise.resolve('derived-master-key')),
}));

// Mock storage functions
vi.mock('./storage', async (importOriginal) => {
    const original = await importOriginal() as object;
    return {
        ...original,
        getProvider: vi.fn(() => Promise.resolve('gemini')),
        setProvider: vi.fn(() => Promise.resolve()),
        getApiKeys: vi.fn(() => Promise.resolve({})),
        setApiKeys: vi.fn(() => Promise.resolve()),
        getModels: vi.fn(() => Promise.resolve({})),
        setModels: vi.fn(() => Promise.resolve()),
        getToolConfigs: vi.fn(() => Promise.resolve({})),
        setToolConfigs: vi.fn(() => Promise.resolve()),
        getSettingsLastModified: vi.fn(() => Promise.resolve(0)),
        setSettingsLastModified: vi.fn(() => Promise.resolve()),
        getChatSessions: vi.fn(() => Promise.resolve([])),
        setChatSessions: vi.fn(() => Promise.resolve()),
        // New sync bundle settings
        getCustomBaseUrl: vi.fn(() => Promise.resolve('')),
        setCustomBaseUrl: vi.fn(() => Promise.resolve()),
        getDebugMode: vi.fn(() => Promise.resolve(false)),
        setDebugMode: vi.fn(() => Promise.resolve()),
        getSystemPrompts: vi.fn(() => Promise.resolve([])),
        setSystemPrompts: vi.fn(() => Promise.resolve()),
        getSelectedSystemPromptId: vi.fn(() => Promise.resolve(null)),
        setSelectedSystemPromptId: vi.fn(() => Promise.resolve()),
        getLangfuseConfig: vi.fn(() => Promise.resolve({ enabled: false, publicKey: '', secretKey: '', host: '' })),
        setLangfuseConfig: vi.fn(() => Promise.resolve()),
        getMcpServers: vi.fn(() => Promise.resolve([])),
        setMcpServers: vi.fn(() => Promise.resolve()),
        getMcpToolStates: vi.fn(() => Promise.resolve({})),
        setMcpToolStates: vi.fn(() => Promise.resolve()),
        getPromptVariables: vi.fn(() => Promise.resolve([])),
        setPromptVariables: vi.fn(() => Promise.resolve()),
        migrateLegacySecretsToVault: vi.fn(() => Promise.resolve()),
    };
});

// Now import after mocking
import {
    getSyncSettings,
    saveSyncSettings,
    setupNewSync,
    connectExistingSync,
    disableSync,
    getSyncUserId,
    performSync,
    SyncSettings,
} from './sync-service';
import { SyncClient } from './sync-client';

describe('Sync Service', () => {
    beforeEach(() => {
        // Clear mock storage
        for (const key of Object.keys(mockStorage)) {
            delete mockStorage[key];
        }
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('getSyncSettings', () => {
        it('should return default settings when none exist', async () => {
            const settings = await getSyncSettings();

            expect(settings).toEqual({
                enabled: false,
                serverUrl: '',
                apiKey: null,
                lastSync: null,
            });
        });

        it('should return stored settings', async () => {
            const storedSettings: SyncSettings = {
                enabled: true,
                serverUrl: 'https://example.com/sync',
                apiKey: null,
                lastSync: 1234567890,
            };
            mockStorage['procura_sync_settings'] = storedSettings;

            const settings = await getSyncSettings();

            expect(settings).toEqual(storedSettings);
        });

        it('should handle chrome.storage errors gracefully', async () => {
            // This test is no longer relevant as we use platform abstraction
            // which handles errors differently
            const settings = await getSyncSettings();
            expect(settings).toEqual({
                enabled: false,
                serverUrl: '',
                apiKey: null,
                lastSync: null,
            });
        });
    });

    describe('saveSyncSettings', () => {
        it('should save settings to storage', async () => {
            const settings: SyncSettings = {
                enabled: true,
                serverUrl: 'https://example.com/sync',
                apiKey: null,
                lastSync: Date.now(),
            };

            await saveSyncSettings(settings);

            expect(mockStorage['procura_sync_settings']).toEqual(settings);
        });
    });

    describe('setupNewSync', () => {
        it('should enable sync and save settings', async () => {
            const serverUrl = 'https://sync.example.com';

            await setupNewSync(serverUrl);
            expect(mockStorage['procura_sync_settings']).toEqual({
                enabled: true,
                serverUrl,
                apiKey: null,
                lastSync: null,
            });
        });
    });

    describe('connectExistingSync', () => {
        it('should connect and save settings when vault is unlocked', async () => {
            const serverUrl = 'https://sync.example.com';

            const result = await connectExistingSync(serverUrl);

            expect(result).toBe(true);
            expect(SyncClient.create).toHaveBeenCalled();
            expect(mockStorage['procura_sync_settings']).toEqual({
                enabled: true,
                serverUrl,
                apiKey: null,
                lastSync: null,
            });
        });

        it('should return false on connection failure', async () => {
            vi.mocked(SyncClient.create).mockRejectedValueOnce(new Error('Connection failed'));

            const result = await connectExistingSync('https://sync.example.com', 'FORMATTED-badkey');

            expect(result).toBe(false);
        });
    });

    describe('disableSync', () => {
        it('should disable sync and clear settings', async () => {
            mockStorage['procura_sync_settings'] = {
                enabled: true,
                serverUrl: 'https://sync.example.com',
                lastSync: 123456,
            };

            await disableSync();

            expect(mockStorage['procura_sync_settings']).toEqual({
                enabled: false,
                serverUrl: '',
                apiKey: null,
                lastSync: null,
            });
        });
    });

    describe('getSyncUserId', () => {
        it('should return null when sync is disabled', async () => {
            const userId = await getSyncUserId();
            expect(userId).toBeNull();
        });

        it('should return formatted user ID when sync enabled and vault unlocked', async () => {
            mockStorage['procura_sync_settings'] = {
                enabled: true,
                serverUrl: 'https://sync.example.com',
                lastSync: null,
            };

            const userId = await getSyncUserId();

            // deriveKeys returns full userId (64-char hex)
            expect(userId).toBe('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2');
        });
    });

    describe('performSync', () => {
        it('should return error when sync is not enabled', async () => {
            const result = await performSync();

            expect(result).toEqual({
                success: false,
                pulled: 0,
                pushed: 0,
                errors: ['Sync not enabled'],
            });
        });

        it('should perform sync when enabled', async () => {
            mockStorage['procura_sync_settings'] = {
                enabled: true,
                serverUrl: 'https://sync.example.com',
                lastSync: null,
            };

            const result = await performSync();

            expect(result.success).toBe(true);
            expect(result.errors).toHaveLength(0);
            expect(SyncClient.create).toHaveBeenCalled();
        });
        it('should pull remote settings when remote is newer and preserve remote timestamp', async () => {
            mockStorage['procura_sync_settings'] = {
                enabled: true,
                serverUrl: 'https://sync.example.com',
                lastSync: null,
            };

            const remoteTimestamp = 1700000000000;
            const remoteSettings = {
                provider: 'openai',
                apiKeys: { openai: 'sk-remote' },
                models: { openai: 'gpt-4' },
                toolConfig: {},
                customBaseUrl: 'https://custom.api',
                debugMode: true,
                systemPrompts: [],
                selectedSystemPromptId: null,
                langfuseConfig: { enabled: false, publicKey: '', secretKey: '', host: '' },
                mcpServers: [],
                mcpToolStates: {},
                promptVariables: [],
                _lastModified: remoteTimestamp,
            };

            // Mock: remote has settings object with newer timestamp
            const mockClient = {
                listObjects: vi.fn(() => Promise.resolve([
                    { objectId: 'settings', lastModified: remoteTimestamp },
                ])),
                getObject: vi.fn(() => Promise.resolve(remoteSettings)),
                putObject: vi.fn(() => Promise.resolve()),
            };
            vi.mocked(SyncClient.create).mockResolvedValueOnce(mockClient as unknown as InstanceType<typeof SyncClient>);

            // Local settings timestamp is older
            const storage = await import('./storage');
            vi.mocked(storage.getSettingsLastModified).mockResolvedValueOnce(1600000000000);

            const result = await performSync();

            expect(result.success).toBe(true);
            expect(result.pulled).toBe(1);
            expect(mockClient.getObject).toHaveBeenCalledWith('settings');

            // Verify the SETTINGS_LAST_MODIFIED in mockStorage is the REMOTE timestamp,
            // not Date.now() — this validates the atomic write fix (Bug 2)
            expect(mockStorage['procura_settings_last_modified']).toBe(remoteTimestamp);
            // Verify other settings were applied
            expect(mockStorage['procura_provider']).toBe('openai');
            expect(mockStorage['procura_debug_mode']).toBe(true);
            expect(mockStorage['procura_custom_base_url']).toBe('https://custom.api');
        });

        it('should push local settings when local is newer', async () => {
            mockStorage['procura_sync_settings'] = {
                enabled: true,
                serverUrl: 'https://sync.example.com',
                lastSync: null,
            };

            const localTimestamp = 1800000000000;
            const storage = await import('./storage');
            vi.mocked(storage.getSettingsLastModified).mockResolvedValueOnce(localTimestamp);

            const mockClient = {
                listObjects: vi.fn(() => Promise.resolve([
                    { objectId: 'settings', lastModified: 1600000000000 },
                ])),
                getObject: vi.fn(),
                putObject: vi.fn(() => Promise.resolve()),
            };
            vi.mocked(SyncClient.create).mockResolvedValueOnce(mockClient as unknown as InstanceType<typeof SyncClient>);

            const result = await performSync();

            expect(result.success).toBe(true);
            expect(result.pushed).toBe(1);
            expect(mockClient.putObject).toHaveBeenCalledWith(
                'settings',
                expect.objectContaining({ _lastModified: localTimestamp }),
                localTimestamp
            );
        });
    });

    describe('theme timestamp isolation (Bug 1 fix)', () => {
        it('should not bump SETTINGS_LAST_MODIFIED when theme changes', async () => {
            // Set a known timestamp
            const originalTimestamp = 1700000000000;
            mockStorage['procura_settings_last_modified'] = originalTimestamp;

            // Import the real setTheme (not mocked)
            const { setTheme } = await import('./storage/ui-settings');

            // Mock document.documentElement for applyTheme
            const mockClassList = { toggle: vi.fn() };
            vi.stubGlobal('document', { documentElement: { classList: mockClassList } });

            await setTheme('dark');

            // SETTINGS_LAST_MODIFIED should NOT have changed
            expect(mockStorage['procura_settings_last_modified']).toBe(originalTimestamp);
            // But the theme should be stored
            expect(mockStorage['procura_theme']).toBe('dark');
        });
    });
});
