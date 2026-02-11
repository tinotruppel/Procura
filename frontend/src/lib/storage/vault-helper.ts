import {
    isVaultConfigured,
    isVaultUnlocked,
    restoreVaultFromSession,
    decryptWithVault,
} from "../vault";
import { storage } from "./adapter";

/**
 * Generic helper for reading vault-encrypted values with automatic unlock attempt.
 * Eliminates the repeated vault-unlock-or-restore pattern used across storage modules.
 *
 * @param encryptedKey - The storage key for the encrypted value
 * @param fallback - Value to return when vault is not configured or no encrypted data exists
 * @param lockedFallback - Optional different fallback when vault is configured but locked
 */
export async function readEncryptedOrFallback<T>(
    encryptedKey: string,
    fallback: T,
    lockedFallback?: T
): Promise<T> {
    const configured = await isVaultConfigured();
    if (!configured) return fallback;
    if (!isVaultUnlocked()) await restoreVaultFromSession();
    if (!isVaultUnlocked()) return lockedFallback ?? fallback;
    const encrypted = await storage.getValue<string>(encryptedKey);
    if (!encrypted) return lockedFallback ?? fallback;
    return decryptWithVault<T>(encrypted);
}
