/**
 * Google Drive MCP Server
 * Implements the Model Context Protocol for Google Drive operations
 *
 * Endpoint: /mcp/google-drive
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
    isGoogleConfiguredAsync,
    isValidSession,
    buildGoogleWwwAuthenticate,
    buildGoogleResourceMetadata,
} from "../lib/google-auth";
import { getMcpMethod, isDiscoveryMethod } from "../lib/mcp-lazy-auth";

// =============================================================================
// Session context
// =============================================================================

interface SessionContext {
    session: string;
    apiKey: string;
}

const sessionStore = new AsyncLocalStorage<SessionContext>();

async function getToken(): Promise<string> {
    const ctx = sessionStore.getStore();
    if (!ctx) throw new Error("No Google session. Please connect your Google account.");
    return getAccessTokenForSession(ctx.session, ctx.apiKey);
}

// =============================================================================
// Helpers
// =============================================================================

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

async function driveRequest(path: string, token: string, init?: RequestInit): Promise<unknown> {
    const headers = { ...createAuthHeaders(token), ...(init?.headers || {}) };
    const response = await fetch(`${DRIVE_API}${path}`, { ...init, headers });
    if (!response.ok) {
        const e = (await response.json()) as { error?: { message?: string } };
        throw new Error(e.error?.message || `Drive API error: ${response.status}`);
    }
    return response.json();
}

// =============================================================================
// MCP Server
// =============================================================================

const mcpServer = new McpServer({ name: "google-drive", version: "1.0.0" });

mcpServer.registerTool("list_files", {
    description: "List or search files and folders in Google Drive",
    inputSchema: {
        query: z.string().optional().describe("Search query (Drive query syntax, e.g. \"name contains 'report'\")"),
        folderId: z.string().optional().describe("Folder ID to list contents of (default: root)"),
        mimeType: z.string().optional().describe("Filter by MIME type (e.g. 'application/pdf', 'image/png')"),
        limit: z.number().optional().describe("Max results (default: 20, max: 100)"),
        pageToken: z.string().optional().describe("Page token for next page of results"),
    },
}, async ({ query, folderId, mimeType, limit: rawLimit, pageToken }) => {
    const token = await getToken();
    const limit = Math.min(rawLimit || 20, 100);

    const qParts: string[] = ["trashed = false"];
    if (folderId) qParts.push(`'${folderId}' in parents`);
    if (mimeType) qParts.push(`mimeType = '${mimeType}'`);
    if (query) qParts.push(query);

    const params = new URLSearchParams({
        q: qParts.join(" and "),
        pageSize: limit.toString(),
        fields: "nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime,parents,webViewLink,iconLink)",
        orderBy: "modifiedTime desc",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const data = await driveRequest(`/files?${params}`, token) as {
        files?: Array<Record<string, unknown>>;
        nextPageToken?: string;
    };

    const files = (data.files || []).map((f) => ({
        id: f.id, name: f.name, mimeType: f.mimeType,
        size: f.size, createdTime: f.createdTime, modifiedTime: f.modifiedTime,
        parents: f.parents, url: f.webViewLink,
    }));

    return { content: [{ type: "text" as const, text: JSON.stringify({ files, count: files.length, nextPageToken: data.nextPageToken || undefined }, null, 2) }] };
});

mcpServer.registerTool("get_file_metadata", {
    description: "Get detailed metadata for a file or folder",
    inputSchema: { fileId: z.string().describe("File or folder ID") },
}, async ({ fileId }) => {
    const token = await getToken();
    const fields = "id,name,mimeType,size,createdTime,modifiedTime,parents,webViewLink,webContentLink,description,starred,shared,owners,capabilities";
    const data = await driveRequest(`/files/${encodeURIComponent(fileId)}?fields=${fields}`, token);
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
});

mcpServer.registerTool("download_file", {
    description: "Download file content. Returns text for text-based files, base64 for binary files. For Google Workspace files (Docs, Sheets, Slides), exports as PDF by default.",
    inputSchema: {
        fileId: z.string().describe("File ID"),
        exportMimeType: z.string().optional().describe("Export MIME type for Google Workspace files (default: application/pdf). Use text/plain for Docs text, text/csv for Sheets."),
    },
}, async ({ fileId, exportMimeType }) => {
    const token = await getToken();
    const headers = createAuthHeaders(token);

    // First get metadata to determine file type
    const meta = await driveRequest(`/files/${encodeURIComponent(fileId)}?fields=mimeType,name,size`, token) as { mimeType: string; name: string; size?: string };
    const isGoogleDoc = meta.mimeType.startsWith("application/vnd.google-apps.");

    let response: Response;
    if (isGoogleDoc) {
        const exportType = exportMimeType || "application/pdf";
        response = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportType)}`, { headers });
    } else {
        response = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`, { headers });
    }

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Download failed: ${response.status} ${errText}`);
    }

    const contentType = response.headers.get("content-type") || "";
    const isText = contentType.startsWith("text/") || contentType.includes("json") || contentType.includes("xml") || contentType.includes("csv");

    if (isText) {
        const text = await response.text();
        return { content: [{ type: "text" as const, text: JSON.stringify({ name: meta.name, mimeType: contentType, content: text }, null, 2) }] };
    }

    // Binary: return as base64
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    return { content: [{ type: "text" as const, text: JSON.stringify({ name: meta.name, mimeType: contentType, encoding: "base64", sizeBytes: buffer.byteLength, content: base64 }, null, 2) }] };
});

mcpServer.registerTool("upload_file", {
    description: "Upload a file to Google Drive. Content must be base64-encoded.",
    inputSchema: {
        name: z.string().describe("File name including extension"),
        content: z.string().describe("Base64-encoded file content"),
        mimeType: z.string().describe("MIME type (e.g. 'application/pdf', 'image/png')"),
        parentFolderId: z.string().optional().describe("Parent folder ID (default: root)"),
        description: z.string().optional().describe("File description"),
    },
}, async ({ name, content, mimeType, parentFolderId, description }) => {
    const token = await getToken();
    const headers = createAuthHeaders(token);

    const metadata: Record<string, unknown> = { name, mimeType };
    if (parentFolderId) metadata.parents = [parentFolderId];
    if (description) metadata.description = description;

    const boundary = "---procura-upload-boundary---";
    const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\nContent-Type: ${mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n${content}\r\n` +
        `--${boundary}--`;

    const response = await fetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink`, {
        method: "POST",
        headers: { ...headers, "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
    });

    if (!response.ok) {
        const e = (await response.json()) as { error?: { message?: string } };
        throw new Error(e.error?.message || `Upload failed: ${response.status}`);
    }

    const file = (await response.json()) as Record<string, unknown>;
    return { content: [{ type: "text" as const, text: JSON.stringify({ id: file.id, name: file.name, mimeType: file.mimeType, size: file.size, url: file.webViewLink, message: `File "${name}" uploaded successfully` }, null, 2) }] };
});

mcpServer.registerTool("create_folder", {
    description: "Create a new folder in Google Drive",
    inputSchema: {
        name: z.string().describe("Folder name"),
        parentFolderId: z.string().optional().describe("Parent folder ID (default: root)"),
    },
}, async ({ name, parentFolderId }) => {
    const token = await getToken();
    const headers = createAuthHeaders(token);

    const metadata: Record<string, unknown> = { name, mimeType: "application/vnd.google-apps.folder" };
    if (parentFolderId) metadata.parents = [parentFolderId];

    const response = await fetch(`${DRIVE_API}/files?fields=id,name,mimeType,webViewLink`, {
        method: "POST", headers, body: JSON.stringify(metadata),
    });

    if (!response.ok) {
        const e = (await response.json()) as { error?: { message?: string } };
        throw new Error(e.error?.message || `Create folder failed: ${response.status}`);
    }

    const folder = (await response.json()) as Record<string, unknown>;
    return { content: [{ type: "text" as const, text: JSON.stringify({ id: folder.id, name: folder.name, url: folder.webViewLink, message: `Folder "${name}" created` }, null, 2) }] };
});

mcpServer.registerTool("move_file", {
    description: "Move a file or folder to a different parent folder",
    inputSchema: {
        fileId: z.string().describe("File or folder ID to move"),
        newParentId: z.string().describe("Destination folder ID"),
    },
}, async ({ fileId, newParentId }) => {
    const token = await getToken();
    const headers = createAuthHeaders(token);

    // Get current parents
    const meta = await driveRequest(`/files/${encodeURIComponent(fileId)}?fields=parents`, token) as { parents?: string[] };
    const previousParents = (meta.parents || []).join(",");

    const params = new URLSearchParams({
        addParents: newParentId,
        removeParents: previousParents,
        fields: "id,name,parents,webViewLink",
    });

    const response = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?${params}`, {
        method: "PATCH", headers, body: JSON.stringify({}),
    });

    if (!response.ok) {
        const e = (await response.json()) as { error?: { message?: string } };
        throw new Error(e.error?.message || `Move failed: ${response.status}`);
    }

    const file = (await response.json()) as Record<string, unknown>;
    return { content: [{ type: "text" as const, text: JSON.stringify({ id: file.id, name: file.name, newParents: file.parents, url: file.webViewLink, message: "File moved successfully" }, null, 2) }] };
});

mcpServer.registerTool("delete_file", {
    description: "Move a file or folder to trash",
    inputSchema: { fileId: z.string().describe("File or folder ID to trash") },
}, async ({ fileId }) => {
    const token = await getToken();
    const headers = createAuthHeaders(token);

    const response = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}`, {
        method: "PATCH", headers, body: JSON.stringify({ trashed: true }),
    });

    if (!response.ok) {
        const e = (await response.json()) as { error?: { message?: string } };
        throw new Error(e.error?.message || `Delete failed: ${response.status}`);
    }

    return { content: [{ type: "text" as const, text: JSON.stringify({ fileId, message: "File moved to trash" }, null, 2) }] };
});

// =============================================================================
// HTTP Routes
// =============================================================================

export const googleDriveMcpRoutes = new Hono();
const transport = new StreamableHTTPTransport();

googleDriveMcpRoutes.all("/", async (c) => {
    const apiKey = c.req.header("X-API-Key") || undefined;
    const configured = await isGoogleConfiguredAsync(apiKey);

    if (!configured) return c.json({ error: "Google OAuth not configured. Store GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in vault or set as environment variables." }, 503);

    // Allow tool discovery without OAuth session (lazy auth)
    const method = await getMcpMethod(c.req);
    const discovery = isDiscoveryMethod(method);

    const authHeader = c.req.header("Authorization") || "";
    const sessionToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

    if (!discovery && (!sessionToken || !(await isValidSession(sessionToken)))) {
        c.header("WWW-Authenticate", buildGoogleWwwAuthenticate(c, "/mcp/google-drive"));
        return c.json({ error: "Google authentication required" }, 401);
    }

    if (!mcpServer.isConnected()) await mcpServer.connect(transport);

    // Discovery requests don't need a session context
    if (discovery) return transport.handleRequest(c);
    return sessionStore.run({ session: sessionToken, apiKey: apiKey! }, () => transport.handleRequest(c));
});

googleDriveMcpRoutes.get("/.well-known/oauth-protected-resource", (c) => {
    return c.json(buildGoogleResourceMetadata(c, "/mcp/google-drive"));
});

googleDriveMcpRoutes.get("/info", async (c) => {
    const apiKey = c.req.header("X-API-Key") || undefined;
    const configured = await isGoogleConfiguredAsync(apiKey);
    return c.json({
        name: "google-drive", version: "1.0.0",
        status: configured ? "ready" : "not_configured", configured,
        tools: ["list_files", "get_file_metadata", "download_file", "upload_file", "create_folder", "move_file", "delete_file"],
        note: configured ? undefined : "Store GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in vault or set as environment variables",
    });
});
