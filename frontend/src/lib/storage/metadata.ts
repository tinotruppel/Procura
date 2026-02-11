import { storage } from "./adapter";
import { STORAGE_KEYS } from "./keys";

// ============================================================================
// Settings Last Modified (for sync)
// ============================================================================

export async function getSettingsLastModified(): Promise<number> {
    return storage.getValueOrDefault<number>(STORAGE_KEYS.SETTINGS_LAST_MODIFIED, 0);
}

export async function setSettingsLastModified(timestamp: number): Promise<void> {
    await storage.set({ [STORAGE_KEYS.SETTINGS_LAST_MODIFIED]: timestamp });
}
