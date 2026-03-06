/**
 * Stateful in-memory mock for the database connection module.
 * Replaces MySQL with a Map-based store for testing.
 */

import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

interface StoredObject {
    key_id: string;
    object_id: string;
    encrypted_blob: Buffer;
    last_modified: number;
}

// In-memory store: key = "keyId:objectId"
const store = new Map<string, StoredObject>();

function makeKey(keyId: string, objectId: string): string {
    return `${keyId}:${objectId}`;
}

export function clearAll(): void {
    store.clear();
}

export function getPool() {
    return {
        execute: async () => [[], []],
        query: async () => [[], []],
    };
}

export async function initPool(): Promise<void> { /* no-op for mock */ }

export async function closePool(): Promise<void> {
    store.clear();
}

export interface SyncObjectRow extends RowDataPacket {
    key_id: string;
    object_id: string;
    encrypted_blob: Buffer;
    last_modified: number;
    size_bytes?: number;
}

export interface SyncObjectListRow extends RowDataPacket {
    object_id: string;
    last_modified: number;
    size_bytes: number;
}

export async function listObjects(keyId: string): Promise<SyncObjectListRow[]> {
    const rows: SyncObjectListRow[] = [];
    for (const obj of store.values()) {
        if (obj.key_id === keyId) {
            rows.push({
                object_id: obj.object_id,
                last_modified: obj.last_modified,
                size_bytes: obj.encrypted_blob.length,
            } as SyncObjectListRow);
        }
    }
    rows.sort((a, b) => b.last_modified - a.last_modified);
    return rows;
}

export async function getObject(keyId: string, objectId: string): Promise<SyncObjectRow | null> {
    const obj = store.get(makeKey(keyId, objectId));
    if (!obj) return null;
    return {
        encrypted_blob: obj.encrypted_blob,
        last_modified: obj.last_modified,
    } as SyncObjectRow;
}

export async function upsertObject(
    keyId: string,
    objectId: string,
    encryptedBlob: Buffer,
    lastModified: number,
): Promise<ResultSetHeader> {
    const key = makeKey(keyId, objectId);
    const existed = store.has(key);
    store.set(key, {
        key_id: keyId,
        object_id: objectId,
        encrypted_blob: encryptedBlob,
        last_modified: lastModified,
    });
    return {
        affectedRows: existed ? 2 : 1, // MySQL returns 2 for upsert-update
        insertId: 0,
        fieldCount: 0,
        info: "",
        serverStatus: 0,
        warningStatus: 0,
        changedRows: existed ? 1 : 0,
    } as ResultSetHeader;
}

// Vault stubs (not exercised by sync tests)
export async function listSecrets(): Promise<RowDataPacket[]> { return []; }
export async function getSecret(): Promise<null> { return null; }
export async function upsertSecret(): Promise<void> { /* no-op */ }
export async function deleteSecret(): Promise<boolean> { return false; }
export async function deleteSecrets(): Promise<number> { return 0; }
export async function getInactiveKeyIds(): Promise<string[]> { return []; }
export async function deleteUserData(): Promise<{ syncDeleted: number; tokensDeleted: number; secretsDeleted: number }> {
    return { syncDeleted: 0, tokensDeleted: 0, secretsDeleted: 0 };
}
