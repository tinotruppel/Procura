/**
 * Structured Logger
 *
 * Log levels: error < warn < info < debug
 * Set via LOG_LEVEL env var (default: "warn")
 */

export type LogLevel = "error" | "warn" | "info" | "debug";

const LEVELS: Record<LogLevel, number> = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
};

const COLORS: Record<LogLevel, string> = {
    error: "\x1b[31m",  // red
    warn: "\x1b[33m",   // yellow
    info: "\x1b[36m",   // cyan
    debug: "\x1b[90m",  // gray
};
const RESET = "\x1b[0m";

let currentLevel: LogLevel = "warn";

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

export function createLogger(tag: string) {
    return {
        error(message: string, data?: unknown) {
            if (shouldLog("error")) console.error(format("error", tag, message, data));
        },
        warn(message: string, data?: unknown) {
            if (shouldLog("warn")) console.warn(format("warn", tag, message, data));
        },
        info(message: string, data?: unknown) {
            if (shouldLog("info")) console.info(format("info", tag, message, data));
        },
        debug(message: string, data?: unknown) {
            if (shouldLog("debug")) console.debug(format("debug", tag, message, data));
        },
    };
}

// Initialize from env
const envLevel = (process.env.LOG_LEVEL || "warn").toLowerCase() as LogLevel;
if (envLevel in LEVELS) {
    setLogLevel(envLevel);
}
