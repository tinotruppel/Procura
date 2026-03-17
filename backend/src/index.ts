/**
 * Procura API Backend
 *
 * TypeScript/Hono implementation of the Procura backend.
 *
 * Routes:
 *   GET    /sync/{userId}             - List all objects with timestamps
 *   GET    /sync/{userId}/{objectId}  - Get single object
 *   PUT    /sync/{userId}/{objectId}  - Store object
 *   GET    /health                    - Health check with service listing
 *   POST   /mcp-proxy                 - Forward MCP requests (CORS bypass)
 *   GET    /mcp/tasks                 - Tasks MCP server (ticket management)
 *   GET    /mcp/weather               - Weather MCP server
 *   GET    /mcp/cv-database           - CV Database MCP server (resume search)
 *   GET    /mcp/vector-store          - Vector Store MCP server (semantic search)
 *   POST   /mcp/vector-store          - Vector Store MCP server (SSE message endpoint)
 *   GET    /mcp/document-media        - Document/Media MCP server (OCR, transcription)
 *   GET    /mcp/github                - GitHub MCP server (read-only)
 *   GET    /mcp/image-generation      - Image Generation MCP server (Imagen AI)
 *   GET    /mcp/google-docs           - Google Docs MCP server
 *   GET    /mcp/google-sheets         - Google Sheets MCP server
 *   GET    /mcp/google-slides         - Google Slides MCP server
 *   GET    /mcp/google-drive          - Google Drive MCP server
 *   GET    /mcp/gmail                 - Gmail MCP server
 *   GET    /mcp/google-calendar       - Google Calendar MCP server
 */

import { Hono } from "hono";
import { createCorsMiddleware } from "./middleware/cors";
import { authMiddleware } from "./middleware/auth";
import { rateLimitMiddleware } from "./middleware/rate-limit";
import { requestLoggerMiddleware } from "./middleware/request-logger";
import { createLogger, getLogLevel } from "./lib/logger";
import { syncRoutes } from "./routes/sync";
import { cronRoutes } from "./routes/cron";
import { mcpProxyRoutes } from "./routes/mcp-proxy";
import { tasksMcpRoutes } from "./routes/tasks-mcp";
import { weatherMcpRoutes } from "./routes/weather-mcp";
import { cvDatabaseMcpRoutes } from "./routes/cv-database-mcp";
import { vectorStoreMcpRoutes } from "./routes/vector-store-mcp";
import { documentMediaMcpRoutes } from "./routes/document-media-mcp";
import { githubMcpRoutes } from "./routes/github-mcp";
import { imageGenerationMcpRoutes } from "./routes/image-generation-mcp";
import { googleDocsMcpRoutes } from "./routes/google-docs-mcp";
import { googleSheetsMcpRoutes } from "./routes/google-sheets-mcp";
import { googleSlidesMcpRoutes } from "./routes/google-slides-mcp";
import { googleDriveMcpRoutes } from "./routes/google-drive-mcp";
import { gmailMcpRoutes } from "./routes/gmail-mcp";
import { googleCalendarMcpRoutes } from "./routes/google-calendar-mcp";
import { googleOAuthRoutes } from "./routes/google-oauth";
import { trelloOAuthRoutes } from "./routes/trello-oauth";
import { mcpDirectoryRoutes } from "./routes/mcp-directory";
import { vaultRoutes } from "./routes/vault";
import { getConfig } from "./config";
import { getPool } from "./db/connection";

// Create main app
const app = new Hono();

// Global middleware
app.use("*", createCorsMiddleware());
app.use("*", requestLoggerMiddleware);
app.use("*", rateLimitMiddleware);

// Apply auth to protected routes BEFORE mounting them
app.use("/sync/*", authMiddleware);
app.use("/mcp-proxy/*", authMiddleware);
app.use("/mcp-directory/*", authMiddleware);
app.use("/mcp/*", async (c, next) => {
    // Skip auth for .well-known discovery endpoints (RFC9728 — must be public for OAuth flow)
    if (c.req.path.includes("/.well-known/")) {
        return next();
    }
    return authMiddleware(c, next);
});
app.use("/cron/*", authMiddleware);
app.use("/vault/*", authMiddleware);
app.use("/google/auth/google/status", authMiddleware);
app.use("/google/auth/google/disconnect", authMiddleware);
app.use("/trello/status", authMiddleware);
app.use("/trello/disconnect", authMiddleware);
// Note: /google/auth/google/callback and /trello/callback are NOT auth-protected — provider redirects users there
// Note: /trello/token-store is NOT auth-protected — receives token from callback page
// Note: /.well-known/*, /oauth/authorize, /oauth/token, /oauth/register are NOT auth-protected — OAuth flow endpoints

// Mount routes
app.route("/sync", syncRoutes);
app.route("/cron", cronRoutes);
app.route("/vault", vaultRoutes);
app.route("/mcp-proxy", mcpProxyRoutes);
app.route("/mcp-directory", mcpDirectoryRoutes);
// When adding new MCP routes, also update mcp-directory.ts
app.route("/mcp/tasks", tasksMcpRoutes);
app.route("/mcp/weather", weatherMcpRoutes);
app.route("/mcp/cv-database", cvDatabaseMcpRoutes);
app.route("/mcp/vector-store", vectorStoreMcpRoutes);
app.route("/mcp/document-media", documentMediaMcpRoutes);
app.route("/mcp/github", githubMcpRoutes);
app.route("/mcp/image-generation", imageGenerationMcpRoutes);
app.route("/mcp/google-docs", googleDocsMcpRoutes);
app.route("/mcp/google-sheets", googleSheetsMcpRoutes);
app.route("/mcp/google-slides", googleSlidesMcpRoutes);
app.route("/mcp/google-drive", googleDriveMcpRoutes);
app.route("/mcp/gmail", gmailMcpRoutes);
app.route("/mcp/google-calendar", googleCalendarMcpRoutes);
// OAuth Authorization Servers — mounted at provider-specific prefixes for clean separation
app.route("/google", googleOAuthRoutes);
app.route("/trello", trelloOAuthRoutes);

// Health check with database connection test and service listing
app.get("/health", async (c) => {
    const services = ["sync", "mcp-proxy", "mcp-directory"];
    try {
        const pool = getPool();
        await pool.query("SELECT 1");
        return c.json({ status: "ok", database: "connected", services });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return c.json({ status: "degraded", database: "disconnected", error: message, services }, 503);
    }
});

// 404 handler
app.notFound((c) => c.json({ error: "Not found" }, 404));

const log = createLogger("app");

// Error handler
app.onError((err, c) => {
    log.error(`${c.req.method} ${c.req.path}`, err.message);
    return c.json({ error: "Internal server error" }, 500);
});

// Export app for testing
export { app };

// Start server (Node.js only)
// Priority: 1. process.env.PORT (Plesk/hosting sets this), 2. config port, 3. fallback 3001
const port = (() => {
    if (process.env.PORT) {
        return parseInt(process.env.PORT, 10);
    }
    try {
        return getConfig().port;
    } catch {
        return 3001;
    }
})();

// Always start the server (Phusion Passenger requires this)
if (!process.env.VITEST && process.env.NODE_ENV !== "test") {
    import("./db/connection.js")
        .then(({ initPool }) => initPool())
        .then(() => import("@hono/node-server"))
        .then(({ serve }) => {
            serve({ fetch: app.fetch, port });
            console.log(`🚀 Server running on port ${port} (Node.js) — log level: ${getLogLevel()}`);
        })
        .catch((err) => {
            console.error("Failed to start server:", err);
        });
}
