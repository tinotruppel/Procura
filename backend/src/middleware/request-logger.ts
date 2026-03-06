/**
 * Request Logging Middleware
 *
 * Logs incoming requests and outgoing responses at INFO level.
 * At DEBUG level, also logs request/response bodies.
 */

import type { MiddlewareHandler } from "hono";
import { createLogger } from "../lib/logger";

const log = createLogger("http");

export const requestLoggerMiddleware: MiddlewareHandler = async (c, next) => {
    const start = Date.now();
    const method = c.req.method;
    const path = c.req.path;

    // Skip noisy endpoints
    if (path === "/health" || method === "OPTIONS") {
        return next();
    }

    const apiKey = c.req.header("X-API-Key");
    const keyHint = apiKey ? `key=…${apiKey.slice(-6)}` : "no-key";

    log.info(`← ${method} ${path}`, keyHint);

    await next();

    const status = c.res.status;
    const duration = Date.now() - start;
    let emoji = "✅";
    if (status >= 500) emoji = "❌";
    else if (status >= 400) emoji = "⚠️";

    log.info(`→ ${emoji} ${status} ${method} ${path} ${duration}ms`);
};
