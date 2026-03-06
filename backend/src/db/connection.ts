/**
 * Database Connection Pool
 * Supports MySQL (production) and SQLite in-memory (dev).
 *
 * Set DB_DRIVER=sqlite in .env.local for local development — no external DB required.
 * MySQL is the default for production.
 */

import mysql from "mysql2/promise";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { readFileSync } from "fs";
import { resolve } from "path";
import { getConfig } from "../config";

// Unified pool interface (subset used by the app)
export interface DbPool {
    execute<T extends RowDataPacket[] | ResultSetHeader>(
        sql: string,
        params?: unknown[]
    ): Promise<[T, unknown]>;
    query(sql: string): Promise<[unknown[], unknown]>;
    end(): Promise<void>;
}

// ---------- Pool (lazy-initialized) ----------

let pool: DbPool | null = null;
let initPromise: Promise<void> | null = null;

async function initSqlitePool(): Promise<void> {
    const { createSqlitePool } = await import("./sqlite-pool.js");
    let schema: string | undefined;
    try {
        schema = readFileSync(resolve(process.cwd(), "schema.sql"), "utf-8");
    } catch { /* no schema file found */ }
    pool = createSqlitePool(schema);
}

// ---------- Public API ----------

/**
 * Initialize the database pool. Must be called once at startup.
 * For MySQL this is a no-op (pool created lazily). For SQLite this loads the driver.
 */
export async function initPool(): Promise<void> {
    if (process.env.DB_DRIVER === "sqlite" && !pool) {
        if (!initPromise) initPromise = initSqlitePool();
        await initPromise;
    }
}

export function getPool(): DbPool {
    if (!pool) {
        if (process.env.DB_DRIVER === "sqlite") {
            throw new Error("SQLite pool not initialized. Call initPool() first.");
        }
        const config = getConfig();
        pool = mysql.createPool({
            host: config.db.host,
            port: config.db.port,
            database: config.db.name,
            user: config.db.user,
            password: config.db.password,
            charset: "utf8mb4",
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
        }) as unknown as DbPool;
    }
    return pool;
}

// For testing: close pool
export async function closePool(): Promise<void> {
    if (pool) {
        await pool.end();
        pool = null;
    }
}

// Typed query helpers
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
    const [rows] = await getPool().execute<SyncObjectListRow[]>(
        `SELECT object_id, last_modified, LENGTH(encrypted_blob) as size_bytes
         FROM sync_objects
         WHERE key_id = ?
         ORDER BY last_modified DESC`,
        [keyId]
    );
    return rows;
}

export async function getObject(keyId: string, objectId: string): Promise<SyncObjectRow | null> {
    const [rows] = await getPool().execute<SyncObjectRow[]>(
        `SELECT encrypted_blob, last_modified
         FROM sync_objects
         WHERE key_id = ? AND object_id = ?`,
        [keyId, objectId]
    );
    return rows[0] || null;
}

export async function upsertObject(
    keyId: string,
    objectId: string,
    encryptedBlob: Buffer,
    lastModified: number
): Promise<ResultSetHeader> {
    const [result] = await getPool().execute<ResultSetHeader>(
        `INSERT INTO sync_objects (key_id, object_id, encrypted_blob, last_modified)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
             encrypted_blob = VALUES(encrypted_blob),
             last_modified = VALUES(last_modified)`,
        [keyId, objectId, encryptedBlob, lastModified]
    );
    return result;
}

/**
 * Get key IDs whose most recent activity across sync_objects, oauth_tokens,
 * and vault_secrets is older than the given cutoff timestamp.
 */
export async function getInactiveKeyIds(cutoffTimestamp: number): Promise<string[]> {
    const [rows] = await getPool().execute<RowDataPacket[]>(
        `SELECT key_id FROM (
            SELECT key_id, MAX(last_modified) AS latest FROM sync_objects GROUP BY key_id
            UNION ALL
            SELECT key_id, MAX(updated_at) AS latest FROM oauth_tokens GROUP BY key_id
            UNION ALL
            SELECT key_id, MAX(updated_at) AS latest FROM vault_secrets GROUP BY key_id
        ) AS combined
        GROUP BY key_id
        HAVING MAX(latest) < ?`,
        [cutoffTimestamp]
    );
    return rows.map(r => r.key_id as string);
}

/**
 * Delete all sync_objects, oauth_tokens, and vault_secrets for a given key.
 */
export async function deleteUserData(keyId: string): Promise<{ syncDeleted: number; tokensDeleted: number; secretsDeleted: number }> {
    const [syncResult] = await getPool().execute<ResultSetHeader>(
        `DELETE FROM sync_objects WHERE key_id = ?`,
        [keyId]
    );
    const [tokensResult] = await getPool().execute<ResultSetHeader>(
        `DELETE FROM oauth_tokens WHERE key_id = ?`,
        [keyId]
    );
    const [secretsResult] = await getPool().execute<ResultSetHeader>(
        `DELETE FROM vault_secrets WHERE key_id = ?`,
        [keyId]
    );
    return {
        syncDeleted: syncResult.affectedRows,
        tokensDeleted: tokensResult.affectedRows,
        secretsDeleted: secretsResult.affectedRows,
    };
}

// ---------- Vault Secrets ----------

export interface VaultSecretRow extends RowDataPacket {
    key_id: string;
    name: string;
    salt: Buffer;
    iv: Buffer;
    tag: Buffer;
    ciphertext: Buffer;
    created_at: number;
    updated_at: number;
}

export interface VaultSecretMetaRow extends RowDataPacket {
    name: string;
    updated_at: number;
}

export async function listSecrets(keyId: string): Promise<VaultSecretMetaRow[]> {
    const [rows] = await getPool().execute<VaultSecretMetaRow[]>(
        `SELECT name, updated_at FROM vault_secrets WHERE key_id = ? ORDER BY name`,
        [keyId]
    );
    return rows;
}

export async function getSecret(keyId: string, name: string): Promise<VaultSecretRow | null> {
    const [rows] = await getPool().execute<VaultSecretRow[]>(
        `SELECT salt, iv, tag, ciphertext FROM vault_secrets WHERE key_id = ? AND name = ?`,
        [keyId, name]
    );
    return rows[0] || null;
}

export async function upsertSecret(
    keyId: string,
    name: string,
    salt: Buffer,
    iv: Buffer,
    tag: Buffer,
    ciphertext: Buffer
): Promise<void> {
    const now = Date.now();
    await getPool().execute(
        `INSERT INTO vault_secrets (key_id, name, salt, iv, tag, ciphertext, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
             salt = VALUES(salt),
             iv = VALUES(iv),
             tag = VALUES(tag),
             ciphertext = VALUES(ciphertext),
             updated_at = VALUES(updated_at)`,
        [keyId, name, salt, iv, tag, ciphertext, now, now]
    );
}

export async function deleteSecret(keyId: string, name: string): Promise<boolean> {
    const [result] = await getPool().execute<ResultSetHeader>(
        `DELETE FROM vault_secrets WHERE key_id = ? AND name = ?`,
        [keyId, name]
    );
    return result.affectedRows > 0;
}

export async function deleteSecrets(keyId: string): Promise<number> {
    const [result] = await getPool().execute<ResultSetHeader>(
        `DELETE FROM vault_secrets WHERE key_id = ?`,
        [keyId]
    );
    return result.affectedRows;
}
