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
 *   GET    /mcp/knowledge-base        - Knowledge Base MCP server (semantic search)
 *   GET    /mcp/document-media        - Document/Media MCP server (OCR, transcription)
 *   GET    /mcp/github                - GitHub MCP server (read-only)
 *   GET    /mcp/image-generation       - Image Generation MCP server (Imagen AI)
 *   GET    /mcp/google-docs            - Google Docs MCP server
 *   GET    /mcp/google-sheets          - Google Sheets MCP server
 *   GET    /mcp/google-slides          - Google Slides MCP server
 */

import { Hono } from "hono";
import { createCorsMiddleware } from "./middleware/cors";
import { authMiddleware } from "./middleware/auth";
import { rateLimitMiddleware } from "./middleware/rate-limit";
import { syncRoutes } from "./routes/sync";
import { mcpProxyRoutes } from "./routes/mcp-proxy";
import { tasksMcpRoutes } from "./routes/tasks-mcp";
import { weatherMcpRoutes } from "./routes/weather-mcp";
import { cvDatabaseMcpRoutes } from "./routes/cv-database-mcp";
import { knowledgeBaseMcpRoutes } from "./routes/knowledge-base-mcp";
import { documentMediaMcpRoutes } from "./routes/document-media-mcp";
import { githubMcpRoutes } from "./routes/github-mcp";
import { imageGenerationMcpRoutes } from "./routes/image-generation-mcp";
import { googleDocsMcpRoutes } from "./routes/google-docs-mcp";
import { googleSheetsMcpRoutes } from "./routes/google-sheets-mcp";
import { googleSlidesMcpRoutes } from "./routes/google-slides-mcp";
import { googleOAuthRoutes } from "./routes/google-oauth";
import { mcpDirectoryRoutes } from "./routes/mcp-directory";
import { getConfig } from "./config";
import { getPool } from "./db/connection";

// Create main app
const app = new Hono();

// Global middleware
app.use("*", createCorsMiddleware());
app.use("*", rateLimitMiddleware);

// Apply auth to protected routes BEFORE mounting them
app.use("/sync/*", authMiddleware);
app.use("/mcp-proxy/*", authMiddleware);
app.use("/mcp-directory/*", authMiddleware);
app.use("/mcp/*", authMiddleware);
app.use("/auth/google/status", authMiddleware);
app.use("/auth/google/disconnect", authMiddleware);
// Note: /auth/google/callback is NOT auth-protected — Google redirects users there
// Note: /.well-known/*, /authorize, /token, /register are NOT auth-protected — OAuth flow endpoints

// Mount routes
app.route("/sync", syncRoutes);
app.route("/mcp-proxy", mcpProxyRoutes);
app.route("/mcp-directory", mcpDirectoryRoutes);
// When adding new MCP routes, also update mcp-directory.ts
app.route("/mcp/tasks", tasksMcpRoutes);
app.route("/mcp/weather", weatherMcpRoutes);
app.route("/mcp/cv-database", cvDatabaseMcpRoutes);
app.route("/mcp/knowledge-base", knowledgeBaseMcpRoutes);
app.route("/mcp/document-media", documentMediaMcpRoutes);
app.route("/mcp/github", githubMcpRoutes);
app.route("/mcp/image-generation", imageGenerationMcpRoutes);
app.route("/mcp/google-docs", googleDocsMcpRoutes);
app.route("/mcp/google-sheets", googleSheetsMcpRoutes);
app.route("/mcp/google-slides", googleSlidesMcpRoutes);
// OAuth AS: mount at root so endpoints are at /.well-known/*, /authorize, /token, /register, /auth/google/*
app.route("/", googleOAuthRoutes);

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

// Error handler
app.onError((err, c) => {
    console.error("Unhandled error:", err);
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
            console.log(`🚀 Server running on port ${port} (Node.js)`);
        })
        .catch((err) => {
            console.error("Failed to start server:", err);
        });
}
