/**
 * Platform Detection and Export
 * 
 * Detects the current runtime environment and exports the appropriate
 * platform implementation.
 */

import { Platform, PlatformName } from './types';
import { chromePlatform } from './chrome';
import { webPlatform } from './web';

/**
 * Detect which platform we're running on
 */
function detectPlatform(): PlatformName {
    // Check if we're in a Chrome Extension context
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
        return 'chrome';
    }
    return 'web';
}

/**
 * Get the platform instance for the current environment
 */
function getPlatform(): Platform {
    const platformName = detectPlatform();
    return platformName === 'chrome' ? chromePlatform : webPlatform;
}

/**
 * The active platform instance
 */
export const platform = getPlatform();

/**
 * Convenience re-exports
 */
export type { Platform, PlatformName, PlatformCapability, PlatformStorage, PlatformTabs } from './types';
export { chromePlatform } from './chrome';
export { webPlatform } from './web';

/**
 * Check if a specific capability is available on the current platform
 */
export function hasCapability(capability: import('./types').PlatformCapability): boolean {
    return platform.hasCapability(capability);
}

/**
 * Check if we're running as a Chrome Extension
 */
export function isExtension(): boolean {
    return platform.name === 'chrome';
}

/**
 * Check if we're running as a PWA/Web app
 */
export function isWeb(): boolean {
    return platform.name === 'web';
}
