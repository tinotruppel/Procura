/**
 * MCP Directory Endpoint
 *
 * Returns a list of all available MCP server endpoints.
 * Allows clients to discover and auto-register all MCP services
 * from a single URL.
 *
 * Endpoint: /mcp-directory
 */

import { Hono } from "hono";

// =============================================================================
// Types
// =============================================================================

export interface McpServerEntry {
    name: string;
    title: string;
    endpoint: string;
    description: string;
}

// =============================================================================
// Server Registry
// =============================================================================

export const MCP_SERVERS: McpServerEntry[] = [
    {
        name: "tasks",
        title: "Task Management",
        endpoint: "/mcp/tasks",
        description: "Trello-based task and ticket management (projects, tickets, comments, attachments)",
    },
    {
        name: "weather",
        title: "Weather",
        endpoint: "/mcp/weather",
        description: "Current weather and multi-day forecast via OpenWeatherMap",
    },
    {
        name: "cv-database",
        title: "CV Database",
        endpoint: "/mcp/cv-database",
        description: "Resume and candidate search with semantic vector matching",
    },
    {
        name: "knowledge-base",
        title: "Knowledge Base",
        endpoint: "/mcp/knowledge-base",
        description: "Semantic search over documents and knowledge articles",
    },
    {
        name: "document-media",
        title: "Document & Media",
        endpoint: "/mcp/document-media",
        description: "OCR, document parsing, audio/video transcription",
    },
    {
        name: "github",
        title: "GitHub",
        endpoint: "/mcp/github",
        description: "Read-only GitHub access (repos, issues, PRs, code search)",
    },
    {
        name: "image-generation",
        title: "Image Generation",
        endpoint: "/mcp/image-generation",
        description: "AI image generation via Google Imagen",
    },
    {
        name: "google-docs",
        title: "Google Docs",
        endpoint: "/mcp/google-docs",
        description: "Read, create, and edit Google Docs documents with markdown formatting",
    },
    {
        name: "google-sheets",
        title: "Google Sheets",
        endpoint: "/mcp/google-sheets",
        description: "Manage Google Sheets spreadsheets (read, write, append, broadcast fill)",
    },
    {
        name: "google-slides",
        title: "Google Slides",
        endpoint: "/mcp/google-slides",
        description: "Manage Google Slides presentations (slides, text, images, find & replace)",
    },
    {
        name: "gmail",
        title: "Gmail",
        endpoint: "/mcp/gmail",
        description: "Search, read, send, and manage Gmail emails and labels",
    },
    {
        name: "google-calendar",
        title: "Google Calendar",
        endpoint: "/mcp/google-calendar",
        description: "Manage Google Calendar events (list, create, update, delete)",
    },
];

// =============================================================================
// Route
// =============================================================================

export const mcpDirectoryRoutes = new Hono();

mcpDirectoryRoutes.get("/", (c) => {
    return c.json({ servers: MCP_SERVERS });
});
