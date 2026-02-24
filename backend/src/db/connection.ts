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
    const [rows] = await getPool().execute<SyncObjectListRow[]>(
        `SELECT object_id, last_modified, LENGTH(encrypted_blob) as size_bytes
         FROM sync_objects
         WHERE user_id = ?
         ORDER BY last_modified DESC`,
        [userId]
    );
    return rows;
}

export async function getObject(userId: string, objectId: string): Promise<SyncObjectRow | null> {
    const [rows] = await getPool().execute<SyncObjectRow[]>(
        `SELECT encrypted_blob, last_modified
         FROM sync_objects
         WHERE user_id = ? AND object_id = ?`,
        [userId, objectId]
    );
    return rows[0] || null;
}

export async function upsertObject(
    userId: string,
    objectId: string,
    encryptedBlob: Buffer,
    lastModified: number
): Promise<ResultSetHeader> {
    const [result] = await getPool().execute<ResultSetHeader>(
        `INSERT INTO sync_objects (user_id, object_id, encrypted_blob, last_modified)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
             encrypted_blob = VALUES(encrypted_blob),
             last_modified = VALUES(last_modified)`,
        [userId, objectId, encryptedBlob, lastModified]
    );
    return result;
}
