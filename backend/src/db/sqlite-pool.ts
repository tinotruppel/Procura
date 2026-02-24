/**
 * SQLite Pool Adapter
 *
 * Mimics the mysql2/promise Pool API using better-sqlite3 in-memory.
 * Used for local development — no external DB needed.
 *
 * Handles MySQL → SQLite SQL translation:
 *   - ON DUPLICATE KEY UPDATE → ON CONFLICT DO UPDATE
 *   - ? placeholders work as-is
 *   - LENGTH() → length() (compatible)
 */

import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";

const MYSQL_UPSERT_RE =
    /INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)\s*ON\s+DUPLICATE\s+KEY\s+UPDATE\s+([\s\S]+)/i;

/**
 * Translate MySQL SQL → SQLite SQL (only the subset we use)
 */
function translateSql(sql: string): string {
    // ON DUPLICATE KEY UPDATE → ON CONFLICT DO UPDATE
    const upsertMatch = MYSQL_UPSERT_RE.exec(sql);
    if (upsertMatch) {
        const [, table, columns, values, updateClause] = upsertMatch;
        // Convert VALUES(col) references to excluded.col
        const sqliteUpdate = updateClause
            .replace(/VALUES\((\w+)\)/gi, "excluded.$1")
            .trim()
            .replace(/;$/, "");
        return `INSERT INTO ${table} (${columns}) VALUES (${values}) ON CONFLICT DO UPDATE SET ${sqliteUpdate}`;
    }
    return sql;
}

export class SqlitePool {
    private db: Database.Database;

    constructor(dbPath: string = ":memory:") {
        if (dbPath !== ":memory:") {
            const dir = dirname(dbPath);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        }
        this.db = new Database(dbPath);
        this.db.pragma("journal_mode = WAL");
        this.db.pragma("foreign_keys = ON");
    }

    /**
     * Execute raw SQL (for schema initialization).
     * Splits on semicolons and runs each statement.
     */
    exec(sql: string): void {
        this.db.exec(sql);
    }

    /**
     * Mimics mysql2's pool.execute<T>(sql, params) → [rows, fields]
     */
    async execute<T extends RowDataPacket[] | ResultSetHeader>(
        sql: string,
        params?: unknown[]
    ): Promise<[T, unknown]> {
        const translated = translateSql(sql.trim());
        const isSelect = /^\s*SELECT/i.test(translated);

        if (isSelect) {
            const stmt = this.db.prepare(translated);
            const rows = params ? stmt.all(...params) : stmt.all();
            return [rows as T, []];
        } else {
            const stmt = this.db.prepare(translated);
            const result = params ? stmt.run(...params) : stmt.run();
            const header = {
                affectedRows: result.changes,
                insertId: Number(result.lastInsertRowid),
                fieldCount: 0,
                info: "",
                serverStatus: 0,
                warningStatus: 0,
                changedRows: result.changes,
            } as unknown as T;
            return [header, []];
        }
    }

    /**
     * Mimics mysql2's pool.query(sql) — used for health checks
     */
    async query(sql: string): Promise<[unknown[], unknown]> {
        const stmt = this.db.prepare(sql);
        const rows = stmt.all();
        return [rows, []];
    }

    /**
     * Close the database connection
     */
    async end(): Promise<void> {
        this.db.close();
    }
}

/**
 * Create a SQLite pool and initialize schema
 */
export function createSqlitePool(schemaSql?: string): SqlitePool {
    const dbPath = process.env.DB_PATH || ".devdb/dev.sqlite3";
    const pool = new SqlitePool(dbPath);

    if (schemaSql) {
        // Strip MySQL-specific parts from schema
        const sqliteSchema = schemaSql
            .replace(/ENGINE=InnoDB\s*/gi, "")
            .replace(/DEFAULT\s+CHARSET=\w+\s*/gi, "")
            .replace(/COLLATE=\w+\s*/gi, "")
            .replace(/CHARACTER\s+SET\s+\w+\s*/gi, "")
            .replace(/COLLATE\s+\w+\s*/gi, "")
            .replace(/LONGBLOB/gi, "BLOB")
            .replace(/CREATE\s+DATABASE\s+IF\s+NOT\s+EXISTS\s+\w+[^;]*;/gi, "")
            .replace(/USE\s+\w+\s*;/gi, "")
            // INDEX in CREATE TABLE must be removed (SQLite uses CREATE INDEX separately)
            .replace(/,\s*INDEX\s+\w+\s*\([^)]+\)/gi, "")
            .replace(/,\s*UNIQUE\s+INDEX\s+\w+\s*\([^)]+\)/gi, "");

        pool.exec(sqliteSchema);
    }

    const label = dbPath === ":memory:" ? "in-memory" : dbPath;
    console.log(`📦 SQLite database initialized (${label})`);
    return pool;
}
