/**
 * CORS Middleware
 */

import { cors } from "hono/cors";
import type { MiddlewareHandler } from "hono";
import { getConfig } from "../config";

export function createCorsMiddleware(): MiddlewareHandler {
    const config = getConfig();

    return cors({
        origin: config.corsOrigin === "*" ? "*" : config.corsOrigin.split(","),
        allowMethods: ["GET", "PUT", "POST", "DELETE", "OPTIONS"],
        allowHeaders: ["Content-Type", "Authorization", "X-Api-Key", "X-API-Key", "X-MCP-Target-URL", "Mcp-Session-Id", "MCP-Protocol-Version"],
        exposeHeaders: ["Mcp-Session-Id", "WWW-Authenticate"],
    });
}
