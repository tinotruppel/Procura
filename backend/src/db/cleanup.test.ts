import { describe, it, expect, beforeEach } from "vitest";
import { SqlitePool } from "../db/sqlite-pool";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";

/**
 * Integration tests for cleanup SQL queries.
 * Tests the actual SQL against SQLite in-memory, matching the queries
 * used in getInactiveUserIds and deleteUserData.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sync_objects (
    user_id VARCHAR(255) NOT NULL, object_id VARCHAR(255) NOT NULL,
    encrypted_blob BLOB NOT NULL, last_modified BIGINT NOT NULL,
    PRIMARY KEY (user_id, object_id)
);
CREATE TABLE IF NOT EXISTS oauth_tokens (
    user_id VARCHAR(255) NOT NULL, provider VARCHAR(64) NOT NULL,
    session_token VARCHAR(36) NOT NULL, refresh_token TEXT NOT NULL,
    created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
    PRIMARY KEY (user_id, provider)
);
`;

const DAY_MS = 24 * 60 * 60 * 1000;

// These queries mirror the ones in connection.ts
const GET_INACTIVE_SQL = `SELECT user_id FROM (
    SELECT user_id, MAX(last_modified) AS latest FROM sync_objects GROUP BY user_id
    UNION ALL
    SELECT user_id, MAX(updated_at) AS latest FROM oauth_tokens GROUP BY user_id
) AS combined
GROUP BY user_id
HAVING MAX(latest) < ?`;

const DELETE_SYNC_SQL = `DELETE FROM sync_objects WHERE user_id = ?`;
const DELETE_TOKENS_SQL = `DELETE FROM oauth_tokens WHERE user_id = ?`;

describe("Cleanup SQL Queries", () => {
    let pool: SqlitePool;

    beforeEach(() => {
        pool = new SqlitePool(":memory:");
        pool.exec(SCHEMA);
    });

    async function insertSync(userId: string, objectId: string, lastModified: number) {
        await pool.execute<ResultSetHeader>(
            `INSERT INTO sync_objects (user_id, object_id, encrypted_blob, last_modified) VALUES (?, ?, ?, ?)`,
            [userId, objectId, Buffer.from("test"), lastModified]
        );
    }

    async function insertToken(userId: string, provider: string, updatedAt: number) {
        await pool.execute<ResultSetHeader>(
            `INSERT INTO oauth_tokens (user_id, provider, session_token, refresh_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
            [userId, provider, crypto.randomUUID(), "refresh", updatedAt, updatedAt]
        );
    }

    describe("getInactiveUserIds query", () => {
        it("should find inactive users from sync_objects", async () => {
            const now = Date.now();
            await insertSync("inactive-user", "settings", now - 100 * DAY_MS);
            await insertSync("active-user", "settings", now);

            const [rows] = await pool.execute<RowDataPacket[]>(GET_INACTIVE_SQL, [now - 90 * DAY_MS]);
            const userIds = rows.map(r => r.user_id);
            expect(userIds).toEqual(["inactive-user"]);
        });

        it("should find inactive users from oauth_tokens only", async () => {
            const now = Date.now();
            await insertToken("token-only-inactive", "google", now - 100 * DAY_MS);

            const [rows] = await pool.execute<RowDataPacket[]>(GET_INACTIVE_SQL, [now - 90 * DAY_MS]);
            const userIds = rows.map(r => r.user_id);
            expect(userIds).toEqual(["token-only-inactive"]);
        });

        it("should NOT flag user with old sync but recent oauth token", async () => {
            const now = Date.now();
            await insertSync("mixed-user", "settings", now - 100 * DAY_MS);
            await insertToken("mixed-user", "google", now);

            const [rows] = await pool.execute<RowDataPacket[]>(GET_INACTIVE_SQL, [now - 90 * DAY_MS]);
            expect(rows).toEqual([]);
        });

        it("should NOT flag user with old oauth but recent sync data", async () => {
            const now = Date.now();
            await insertToken("mixed-user-2", "google", now - 100 * DAY_MS);
            await insertSync("mixed-user-2", "settings", now);

            const [rows] = await pool.execute<RowDataPacket[]>(GET_INACTIVE_SQL, [now - 90 * DAY_MS]);
            expect(rows).toEqual([]);
        });

        it("should return empty array when no users exist", async () => {
            const [rows] = await pool.execute<RowDataPacket[]>(GET_INACTIVE_SQL, [Date.now()]);
            expect(rows).toEqual([]);
        });

        it("should handle multiple inactive users", async () => {
            const now = Date.now();
            await insertSync("old-a", "s1", now - 200 * DAY_MS);
            await insertSync("old-b", "s1", now - 100 * DAY_MS);
            await insertSync("recent", "s1", now);

            const [rows] = await pool.execute<RowDataPacket[]>(GET_INACTIVE_SQL, [now - 90 * DAY_MS]);
            const userIds = rows.map(r => r.user_id).sort();
            expect(userIds).toEqual(["old-a", "old-b"]);
        });
    });

    describe("deleteUserData queries", () => {
        it("should delete all sync_objects and oauth_tokens for a user", async () => {
            const now = Date.now();
            await insertSync("del-user", "s1", now);
            await insertSync("del-user", "s2", now);
            await insertToken("del-user", "google", now);
            await insertSync("keep-user", "s1", now);

            const [syncResult] = await pool.execute<ResultSetHeader>(DELETE_SYNC_SQL, ["del-user"]);
            const [tokenResult] = await pool.execute<ResultSetHeader>(DELETE_TOKENS_SQL, ["del-user"]);

            expect(syncResult.affectedRows).toBe(2);
            expect(tokenResult.affectedRows).toBe(1);

            // Verify keep-user is untouched
            const [rows] = await pool.execute<RowDataPacket[]>(
                `SELECT COUNT(*) as cnt FROM sync_objects WHERE user_id = ?`, ["keep-user"]
            );
            expect(rows[0]?.cnt).toBe(1);
        });

        it("should return 0 when user has no data", async () => {
            const [syncResult] = await pool.execute<ResultSetHeader>(DELETE_SYNC_SQL, ["no-user"]);
            const [tokenResult] = await pool.execute<ResultSetHeader>(DELETE_TOKENS_SQL, ["no-user"]);

            expect(syncResult.affectedRows).toBe(0);
            expect(tokenResult.affectedRows).toBe(0);
        });
    });
});
