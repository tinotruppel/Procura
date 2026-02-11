/**
 * Stateful in-memory mock for the database connection module.
 * Replaces MySQL with a Map-based store for testing.
 */

import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

interface StoredObject {
    user_id: string;
    object_id: string;
    encrypted_blob: Buffer;
    last_modified: number;
}

// In-memory store: key = "userId:objectId"
const store = new Map<string, StoredObject>();

function makeKey(userId: string, objectId: string): string {
    return `${userId}:${objectId}`;
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

export async function closePool(): Promise<void> {
    store.clear();
}

export interface SyncObjectRow extends RowDataPacket {
    user_id: string;
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

export async function listObjects(userId: string): Promise<SyncObjectListRow[]> {
    const rows: SyncObjectListRow[] = [];
    for (const obj of store.values()) {
        if (obj.user_id === userId) {
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

export async function getObject(userId: string, objectId: string): Promise<SyncObjectRow | null> {
    const obj = store.get(makeKey(userId, objectId));
    if (!obj) return null;
    return {
        encrypted_blob: obj.encrypted_blob,
        last_modified: obj.last_modified,
    } as SyncObjectRow;
}

export async function upsertObject(
    userId: string,
    objectId: string,
    encryptedBlob: Buffer,
    lastModified: number,
): Promise<ResultSetHeader> {
    const key = makeKey(userId, objectId);
    const existed = store.has(key);
    store.set(key, {
        user_id: userId,
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
