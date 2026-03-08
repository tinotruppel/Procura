/**
 * Structured Logger
 *
 * Log levels: error < warn < info < debug
 * Set via LOG_LEVEL env var (default: "warn")
 *
 * Uses console.log (stdout) for info/debug and console.error (stderr)
 * for error/warn to ensure Phusion Passenger captures all output.
 *
 * Optional: set LOG_FILE env var to also write to a file.
 */

import { appendFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

export type LogLevel = "error" | "warn" | "info" | "debug";

const LEVELS: Record<LogLevel, number> = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
};

// Auto-detect log file: LOG_FILE env var, or app.log next to dist/ in production
function detectLogFile(): string {
    if (process.env.LOG_FILE) return process.env.LOG_FILE;
    // In production (esbuild bundle), __filename is inside dist/
    // Write app.log to parent of dist/ (the app root)
    try {
        const thisDir = dirname(fileURLToPath(import.meta.url));
        // Only auto-enable file logging in production (dist/ directory)
        if (thisDir.includes("/dist")) {
            return resolve(thisDir, "..", "app.log");
        }
    } catch {
        // import.meta.url not available or other issue
    }
    return ""; // No file logging in dev
}

const COLORS: Record<LogLevel, string> = {
    error: "\x1b[31m",  // red
    warn: "\x1b[33m",   // yellow
    info: "\x1b[36m",   // cyan
    debug: "\x1b[90m",  // gray
};
const RESET = "\x1b[0m";

let currentLevel: LogLevel = "warn";
const logFile = detectLogFile();

export function setLogLevel(level: LogLevel): void {
    currentLevel = level;
}

export function getLogLevel(): LogLevel {
    return currentLevel;
}

function shouldLog(level: LogLevel): boolean {
    return LEVELS[level] <= LEVELS[currentLevel];
}

function timestamp(): string {
    return new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
}

function format(level: LogLevel, tag: string, message: string, data?: unknown): string {
    const color = COLORS[level];
    const lvl = level.toUpperCase().padEnd(5);
    const base = `${color}${timestamp()} ${lvl}${RESET} [${tag}] ${message}`;
    if (data !== undefined) {
        const serialized = typeof data === "string" ? data : JSON.stringify(data, null, 0);
        return `${base} ${COLORS.debug}${serialized}${RESET}`;
    }
    return base;
}

function plainFormat(level: LogLevel, tag: string, message: string, data?: unknown): string {
    const lvl = level.toUpperCase().padEnd(5);
    const ts = new Date().toISOString();
    const base = `${ts} ${lvl} [${tag}] ${message}`;
    if (data !== undefined) {
        const serialized = typeof data === "string" ? data : JSON.stringify(data, null, 0);
        return `${base} ${serialized}`;
    }
    return base;
}

function writeToFile(level: LogLevel, tag: string, message: string, data?: unknown): void {
    if (!logFile) return;
    try {
        appendFileSync(logFile, plainFormat(level, tag, message, data) + "\n");
    } catch {
        // Silently ignore file write errors
    }
}

export function createLogger(tag: string) {
    return {
        error(message: string, data?: unknown) {
            if (shouldLog("error")) {
                console.error(format("error", tag, message, data));
                writeToFile("error", tag, message, data);
            }
        },
        warn(message: string, data?: unknown) {
            if (shouldLog("warn")) {
                console.error(format("warn", tag, message, data));
                writeToFile("warn", tag, message, data);
            }
        },
        info(message: string, data?: unknown) {
            if (shouldLog("info")) {
                console.log(format("info", tag, message, data));
                writeToFile("info", tag, message, data);
            }
        },
        debug(message: string, data?: unknown) {
            if (shouldLog("debug")) {
                console.log(format("debug", tag, message, data));
                writeToFile("debug", tag, message, data);
            }
        },
    };
}

// Initialize from env
const envLevel = (process.env.LOG_LEVEL || "warn").toLowerCase() as LogLevel;
if (envLevel in LEVELS) {
    setLogLevel(envLevel);
}
