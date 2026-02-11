/**
 * Chrome Extension Platform Implementation
 * 
 * Implements the Platform interface using Chrome Extension APIs.
 */

import {
    Platform,
    PlatformStorage,
    PlatformTabs,
    PlatformNotifications,
    PlatformCapability,
    PLATFORM_CAPABILITIES
} from './types';

/**
 * Chrome Storage implementation using chrome.storage.local
 */
const chromeStorage: PlatformStorage = {
    async get<T = unknown>(keys: string | string[]): Promise<Record<string, T>> {
        return new Promise((resolve) => {
            chrome.storage.local.get(keys, (result) => {
                resolve(result as Record<string, T>);
            });
        });
    },

    async set(items: Record<string, unknown>): Promise<void> {
        return new Promise((resolve) => {
            chrome.storage.local.set(items, () => {
                resolve();
            });
        });
    },

    async remove(keys: string | string[]): Promise<void> {
        return new Promise((resolve) => {
            chrome.storage.local.remove(keys, () => {
                resolve();
            });
        });
    },

    async clear(): Promise<void> {
        return new Promise((resolve) => {
            chrome.storage.local.clear(() => {
                resolve();
            });
        });
    },

    async getBytesInUse(keys?: string | string[]): Promise<number> {
        return new Promise((resolve) => {
            chrome.storage.local.getBytesInUse(keys ?? null, (bytesInUse) => {
                resolve(bytesInUse);
            });
        });
    },
};

/**
 * Chrome Tabs implementation
 */
const chromeTabs: PlatformTabs = {
    async create(url: string): Promise<void> {
        await chrome.tabs.create({ url });
    },

    async captureVisibleTab(): Promise<string> {
        return new Promise((resolve, reject) => {
            chrome.tabs.captureVisibleTab({ format: 'png' }, (dataUrl) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(dataUrl);
                }
            });
        });
    },
};

/**
 * Chrome Notifications implementation
 */
const chromeNotifications: PlatformNotifications = {
    async create(id: string, options: { title: string; message: string; iconUrl?: string }): Promise<void> {
        return new Promise((resolve) => {
            chrome.notifications.create(id, {
                type: 'basic',
                iconUrl: options.iconUrl || 'icon128.png',
                title: options.title,
                message: options.message,
            }, () => {
                resolve();
            });
        });
    },
};

/**
 * Chrome Extension Platform
 */
export const chromePlatform: Platform = {
    name: 'chrome',
    storage: chromeStorage,
    tabs: chromeTabs,
    notifications: chromeNotifications,

    hasCapability(capability: PlatformCapability): boolean {
        return PLATFORM_CAPABILITIES.chrome.has(capability);
    },
};
