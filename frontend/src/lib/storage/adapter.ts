import { platform } from "@/platform";

/**
 * Platform-aware storage adapter that provides chrome.storage.local compatible interface
 * This enables the same storage code to work in both Chrome Extension and PWA contexts
 */
export const storage = {
    async get<T = unknown>(keys: string | string[] | null): Promise<Record<string, T>> {
        if (keys === null) {
            // Get all keys - for Chrome this works, for web we need special handling
            if (platform.name === 'chrome') {
                return new Promise((resolve) => {
                    chrome.storage.local.get(null, (result) => resolve(result as Record<string, T>));
                });
            }
            // For web platform, return empty - individual get calls work fine
            return {} as Record<string, T>;
        }
        return platform.storage.get<T>(Array.isArray(keys) ? keys : [keys]);
    },

    /** Get a single value with proper typing */
    async getValue<T>(key: string): Promise<T | undefined> {
        const result = await platform.storage.get<T>([key]);
        return result[key] as T | undefined;
    },

    /** Get a single value with a default fallback */
    async getValueOrDefault<T>(key: string, defaultValue: T): Promise<T> {
        const result = await platform.storage.get<T>([key]);
        return (result[key] as T | undefined) ?? defaultValue;
    },

    async set(items: Record<string, unknown>): Promise<void> {
        return platform.storage.set(items);
    },
    async remove(keys: string | string[]): Promise<void> {
        return platform.storage.remove(keys);
    },
};
