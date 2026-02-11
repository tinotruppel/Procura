/**
 * Web/PWA Platform Implementation
 * 
 * Implements the Platform interface using standard Web APIs (IndexedDB, localStorage).
 * This enables the application to run as a standalone PWA.
 */

import {
    Platform,
    PlatformStorage,
    PlatformTabs,
    PlatformCapability,
    PLATFORM_CAPABILITIES
} from './types';

const DB_NAME = 'procura-pwa';
const DB_VERSION = 1;
const STORE_NAME = 'keyval';

/**
 * Get or create the IndexedDB database
 */
function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
    });
}

/**
 * IndexedDB-based storage implementation
 */
const webStorage: PlatformStorage = {
    async get<T = unknown>(keys: string | string[]): Promise<Record<string, T>> {
        const keyArray = Array.isArray(keys) ? keys : [keys];
        const db = await openDatabase();
        const result: Record<string, T> = {};

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readonly');
            const store = transaction.objectStore(STORE_NAME);

            let pending = keyArray.length;
            if (pending === 0) {
                resolve(result);
                return;
            }

            keyArray.forEach((key) => {
                const request = store.get(key);
                request.onsuccess = () => {
                    if (request.result !== undefined) {
                        result[key] = request.result;
                    }
                    pending--;
                    if (pending === 0) {
                        resolve(result);
                    }
                };
                request.onerror = () => reject(request.error);
            });
        });
    },

    async set(items: Record<string, unknown>): Promise<void> {
        const db = await openDatabase();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);

            Object.entries(items).forEach(([key, value]) => {
                store.put(value, key);
            });

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    },

    async remove(keys: string | string[]): Promise<void> {
        const keyArray = Array.isArray(keys) ? keys : [keys];
        const db = await openDatabase();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);

            keyArray.forEach((key) => {
                store.delete(key);
            });

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    },

    async clear(): Promise<void> {
        const db = await openDatabase();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    },

    // Note: IndexedDB doesn't have a built-in way to get storage size
    // We could estimate it, but for now we omit this
};

/**
 * Web Tabs implementation using window.open
 */
const webTabs: PlatformTabs = {
    async create(url: string): Promise<void> {
        window.open(url, '_blank');
    },

    // captureVisibleTab is not available in web context
};

/**
 * Web/PWA Platform
 */
export const webPlatform: Platform = {
    name: 'web',
    storage: webStorage,
    tabs: webTabs,
    // notifications could be added using the Web Notifications API if needed

    hasCapability(capability: PlatformCapability): boolean {
        return PLATFORM_CAPABILITIES.web.has(capability);
    },
};
