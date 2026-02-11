/**
 * Platform Abstraction Layer - Type Definitions
 * 
 * Defines the interface for platform-specific APIs, enabling the same
 * codebase to run as a Chrome Extension or a standalone PWA.
 */

export type PlatformName = 'chrome' | 'web';

/**
 * Storage interface abstracting chrome.storage.local and IndexedDB/localStorage
 */
export interface PlatformStorage {
    get<T = unknown>(keys: string | string[]): Promise<Record<string, T>>;
    set(items: Record<string, unknown>): Promise<void>;
    remove(keys: string | string[]): Promise<void>;
    clear(): Promise<void>;
    getBytesInUse?(keys?: string | string[]): Promise<number>;
}

/**
 * Tab/Window management interface
 */
export interface PlatformTabs {
    create(url: string): Promise<void>;
    captureVisibleTab?(): Promise<string>;
}

/**
 * Notification interface
 */
export interface PlatformNotifications {
    create(id: string, options: { title: string; message: string; iconUrl?: string }): Promise<void>;
}

/**
 * Main platform interface combining all capabilities
 */
export interface Platform {
    readonly name: PlatformName;
    readonly storage: PlatformStorage;
    readonly tabs: PlatformTabs;
    readonly notifications?: PlatformNotifications;

    /**
     * Check if a specific capability is available on this platform
     */
    hasCapability(capability: PlatformCapability): boolean;
}

/**
 * Capabilities that may or may not be available depending on platform
 */
export type PlatformCapability =
    | 'screenshot'
    | 'tab-capture'
    | 'content-injection'
    | 'notifications'
    | 'storage-quota';

/**
 * Platform capabilities map for feature detection
 */
export const PLATFORM_CAPABILITIES: Record<PlatformName, Set<PlatformCapability>> = {
    chrome: new Set(['screenshot', 'tab-capture', 'content-injection', 'notifications', 'storage-quota']),
    web: new Set([]), // PWA has limited capabilities
};
