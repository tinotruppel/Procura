/**
 * Memory Store
 * 
 * Persistent key-value storage for AI agent memories, organized by prompt ID.
 * Allows agents to remember information across chat sessions.
 */

import { platform } from '@/platform';

// =============================================================================
// Types
// =============================================================================

export interface MemoryEntry {
    key: string;
    value: string;
    createdAt: number;
    updatedAt: number;
}

// Memory store keyed by promptId
export type MemoryStore = Record<string, MemoryEntry[]>;

// Storage keys
const MEMORY_STORE_KEY = 'procura_memory_store';
const MEMORY_LAST_MODIFIED_KEY = 'procura_memory_last_modified';

// =============================================================================
// Internal Helpers
// =============================================================================

async function getStore(): Promise<MemoryStore> {
    const result = await platform.storage.get<MemoryStore>([MEMORY_STORE_KEY]);
    return result[MEMORY_STORE_KEY] || {};
}

async function saveStore(store: MemoryStore): Promise<void> {
    await platform.storage.set({
        [MEMORY_STORE_KEY]: store,
        [MEMORY_LAST_MODIFIED_KEY]: Date.now(),
    });
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Get all memory entries for a specific prompt ID
 */
export async function getMemoryEntries(promptId: string): Promise<MemoryEntry[]> {
    const store = await getStore();
    return store[promptId] || [];
}

/**
 * Get a single memory entry by key
 */
export async function getMemoryEntry(promptId: string, key: string): Promise<MemoryEntry | null> {
    const entries = await getMemoryEntries(promptId);
    return entries.find(e => e.key === key) || null;
}

/**
 * Set (create or update) a memory entry
 */
export async function setMemoryEntry(promptId: string, key: string, value: string): Promise<void> {
    const store = await getStore();
    const entries = store[promptId] || [];
    const now = Date.now();

    const existingIndex = entries.findIndex(e => e.key === key);
    if (existingIndex >= 0) {
        // Update existing entry
        entries[existingIndex] = {
            ...entries[existingIndex],
            value,
            updatedAt: now,
        };
    } else {
        // Create new entry
        entries.push({
            key,
            value,
            createdAt: now,
            updatedAt: now,
        });
    }

    store[promptId] = entries;
    await saveStore(store);
}

/**
 * Delete a specific memory entry
 */
export async function deleteMemoryEntry(promptId: string, key: string): Promise<boolean> {
    const store = await getStore();
    const entries = store[promptId] || [];
    const initialLength = entries.length;

    store[promptId] = entries.filter(e => e.key !== key);
    const newLength = store[promptId].length;

    if (newLength === 0) {
        delete store[promptId];
    }

    // Only save and return true if we actually deleted something
    if (newLength < initialLength) {
        await saveStore(store);
        return true;
    }
    return false;
}

/**
 * Clear all memory entries (for Settings delete button)
 */
export async function clearAllMemory(): Promise<void> {
    await platform.storage.set({
        [MEMORY_STORE_KEY]: {},
        [MEMORY_LAST_MODIFIED_KEY]: Date.now(),
    });
}

/**
 * Get the entire memory store (for export)
 */
export async function getMemoryStore(): Promise<MemoryStore> {
    return await getStore();
}

/**
 * Set the entire memory store (for import)
 */
export async function setMemoryStore(store: MemoryStore): Promise<void> {
    await saveStore(store);
}

/**
 * Get memory last modified timestamp (for sync)
 */
export async function getMemoryLastModified(): Promise<number> {
    const result = await platform.storage.get<number>([MEMORY_LAST_MODIFIED_KEY]);
    return result[MEMORY_LAST_MODIFIED_KEY] || 0;
}

/**
 * Set memory last modified timestamp (for sync)
 */
export async function setMemoryLastModified(timestamp: number): Promise<void> {
    await platform.storage.set({ [MEMORY_LAST_MODIFIED_KEY]: timestamp });
}

/**
 * Get total count of memory entries across all prompts
 */
export async function getMemoryEntryCount(): Promise<number> {
    const store = await getStore();
    return Object.values(store).reduce((sum, entries) => sum + entries.length, 0);
}
