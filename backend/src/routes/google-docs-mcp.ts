/**
 * Google Docs MCP Server
 * Implements the Model Context Protocol for Google Docs operations
 *
 * Endpoint: /mcp/google-docs
 * Transport: Streamable HTTP via @hono/mcp
 *
 * Auth: Client sends `Authorization: Bearer <session_token>` (opaque token
 * issued during OAuth). The route handler extracts it and makes it available
 * to tool handlers via AsyncLocalStorage.
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
// Session context (per-request)
// =============================================================================

const sessionStore = new AsyncLocalStorage<string>();

/** Get a valid Google access token for the current request's session */
async function getToken(): Promise<string> {
    const session = sessionStore.getStore();
    if (!session) throw new Error("No Google session. Please connect your Google account.");
    return getAccessTokenForSession(session);
}

// =============================================================================
// Types
// =============================================================================

interface FormattingRequest {
    updateTextStyle?: {
        range: { startIndex: number; endIndex: number };
        textStyle: { bold?: boolean; italic?: boolean; link?: { url: string } };
        fields: string;
    };
    updateParagraphStyle?: {
        range: { startIndex: number; endIndex: number };
        paragraphStyle: { namedStyleType: string };
        fields: string;
    };
}

interface TableData {
    position: number;
    rows: string[][];
    numRows: number;
    numCols: number;
}

type AuthHeaders = { Authorization: string; "Content-Type": string };

// =============================================================================
// Helper Functions
// =============================================================================

function extractTextFromDocument(doc: Record<string, unknown>): string {
    const body = doc.body as { content?: Array<Record<string, unknown>> } | undefined;
    if (!body?.content) return "";
    const textParts: string[] = [];
    for (const element of body.content) {
        if (element.paragraph) {
            const paragraph = element.paragraph as { elements?: Array<Record<string, unknown>> };
            if (paragraph.elements) {
                for (const elem of paragraph.elements) {
                    if (elem.textRun) {
                        const textRun = elem.textRun as { content?: string };
                        if (textRun.content) textParts.push(textRun.content);
                    }
                }
            }
        }
    }
    return textParts.join("");
}

function getDocumentEndIndex(doc: Record<string, unknown>): number {
    const body = doc.body as { content?: Array<{ endIndex?: number }> } | undefined;
    if (!body?.content || body.content.length === 0) return 1;
    return (body.content[body.content.length - 1].endIndex || 1) - 1;
}

function parseMarkdownToRequests(
    markdown: string,
    startIndex: number
): { plainText: string; requests: FormattingRequest[]; tables: TableData[] } {
    const requests: FormattingRequest[] = [];
    const parsedTables: TableData[] = [];
    let plainText = markdown;

    // Extract tables
    const tables: { match: string; rows: string[][] }[] = [];
    const allLines = plainText.split("\n");
    let lineIndex = 0;
    while (lineIndex < allLines.length) {
        const line = allLines[lineIndex];
        if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
            if (lineIndex + 1 < allLines.length && /^\|[-:| ]+\|$/.test(allLines[lineIndex + 1].trim())) {
                const tableLines: string[] = [line];
                let tableEndIndex = lineIndex + 1;
                for (let i = lineIndex + 1; i < allLines.length; i++) {
                    if (allLines[i].trim().startsWith("|") && allLines[i].trim().endsWith("|")) {
                        tableLines.push(allLines[i]);
                        tableEndIndex = i;
                    } else break;
                }
                const rows: string[][] = [];
                for (let i = 0; i < tableLines.length; i++) {
                    if (i === 1) continue;
                    rows.push(tableLines[i].split("|").slice(1, -1).map((cell) => cell.trim()));
                }
                tables.push({ match: tableLines.join("\n"), rows });
                lineIndex = tableEndIndex + 1;
                continue;
            }
        }
        lineIndex++;
    }
    for (const table of tables) {
        plainText = plainText.replace(table.match, `__TABLE_${tables.indexOf(table)}__`);
    }

    const lines = plainText.split("\n");
    let currentIndex = startIndex;
    const processedLines: string[] = [];
    const headingRanges: { start: number; end: number; level: number }[] = [];
    const tablePositions: { index: number; tableIdx: number }[] = [];

    for (const line of lines) {
        const headingMatch = /^(#{1,3})\s+(.+)$/.exec(line);
        const hrMatch = /^---+$/.exec(line);
        const tableMatch = /^__TABLE_(\d+)__$/.exec(line);
        if (headingMatch) {
            const level = headingMatch[1].length;
            const text = headingMatch[2];
            headingRanges.push({ start: currentIndex, end: currentIndex + text.length + 1, level });
            processedLines.push(text);
            currentIndex += text.length + 1;
        } else if (hrMatch) {
            const visualLine = "────────────────────────────────────────";
            processedLines.push(visualLine);
            currentIndex += visualLine.length + 1;
        } else if (tableMatch) {
            tablePositions.push({ index: currentIndex, tableIdx: parseInt(tableMatch[1], 10) });
            processedLines.push("");
            currentIndex += 1;
        } else {
            processedLines.push(line);
            currentIndex += line.length + 1;
        }
    }
    plainText = processedLines.join("\n");

    for (const pos of [...tablePositions].reverse()) {
        const table = tables[pos.tableIdx];
        if (!table) continue;
        parsedTables.push({ position: pos.index, rows: table.rows, numRows: table.rows.length, numCols: table.rows[0]?.length || 1 });
    }

    for (const h of headingRanges) {
        const styleType = h.level === 1 ? "HEADING_1" : h.level === 2 ? "HEADING_2" : "HEADING_3";
        requests.push({ updateParagraphStyle: { range: { startIndex: h.start, endIndex: h.end }, paragraphStyle: { namedStyleType: styleType }, fields: "namedStyleType" } });
    }

    // Bold
    let match;
    let offset = 0;
    const boldRanges: { start: number; end: number }[] = [];
    const boldRegex = /\*\*(.+?)\*\*/g;
    while ((match = boldRegex.exec(plainText)) !== null) {
        boldRanges.push({ start: startIndex + match.index - offset, end: startIndex + match.index - offset + match[1].length });
        offset += 4;
    }
    plainText = plainText.replace(/\*\*(.+?)\*\*/g, "$1");

    // Italic
    offset = 0;
    const italicRanges: { start: number; end: number }[] = [];
    const italicRegex = /(?<!\*)\*([^*]+?)\*(?!\*)/g;
    while ((match = italicRegex.exec(plainText)) !== null) {
        italicRanges.push({ start: startIndex + match.index - offset, end: startIndex + match.index - offset + match[1].length });
        offset += 2;
    }
    plainText = plainText.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, "$1");

    // Links
    offset = 0;
    const linkRanges: { start: number; end: number; url: string }[] = [];
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    while ((match = linkRegex.exec(plainText)) !== null) {
        linkRanges.push({ start: startIndex + match.index - offset, end: startIndex + match.index - offset + match[1].length, url: match[2] });
        offset += match[0].length - match[1].length;
    }
    plainText = plainText.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");

    for (const r of boldRanges) requests.push({ updateTextStyle: { range: { startIndex: r.start, endIndex: r.end }, textStyle: { bold: true }, fields: "bold" } });
    for (const r of italicRanges) requests.push({ updateTextStyle: { range: { startIndex: r.start, endIndex: r.end }, textStyle: { italic: true }, fields: "italic" } });
    for (const r of linkRanges) requests.push({ updateTextStyle: { range: { startIndex: r.start, endIndex: r.end }, textStyle: { link: { url: r.url } }, fields: "link" } });

    return { plainText, requests, tables: parsedTables };
}

async function insertTablesIntoDocument(documentId: string, tables: TableData[], headers: AuthHeaders): Promise<void> {
    if (tables.length === 0) return;
    const initialDocResponse = await fetch(`https://docs.googleapis.com/v1/documents/${documentId}`, { method: "GET", headers });
    if (!initialDocResponse.ok) return;
    const initialDoc = await initialDocResponse.json();
    const docEndIndex = getDocumentEndIndex(initialDoc as Record<string, unknown>);

    for (const table of tables) {
        const insertTableResponse = await fetch(`https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`, {
            method: "POST", headers, body: JSON.stringify({ requests: [{ insertTable: { location: { index: docEndIndex }, rows: table.numRows, columns: table.numCols } }] }),
        });
        if (!insertTableResponse.ok) continue;

        const docResponse = await fetch(`https://docs.googleapis.com/v1/documents/${documentId}`, { method: "GET", headers });
        if (!docResponse.ok) continue;
        const doc = await docResponse.json();
        const bodyContent = (doc as Record<string, unknown>).body as { content?: unknown[] } | undefined;
        const cellIndices = findTableCells(bodyContent?.content || [], table.position);
        const cellRequests: unknown[] = [];

        for (let rowIdx = table.rows.length - 1; rowIdx >= 0; rowIdx--) {
            for (let colIdx = table.rows[rowIdx].length - 1; colIdx >= 0; colIdx--) {
                const cellText = table.rows[rowIdx][colIdx];
                const cellIndex = cellIndices[rowIdx]?.[colIdx];
                if (typeof cellIndex !== "undefined" && cellText) {
                    cellRequests.push({ insertText: { location: { index: cellIndex }, text: cellText } });
                }
            }
        }
        if (cellRequests.length > 0) {
            await fetch(`https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`, { method: "POST", headers, body: JSON.stringify({ requests: cellRequests }) });
        }
    }
}

function findTableCells(content: unknown[], tablePosition: number): number[][] {
    const cellIndices: number[][] = [];
    for (const element of content) {
        const el = element as { table?: { tableRows?: unknown[] }; startIndex?: number };
        if (el.table && el.startIndex !== undefined && el.startIndex >= tablePosition - 1) {
            for (const row of (el.table.tableRows || []) as unknown[]) {
                const rowCells: number[] = [];
                const tableRow = row as { tableCells?: unknown[] };
                for (const cell of (tableRow.tableCells || []) as unknown[]) {
                    const tableCell = cell as { content?: { paragraph?: { elements?: { startIndex?: number }[] } }[] };
                    const para = tableCell.content?.[0] as { paragraph?: { elements?: { startIndex?: number }[] } } | undefined;
                    if (para?.paragraph?.elements?.[0]?.startIndex !== undefined) rowCells.push(para.paragraph.elements[0].startIndex);
                }
                if (rowCells.length > 0) cellIndices.push(rowCells);
            }
            break;
        }
    }
    return cellIndices;
}

// =============================================================================
// MCP Server Setup
// =============================================================================

const mcpServer = new McpServer({ name: "google-docs", version: "1.0.0" });
const configured = isGoogleConfigured();

if (configured) {
    mcpServer.registerTool("list_documents", {
        description: "List user's Google Docs documents",
        inputSchema: {
            query: z.string().optional().describe("Search query to filter documents"),
            limit: z.number().optional().describe("Max results (default: 10, max: 50)"),
        },
    }, async ({ query, limit: rawLimit }) => {
        const token = await getToken();
        const headers = createAuthHeaders(token);
        const limit = Math.min(rawLimit || 10, 50);
        let searchQuery = "mimeType='application/vnd.google-apps.document'";
        if (query) searchQuery += ` and fullText contains '${query.replace(/'/g, "\\'")}'`;
        const params = new URLSearchParams({ q: searchQuery, pageSize: limit.toString(), fields: "files(id,name,createdTime,modifiedTime,webViewLink)", orderBy: "modifiedTime desc" });
        const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { method: "GET", headers });
        if (!response.ok) { const error = await response.text(); throw new Error(`Failed to list documents: ${response.status} ${error}`); }
        const data = (await response.json()) as { files?: Array<Record<string, unknown>> };
        const files = (data.files || []).map((f) => ({ id: f.id, title: f.name, createdTime: f.createdTime, modifiedTime: f.modifiedTime, url: f.webViewLink }));
        return { content: [{ type: "text" as const, text: JSON.stringify({ documents: files, count: files.length }, null, 2) }] };
    });

    mcpServer.registerTool("get_document", {
        description: "Get a Google Docs document's metadata and full text content",
        inputSchema: { documentId: z.string().describe("Document ID") },
    }, async ({ documentId }) => {
        const token = await getToken();
        const headers = createAuthHeaders(token);
        const response = await fetch(`https://docs.googleapis.com/v1/documents/${documentId}`, { method: "GET", headers });
        if (!response.ok) { const error = await response.text(); throw new Error(`Failed to get document: ${response.status} ${error}`); }
        const doc = (await response.json()) as Record<string, unknown>;
        return { content: [{ type: "text" as const, text: JSON.stringify({ documentId: doc.documentId, title: doc.title, content: extractTextFromDocument(doc), revisionId: doc.revisionId }, null, 2) }] };
    });

    mcpServer.registerTool("create_document", {
        description: "Create a new Google Docs document with optional markdown content",
        inputSchema: {
            title: z.string().describe("Title for the new document"),
            content: z.string().optional().describe("Markdown content (**bold**, *italic*, # headings, [links](url), tables)"),
        },
    }, async ({ title, content }) => {
        const token = await getToken();
        const headers = createAuthHeaders(token);
        const createResponse = await fetch("https://docs.googleapis.com/v1/documents", { method: "POST", headers, body: JSON.stringify({ title }) });
        if (!createResponse.ok) { const error = await createResponse.text(); throw new Error(`Failed to create document: ${createResponse.status} ${error}`); }
        const newDoc = (await createResponse.json()) as { documentId: string; title: string };
        if (content) {
            const { plainText, requests: fmtReqs, tables } = parseMarkdownToRequests(content, 1);
            await fetch(`https://docs.googleapis.com/v1/documents/${newDoc.documentId}:batchUpdate`, { method: "POST", headers, body: JSON.stringify({ requests: [{ insertText: { location: { index: 1 }, text: plainText } }, ...fmtReqs] }) });
            if (tables.length > 0) await insertTablesIntoDocument(newDoc.documentId, tables, headers);
        }
        return { content: [{ type: "text" as const, text: JSON.stringify({ documentId: newDoc.documentId, title: newDoc.title, url: `https://docs.google.com/document/d/${newDoc.documentId}/edit`, message: content ? `Created "${title}" with formatted content` : `Created empty document "${title}"` }, null, 2) }] };
    });

    mcpServer.registerTool("append_text", {
        description: "Append markdown-formatted text to the end of a document",
        inputSchema: { documentId: z.string().describe("Document ID"), content: z.string().describe("Markdown content to append") },
    }, async ({ documentId, content }) => {
        const token = await getToken();
        const headers = createAuthHeaders(token);
        const getResponse = await fetch(`https://docs.googleapis.com/v1/documents/${documentId}`, { method: "GET", headers });
        if (!getResponse.ok) throw new Error(`Failed to get document: ${getResponse.status}`);
        const doc = (await getResponse.json()) as Record<string, unknown>;
        const endIndex = getDocumentEndIndex(doc);
        const { plainText, requests: fmtReqs, tables } = parseMarkdownToRequests(content, endIndex);
        await fetch(`https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`, { method: "POST", headers, body: JSON.stringify({ requests: [{ insertText: { location: { index: endIndex }, text: plainText } }, ...fmtReqs] }) });
        if (tables.length > 0) await insertTablesIntoDocument(documentId, tables, headers);
        return { content: [{ type: "text" as const, text: JSON.stringify({ documentId, message: `Appended ${plainText.length} characters`, url: `https://docs.google.com/document/d/${documentId}/edit` }, null, 2) }] };
    });

    mcpServer.registerTool("replace_text", {
        description: "Find and replace text in a document (supports markdown in replacement)",
        inputSchema: {
            documentId: z.string().describe("Document ID"),
            searchText: z.string().describe("Text to search for"),
            replaceText: z.string().describe("Replacement text (markdown, empty to delete)"),
            matchCase: z.boolean().optional().describe("Case-sensitive (default: false)"),
        },
    }, async ({ documentId, searchText, replaceText, matchCase }) => {
        const token = await getToken();
        const headers = createAuthHeaders(token);
        const caseSensitive = matchCase ?? false;
        const getResponse = await fetch(`https://docs.googleapis.com/v1/documents/${documentId}`, { method: "GET", headers });
        if (!getResponse.ok) throw new Error(`Failed to get document: ${getResponse.status}`);
        const doc = (await getResponse.json()) as Record<string, unknown>;
        const documentText = extractTextFromDocument(doc);
        const occurrences: { startIndex: number; endIndex: number }[] = [];
        let searchIndex = 0;
        const searchLower = caseSensitive ? searchText : searchText.toLowerCase();
        const textToSearch = caseSensitive ? documentText : documentText.toLowerCase();
        while ((searchIndex = textToSearch.indexOf(searchLower, searchIndex)) !== -1) {
            occurrences.push({ startIndex: searchIndex + 1, endIndex: searchIndex + 1 + searchText.length });
            searchIndex += searchText.length;
        }
        if (occurrences.length === 0) return { content: [{ type: "text" as const, text: JSON.stringify({ documentId, occurrencesReplaced: 0, message: `No occurrences of "${searchText}" found` }, null, 2) }] };
        const allRequests: unknown[] = [];
        const allTables: TableData[] = [];
        for (const occ of [...occurrences].reverse()) {
            const { plainText, requests: fmtReqs, tables } = parseMarkdownToRequests(replaceText, occ.startIndex);
            allTables.push(...tables);
            allRequests.push({ deleteContentRange: { range: { startIndex: occ.startIndex, endIndex: occ.endIndex } } });
            if (plainText.length > 0) { allRequests.push({ insertText: { location: { index: occ.startIndex }, text: plainText } }); allRequests.push(...fmtReqs); }
        }
        await fetch(`https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`, { method: "POST", headers, body: JSON.stringify({ requests: allRequests }) });
        if (allTables.length > 0) await insertTablesIntoDocument(documentId, allTables, headers);
        return { content: [{ type: "text" as const, text: JSON.stringify({ documentId, occurrencesReplaced: occurrences.length, message: `Replaced ${occurrences.length} occurrence(s)` }, null, 2) }] };
    });

    mcpServer.registerTool("rename_document", {
        description: "Rename a Google Docs document",
        inputSchema: { documentId: z.string().describe("Document ID"), title: z.string().describe("New title") },
    }, async ({ documentId, title }) => {
        const token = await getToken();
        const headers = createAuthHeaders(token);
        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${documentId}`, { method: "PATCH", headers, body: JSON.stringify({ name: title }) });
        if (!response.ok) throw new Error(`Failed to rename: ${response.status}`);
        return { content: [{ type: "text" as const, text: JSON.stringify({ documentId, title, message: `Renamed to "${title}"` }, null, 2) }] };
    });
}

// =============================================================================
// HTTP Routes
// =============================================================================

export const googleDocsMcpRoutes = new Hono();
const transport = new StreamableHTTPTransport();

googleDocsMcpRoutes.all("/", async (c) => {
    if (!configured) return c.json({ error: "Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET." }, 503);

    // Extract session token from Authorization header
    const authHeader = c.req.header("Authorization") || "";
    const sessionToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

    // Require valid session token — return 401 so frontend shows Login button
    if (!sessionToken || !(await isValidSession(sessionToken))) {
        c.header("WWW-Authenticate", 'Bearer scope="google"');
        return c.json({ error: "Google authentication required" }, 401);
    }

    if (!mcpServer.isConnected()) await mcpServer.connect(transport);
    return sessionStore.run(sessionToken, () => transport.handleRequest(c));
});

googleDocsMcpRoutes.get("/info", async (c) => {
    return c.json({
        name: "google-docs", version: "1.0.0",
        status: configured ? "ready" : "not_configured", configured,
        tools: configured ? ["list_documents", "get_document", "create_document", "append_text", "replace_text", "rename_document"] : [],
    });
});
