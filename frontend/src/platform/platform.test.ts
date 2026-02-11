/**
 * Platform abstraction layer tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock chrome APIs before importing platform module
const chromeMock = {
    storage: {
        local: {
            get: vi.fn(),
            set: vi.fn(),
            remove: vi.fn(),
            clear: vi.fn(),
            getBytesInUse: vi.fn(),
        },
    },
    tabs: {
        create: vi.fn(),
        query: vi.fn(),
    },
    notifications: {
        create: vi.fn(),
    },
    runtime: {
        id: 'mock-extension-id',
    },
};

vi.stubGlobal('chrome', chromeMock);

describe('Platform Abstraction', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Chrome Platform', () => {
        it('should export chromePlatform with correct name', async () => {
            const { chromePlatform } = await import('@/platform/chrome');
            expect(chromePlatform.name).toBe('chrome');
        });

        it('should have storage methods', async () => {
            const { chromePlatform } = await import('@/platform/chrome');
            expect(chromePlatform.storage).toBeDefined();
            expect(typeof chromePlatform.storage.get).toBe('function');
            expect(typeof chromePlatform.storage.set).toBe('function');
            expect(typeof chromePlatform.storage.remove).toBe('function');
            expect(typeof chromePlatform.storage.clear).toBe('function');
        });

        it('should have tabs methods', async () => {
            const { chromePlatform } = await import('@/platform/chrome');
            expect(chromePlatform.tabs).toBeDefined();
            expect(typeof chromePlatform.tabs.create).toBe('function');
        });

        it('should have hasCapability method', async () => {
            const { chromePlatform } = await import('@/platform/chrome');
            expect(typeof chromePlatform.hasCapability).toBe('function');
        });

        describe('storage.get', () => {
            it('should call chrome.storage.local.get with keys', async () => {
                const { chromePlatform } = await import('@/platform/chrome');
                chromeMock.storage.local.get.mockImplementation((keys, cb) => {
                    cb({ testKey: 'testValue' });
                });

                const result = await chromePlatform.storage.get(['testKey']);
                expect(result).toEqual({ testKey: 'testValue' });
                expect(chromeMock.storage.local.get).toHaveBeenCalled();
            });

            it('should handle string key', async () => {
                const { chromePlatform } = await import('@/platform/chrome');
                chromeMock.storage.local.get.mockImplementation((keys, cb) => {
                    cb({ singleKey: 'value' });
                });

                const result = await chromePlatform.storage.get('singleKey');
                expect(result).toEqual({ singleKey: 'value' });
            });
        });

        describe('storage.set', () => {
            it('should call chrome.storage.local.set', async () => {
                const { chromePlatform } = await import('@/platform/chrome');
                chromeMock.storage.local.set.mockImplementation((items, cb) => {
                    cb?.();
                });

                await chromePlatform.storage.set({ key: 'value' });
                expect(chromeMock.storage.local.set).toHaveBeenCalled();
            });
        });

        describe('storage.remove', () => {
            it('should call chrome.storage.local.remove', async () => {
                const { chromePlatform } = await import('@/platform/chrome');
                chromeMock.storage.local.remove.mockImplementation((keys, cb) => {
                    cb?.();
                });

                await chromePlatform.storage.remove(['key']);
                expect(chromeMock.storage.local.remove).toHaveBeenCalled();
            });
        });

        describe('storage.clear', () => {
            it('should call chrome.storage.local.clear', async () => {
                const { chromePlatform } = await import('@/platform/chrome');
                chromeMock.storage.local.clear.mockImplementation((cb) => {
                    cb?.();
                });

                await chromePlatform.storage.clear();
                expect(chromeMock.storage.local.clear).toHaveBeenCalled();
            });
        });

        describe('storage.getBytesInUse', () => {
            it('should return bytes in use', async () => {
                const { chromePlatform } = await import('@/platform/chrome');
                chromeMock.storage.local.getBytesInUse.mockImplementation((keys, cb) => {
                    cb(1024);
                });

                const bytes = await chromePlatform.storage.getBytesInUse();
                expect(bytes).toBe(1024);
            });
        });

        describe('tabs.create', () => {
            it('should call chrome.tabs.create', async () => {
                const { chromePlatform } = await import('@/platform/chrome');
                chromeMock.tabs.create.mockResolvedValue({ id: 123 });

                await chromePlatform.tabs.create('https://example.com');
                expect(chromeMock.tabs.create).toHaveBeenCalledWith({ url: 'https://example.com' });
            });
        });

        describe('hasCapability', () => {
            it('should return true for supported capabilities', async () => {
                const { chromePlatform } = await import('@/platform/chrome');
                expect(chromePlatform.hasCapability('screenshot')).toBe(true);
                expect(chromePlatform.hasCapability('notifications')).toBe(true);
            });
        });
    });

    describe('Web Platform', () => {
        it('should export webPlatform with correct name', async () => {
            const { webPlatform } = await import('@/platform/web');
            expect(webPlatform.name).toBe('web');
        });

        it('should have storage methods', async () => {
            const { webPlatform } = await import('@/platform/web');
            expect(webPlatform.storage).toBeDefined();
            expect(typeof webPlatform.storage.get).toBe('function');
            expect(typeof webPlatform.storage.set).toBe('function');
            expect(typeof webPlatform.storage.remove).toBe('function');
            expect(typeof webPlatform.storage.clear).toBe('function');
        });

        it('should have tabs methods', async () => {
            const { webPlatform } = await import('@/platform/web');
            expect(webPlatform.tabs).toBeDefined();
            expect(typeof webPlatform.tabs.create).toBe('function');
        });

        it('should have hasCapability method', async () => {
            const { webPlatform } = await import('@/platform/web');
            expect(typeof webPlatform.hasCapability).toBe('function');
        });

        describe('hasCapability', () => {
            it('should return false for extension-only capabilities', async () => {
                const { webPlatform } = await import('@/platform/web');
                // Web platform doesn't support any extension capabilities
                expect(webPlatform.hasCapability('screenshot')).toBe(false);
                expect(webPlatform.hasCapability('content-injection')).toBe(false);
            });
        });
    });

    describe('Platform Detection', () => {
        it('should export isExtension function', async () => {
            const { isExtension } = await import('@/platform/index');
            expect(typeof isExtension).toBe('function');
        });

        it('should export isWeb function', async () => {
            const { isWeb } = await import('@/platform/index');
            expect(typeof isWeb).toBe('function');
        });

        it('should export platform instance', async () => {
            const { platform } = await import('@/platform/index');
            expect(platform).toBeDefined();
            expect(platform.name).toBeDefined();
        });

        it('should detect chrome extension when chrome.runtime.id exists', async () => {
            const { isExtension } = await import('@/platform/index');
            // chrome.runtime.id is mocked above
            expect(isExtension()).toBe(true);
        });
    });

    describe('Type exports', () => {
        it('should export type module without errors', async () => {
            const types = await import('@/platform/types');
            expect(types).toBeDefined();
            expect(types.PLATFORM_CAPABILITIES).toBeDefined();
        });
    });
});
