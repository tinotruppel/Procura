/**
 * Google Slides MCP Server
 * Implements the Model Context Protocol for Google Slides operations
 *
 * Endpoint: /mcp/google-slides
 * Transport: Streamable HTTP via @hono/mcp
 */

import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { z } from "zod";
import { AsyncLocalStorage } from "async_hooks";
import {
    getAccessTokenForSession,
    createAuthHeaders,
    isGoogleConfigured,
    isValidSession,
} from "../lib/google-auth";

// =============================================================================
// Session context
// =============================================================================

const sessionStore = new AsyncLocalStorage<string>();

async function getToken(): Promise<string> {
    const session = sessionStore.getStore();
    if (!session) throw new Error("No Google session. Please connect your Google account.");
    return getAccessTokenForSession(session);
}

// =============================================================================
// Helpers
// =============================================================================

function extractTextFromShape(shape: Record<string, unknown>): string {
    const text = shape.text as { textElements?: Record<string, unknown>[] } | undefined;
    if (!text?.textElements) return "";
    return text.textElements.map((te) => (te.textRun as { content?: string } | undefined)?.content || "").join("").trim();
}

function summarizeSlide(page: Record<string, unknown>): Record<string, unknown> {
    const elements = (page.pageElements || []) as Record<string, unknown>[];
    const elementSummaries = elements.map((el) => {
        const elId = el.objectId as string;
        const shape = el.shape as Record<string, unknown> | undefined;
        const image = el.image as Record<string, unknown> | undefined;
        const table = el.table as Record<string, unknown> | undefined;
        if (shape) return { objectId: elId, type: "shape", shapeType: shape.shapeType, text: extractTextFromShape(shape) || undefined };
        if (image) return { objectId: elId, type: "image", sourceUrl: image.sourceUrl };
        if (table) return { objectId: elId, type: "table", rows: table.rows || 0, columns: table.columns || 0 };
        return { objectId: elId, type: "unknown" };
    });
    return { pageObjectId: page.objectId, elementCount: elements.length, elements: elementSummaries };
}

// =============================================================================
// MCP Server
// =============================================================================

const mcpServer = new McpServer({ name: "google-slides", version: "1.0.0" });
const configured = isGoogleConfigured();

if (configured) {
    mcpServer.registerTool("list_presentations", {
        description: "List user's Google Slides presentations",
        inputSchema: { query: z.string().optional().describe("Search query"), limit: z.number().optional().describe("Max results (default: 10, max: 50)") },
    }, async ({ query, limit: rawLimit }) => {
        const token = await getToken();
        const headers = createAuthHeaders(token);
        const limit = Math.min(rawLimit || 10, 50);
        let q = "mimeType='application/vnd.google-apps.presentation'";
        if (query) q += ` and fullText contains '${query.replace(/'/g, "\\'")}'`;
        const params = new URLSearchParams({ q, pageSize: limit.toString(), fields: "files(id,name,createdTime,modifiedTime,webViewLink)", orderBy: "modifiedTime desc" });
        const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers });
        if (!response.ok) { const e = (await response.json()) as { error?: { message?: string } }; throw new Error(e.error?.message || `API error: ${response.status}`); }
        const data = (await response.json()) as { files?: Array<Record<string, unknown>> };
        const files = (data.files || []).map((f) => ({ id: f.id, title: f.name, createdTime: f.createdTime, modifiedTime: f.modifiedTime, url: f.webViewLink }));
        return { content: [{ type: "text" as const, text: JSON.stringify({ presentations: files, count: files.length }, null, 2) }] };
    });

    mcpServer.registerTool("get_presentation", {
        description: "Get presentation metadata with slide summaries",
        inputSchema: { presentationId: z.string().describe("Presentation ID") },
    }, async ({ presentationId }) => {
        const token = await getToken();
        const headers = createAuthHeaders(token);
        const response = await fetch(`https://slides.googleapis.com/v1/presentations/${encodeURIComponent(presentationId)}`, { headers });
        if (!response.ok) { const e = (await response.json()) as { error?: { message?: string } }; throw new Error(e.error?.message || `API error: ${response.status}`); }
        const p = (await response.json()) as Record<string, unknown>;
        const slides = ((p.slides || []) as Record<string, unknown>[]).map(summarizeSlide);
        return { content: [{ type: "text" as const, text: JSON.stringify({ presentationId: p.presentationId, title: p.title, slideCount: slides.length, slides, locale: p.locale }, null, 2) }] };
    });

    mcpServer.registerTool("create_presentation", {
        description: "Create a new Google Slides presentation",
        inputSchema: { title: z.string().describe("Title") },
    }, async ({ title }) => {
        const token = await getToken();
        const headers = createAuthHeaders(token);
        const response = await fetch("https://slides.googleapis.com/v1/presentations", { method: "POST", headers, body: JSON.stringify({ title }) });
        if (!response.ok) { const e = (await response.json()) as { error?: { message?: string } }; throw new Error(e.error?.message || `API error: ${response.status}`); }
        const p = (await response.json()) as { presentationId: string; title: string; slides?: unknown[] };
        return { content: [{ type: "text" as const, text: JSON.stringify({ presentationId: p.presentationId, title: p.title, url: `https://docs.google.com/presentation/d/${p.presentationId}/edit`, slideCount: (p.slides || []).length }, null, 2) }] };
    });

    mcpServer.registerTool("add_slide", {
        description: "Add a new slide at an optional position with optional layout",
        inputSchema: { presentationId: z.string().describe("Presentation ID"), insertionIndex: z.number().optional().describe("0-based position"), layoutId: z.string().optional().describe("Layout ID") },
    }, async ({ presentationId, insertionIndex, layoutId }) => {
        const token = await getToken();
        const headers = createAuthHeaders(token);
        const req: Record<string, unknown> = {};
        if (insertionIndex !== undefined) req.insertionIndex = insertionIndex;
        if (layoutId) req.slideLayoutReference = { layoutId };
        const response = await fetch(`https://slides.googleapis.com/v1/presentations/${encodeURIComponent(presentationId)}:batchUpdate`, { method: "POST", headers, body: JSON.stringify({ requests: [{ createSlide: req }] }) });
        if (!response.ok) { const e = (await response.json()) as { error?: { message?: string } }; throw new Error(e.error?.message || `API error: ${response.status}`); }
        const result = (await response.json()) as { replies?: Array<{ createSlide?: { objectId?: string } }> };
        return { content: [{ type: "text" as const, text: JSON.stringify({ presentationId, newSlideId: result.replies?.[0]?.createSlide?.objectId, message: "Slide created" + (insertionIndex !== undefined ? ` at position ${insertionIndex}` : "") }, null, 2) }] };
    });

    mcpServer.registerTool("add_text", {
        description: "Insert text into a shape or text box on a slide",
        inputSchema: { presentationId: z.string().describe("Presentation ID"), objectId: z.string().describe("Shape/text box element ID"), text: z.string().describe("Text to insert"), insertionIndex: z.number().optional().describe("Position within text") },
    }, async ({ presentationId, objectId, text, insertionIndex }) => {
        const token = await getToken();
        const headers = createAuthHeaders(token);
        const req: Record<string, unknown> = { objectId, text };
        if (insertionIndex !== undefined) req.insertionIndex = insertionIndex;
        const response = await fetch(`https://slides.googleapis.com/v1/presentations/${encodeURIComponent(presentationId)}:batchUpdate`, { method: "POST", headers, body: JSON.stringify({ requests: [{ insertText: req }] }) });
        if (!response.ok) { const e = (await response.json()) as { error?: { message?: string } }; throw new Error(e.error?.message || `API error: ${response.status}`); }
        return { content: [{ type: "text" as const, text: JSON.stringify({ presentationId, objectId, message: `Inserted ${text.length} characters` }, null, 2) }] };
    });

    mcpServer.registerTool("add_image", {
        description: "Add an image from a public URL onto a slide",
        inputSchema: {
            presentationId: z.string().describe("Presentation ID"), pageObjectId: z.string().describe("Slide page ID"), imageUrl: z.string().describe("Public image URL"),
            width: z.number().optional().describe("Width in pt (default: 300)"), height: z.number().optional().describe("Height in pt (default: 300)"),
            x: z.number().optional().describe("X in pt (default: 100)"), y: z.number().optional().describe("Y in pt (default: 100)"),
        },
    }, async ({ presentationId, pageObjectId, imageUrl, width, height, x, y }) => {
        const token = await getToken();
        const headers = createAuthHeaders(token);
        const response = await fetch(`https://slides.googleapis.com/v1/presentations/${encodeURIComponent(presentationId)}:batchUpdate`, {
            method: "POST", headers,
            body: JSON.stringify({ requests: [{ createImage: { url: imageUrl, elementProperties: { pageObjectId, size: { width: { magnitude: width || 300, unit: "PT" }, height: { magnitude: height || 300, unit: "PT" } }, transform: { scaleX: 1, scaleY: 1, translateX: x || 100, translateY: y || 100, unit: "PT" } } } }] }),
        });
        if (!response.ok) { const e = (await response.json()) as { error?: { message?: string } }; throw new Error(e.error?.message || `API error: ${response.status}`); }
        const result = (await response.json()) as { replies?: Array<{ createImage?: { objectId?: string } }> };
        return { content: [{ type: "text" as const, text: JSON.stringify({ presentationId, imageObjectId: result.replies?.[0]?.createImage?.objectId, message: `Image added to slide "${pageObjectId}"` }, null, 2) }] };
    });

    mcpServer.registerTool("replace_text", {
        description: "Find and replace text across all slides",
        inputSchema: { presentationId: z.string().describe("Presentation ID"), searchText: z.string().describe("Text to find"), replaceText: z.string().describe("Replacement"), matchCase: z.boolean().optional().describe("Case-sensitive (default: false)") },
    }, async ({ presentationId, searchText, replaceText, matchCase }) => {
        const token = await getToken();
        const headers = createAuthHeaders(token);
        const response = await fetch(`https://slides.googleapis.com/v1/presentations/${encodeURIComponent(presentationId)}:batchUpdate`, {
            method: "POST", headers, body: JSON.stringify({ requests: [{ replaceAllText: { containsText: { text: searchText, matchCase: matchCase ?? false }, replaceText } }] }),
        });
        if (!response.ok) { const e = (await response.json()) as { error?: { message?: string } }; throw new Error(e.error?.message || `API error: ${response.status}`); }
        const result = (await response.json()) as { replies?: Array<{ replaceAllText?: { occurrencesChanged?: number } }> };
        const n = result.replies?.[0]?.replaceAllText?.occurrencesChanged || 0;
        return { content: [{ type: "text" as const, text: JSON.stringify({ presentationId, occurrencesReplaced: n, message: n > 0 ? `Replaced ${n} occurrence(s)` : "No occurrences found" }, null, 2) }] };
    });

    mcpServer.registerTool("delete_slide", {
        description: "Delete a slide from a presentation",
        inputSchema: { presentationId: z.string().describe("Presentation ID"), pageObjectId: z.string().describe("Slide page ID to delete") },
    }, async ({ presentationId, pageObjectId }) => {
        const token = await getToken();
        const headers = createAuthHeaders(token);
        const response = await fetch(`https://slides.googleapis.com/v1/presentations/${encodeURIComponent(presentationId)}:batchUpdate`, { method: "POST", headers, body: JSON.stringify({ requests: [{ deleteObject: { objectId: pageObjectId } }] }) });
        if (!response.ok) { const e = (await response.json()) as { error?: { message?: string } }; throw new Error(e.error?.message || `API error: ${response.status}`); }
        return { content: [{ type: "text" as const, text: JSON.stringify({ presentationId, deletedSlideId: pageObjectId, message: `Slide "${pageObjectId}" deleted` }, null, 2) }] };
    });
}

// =============================================================================
// HTTP Routes
// =============================================================================

export const googleSlidesMcpRoutes = new Hono();
const transport = new StreamableHTTPTransport();

googleSlidesMcpRoutes.all("/", async (c) => {
    if (!configured) return c.json({ error: "Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET." }, 503);

    const authHeader = c.req.header("Authorization") || "";
    const sessionToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

    if (!sessionToken || !(await isValidSession(sessionToken))) {
        c.header("WWW-Authenticate", 'Bearer scope="google"');
        return c.json({ error: "Google authentication required" }, 401);
    }

    if (!mcpServer.isConnected()) await mcpServer.connect(transport);
    return sessionStore.run(sessionToken, () => transport.handleRequest(c));
});

googleSlidesMcpRoutes.get("/info", async (c) => {
    return c.json({
        name: "google-slides", version: "1.0.0",
        status: configured ? "ready" : "not_configured", configured,
        tools: configured ? ["list_presentations", "get_presentation", "create_presentation", "add_slide", "add_text", "add_image", "replace_text", "delete_slide"] : [],
    });
});
