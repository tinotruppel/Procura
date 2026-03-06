import { describe, it, expect, beforeEach } from "vitest";
import { SqlitePool } from "../db/sqlite-pool";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";

/**
 * Integration tests for cleanup SQL queries.
 * Tests the actual SQL against SQLite in-memory, matching the queries
 * used in getInactiveKeyIds and deleteUserData.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sync_objects (
    key_id CHAR(64) NOT NULL, object_id VARCHAR(255) NOT NULL,
    encrypted_blob BLOB NOT NULL, last_modified BIGINT NOT NULL,
    PRIMARY KEY (key_id, object_id)
);
CREATE TABLE IF NOT EXISTS oauth_tokens (
    key_id CHAR(64) NOT NULL, provider VARCHAR(64) NOT NULL,
    session_token VARCHAR(36) NOT NULL, refresh_token TEXT NOT NULL,
    created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
    PRIMARY KEY (key_id, provider)
);
CREATE TABLE IF NOT EXISTS vault_secrets (
    key_id CHAR(64) NOT NULL, name VARCHAR(128) NOT NULL,
    salt BLOB NOT NULL, iv BLOB NOT NULL, tag BLOB NOT NULL,
    ciphertext BLOB NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
    PRIMARY KEY (key_id, name)
);
`;

const DAY_MS = 24 * 60 * 60 * 1000;

// These queries mirror the ones in connection.ts
const GET_INACTIVE_SQL = `SELECT key_id FROM (
    SELECT key_id, MAX(last_modified) AS latest FROM sync_objects GROUP BY key_id
    UNION ALL
    SELECT key_id, MAX(updated_at) AS latest FROM oauth_tokens GROUP BY key_id
    UNION ALL
    SELECT key_id, MAX(updated_at) AS latest FROM vault_secrets GROUP BY key_id
) AS combined
GROUP BY key_id
HAVING MAX(latest) < ?`;

const DELETE_SYNC_SQL = `DELETE FROM sync_objects WHERE key_id = ?`;
const DELETE_TOKENS_SQL = `DELETE FROM oauth_tokens WHERE key_id = ?`;
const DELETE_SECRETS_SQL = `DELETE FROM vault_secrets WHERE key_id = ?`;

describe("Cleanup SQL Queries", () => {
    let pool: SqlitePool;

    beforeEach(() => {
        pool = new SqlitePool(":memory:");
        pool.exec(SCHEMA);
    });

    async function insertSync(keyId: string, objectId: string, lastModified: number) {
        await pool.execute<ResultSetHeader>(
            `INSERT INTO sync_objects (key_id, object_id, encrypted_blob, last_modified) VALUES (?, ?, ?, ?)`,
            [keyId, objectId, Buffer.from("test"), lastModified]
        );
    }

    async function insertToken(keyId: string, provider: string, updatedAt: number) {
        await pool.execute<ResultSetHeader>(
            `INSERT INTO oauth_tokens (key_id, provider, session_token, refresh_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
            [keyId, provider, crypto.randomUUID(), "refresh", updatedAt, updatedAt]
        );
    }

    async function insertSecret(keyId: string, name: string, updatedAt: number) {
        await pool.execute<ResultSetHeader>(
            `INSERT INTO vault_secrets (key_id, name, salt, iv, tag, ciphertext, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [keyId, name, Buffer.alloc(16), Buffer.alloc(12), Buffer.alloc(16), Buffer.from("enc"), updatedAt, updatedAt]
        );
    }

    describe("getInactiveKeyIds query", () => {
        it("should find inactive keys from sync_objects", async () => {
            const now = Date.now();
            await insertSync("inactive-key", "settings", now - 100 * DAY_MS);
            await insertSync("active-key", "settings", now);

            const [rows] = await pool.execute<RowDataPacket[]>(GET_INACTIVE_SQL, [now - 90 * DAY_MS]);
            const keyIds = rows.map(r => r.key_id);
            expect(keyIds).toEqual(["inactive-key"]);
        });

        it("should find inactive keys from oauth_tokens only", async () => {
            const now = Date.now();
            await insertToken("token-only-inactive", "google", now - 100 * DAY_MS);

            const [rows] = await pool.execute<RowDataPacket[]>(GET_INACTIVE_SQL, [now - 90 * DAY_MS]);
            const keyIds = rows.map(r => r.key_id);
            expect(keyIds).toEqual(["token-only-inactive"]);
        });

        it("should NOT flag key with old sync but recent oauth token", async () => {
            const now = Date.now();
            await insertSync("mixed-key", "settings", now - 100 * DAY_MS);
            await insertToken("mixed-key", "google", now);

            const [rows] = await pool.execute<RowDataPacket[]>(GET_INACTIVE_SQL, [now - 90 * DAY_MS]);
            expect(rows).toEqual([]);
        });

        it("should NOT flag key with old data but recent vault secret", async () => {
            const now = Date.now();
            await insertSync("vault-key", "settings", now - 100 * DAY_MS);
            await insertSecret("vault-key", "GOOGLE_SECRET", now);

            const [rows] = await pool.execute<RowDataPacket[]>(GET_INACTIVE_SQL, [now - 90 * DAY_MS]);
            expect(rows).toEqual([]);
        });

        it("should return empty array when no keys exist", async () => {
            const [rows] = await pool.execute<RowDataPacket[]>(GET_INACTIVE_SQL, [Date.now()]);
            expect(rows).toEqual([]);
        });

        it("should handle multiple inactive keys", async () => {
            const now = Date.now();
            await insertSync("old-a", "s1", now - 200 * DAY_MS);
            await insertSync("old-b", "s1", now - 100 * DAY_MS);
            await insertSync("recent", "s1", now);

            const [rows] = await pool.execute<RowDataPacket[]>(GET_INACTIVE_SQL, [now - 90 * DAY_MS]);
            const keyIds = rows.map(r => r.key_id).sort();
            expect(keyIds).toEqual(["old-a", "old-b"]);
        });
    });

    describe("deleteUserData queries", () => {
        it("should delete all sync_objects, oauth_tokens, and vault_secrets for a key", async () => {
            const now = Date.now();
            await insertSync("del-key", "s1", now);
            await insertSync("del-key", "s2", now);
            await insertToken("del-key", "google", now);
            await insertSecret("del-key", "API_KEY", now);
            await insertSync("keep-key", "s1", now);

            const [syncResult] = await pool.execute<ResultSetHeader>(DELETE_SYNC_SQL, ["del-key"]);
            const [tokenResult] = await pool.execute<ResultSetHeader>(DELETE_TOKENS_SQL, ["del-key"]);
            const [secretResult] = await pool.execute<ResultSetHeader>(DELETE_SECRETS_SQL, ["del-key"]);

            expect(syncResult.affectedRows).toBe(2);
            expect(tokenResult.affectedRows).toBe(1);
            expect(secretResult.affectedRows).toBe(1);

            // Verify keep-key is untouched
            const [rows] = await pool.execute<RowDataPacket[]>(
                `SELECT COUNT(*) as cnt FROM sync_objects WHERE key_id = ?`, ["keep-key"]
            );
            expect(rows[0]?.cnt).toBe(1);
        });

        it("should return 0 when key has no data", async () => {
            const [syncResult] = await pool.execute<ResultSetHeader>(DELETE_SYNC_SQL, ["no-key"]);
            const [tokenResult] = await pool.execute<ResultSetHeader>(DELETE_TOKENS_SQL, ["no-key"]);
            const [secretResult] = await pool.execute<ResultSetHeader>(DELETE_SECRETS_SQL, ["no-key"]);

            expect(syncResult.affectedRows).toBe(0);
            expect(tokenResult.affectedRows).toBe(0);
            expect(secretResult.affectedRows).toBe(0);
        });
    });
});
