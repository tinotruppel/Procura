/**
 * Google Sheets MCP Server
 * Implements the Model Context Protocol for Google Sheets operations
 *
 * Endpoint: /mcp/google-sheets
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

function columnToNumber(col: string): number {
    let num = 0;
    for (let i = 0; i < col.length; i++) num = num * 26 + (col.charCodeAt(i) - 64);
    return num;
}

function parseRangeDimensions(range: string): { rows: number; cols: number } | null {
    const m = /([A-Z]{1,3})(\d+)?:([A-Z]{1,3})(\d+)?/i.exec(range);
    if (!m) return null;
    return { rows: (m[4] ? parseInt(m[4]) : 1000) - (m[2] ? parseInt(m[2]) : 1) + 1, cols: columnToNumber(m[3].toUpperCase()) - columnToNumber(m[1].toUpperCase()) + 1 };
}

function createFilledArray(rows: number, cols: number, value: string): string[][] {
    return Array(rows).fill(null).map(() => Array(cols).fill(value) as string[]);
}

async function determineFillValues(spreadsheetId: string, range: string, fillValue: string, headers: { Authorization: string; "Content-Type": string }): Promise<string[][]> {
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`, { headers });
    if (!response.ok) { const e = (await response.json()) as { error?: { message?: string } }; throw new Error(e.error?.message || `API error: ${response.status}`); }
    const data = (await response.json()) as { values?: string[][] };
    if (data.values?.length && data.values[0]?.length) return createFilledArray(data.values.length, data.values[0].length, fillValue);
    const dims = parseRangeDimensions(range);
    return dims ? createFilledArray(dims.rows, dims.cols, fillValue) : [[fillValue]];
}

// =============================================================================
// MCP Server
// =============================================================================

const mcpServer = new McpServer({ name: "google-sheets", version: "1.0.0" });
const configured = isGoogleConfigured();

if (configured) {
    mcpServer.registerTool("list_spreadsheets", {
        description: "List user's Google Sheets spreadsheets",
        inputSchema: {},
    }, async () => {
        const token = await getToken();
        const headers = createAuthHeaders(token);
        const response = await fetch("https://www.googleapis.com/drive/v3/files?q=mimeType='application/vnd.google-apps.spreadsheet'&fields=files(id,name,modifiedTime,webViewLink)&orderBy=modifiedTime desc&pageSize=20", { headers });
        if (!response.ok) { const e = (await response.json()) as { error?: { message?: string } }; throw new Error(e.error?.message || `API error: ${response.status}`); }
        const data = (await response.json()) as { files?: Array<{ id: string; name: string; modifiedTime: string; webViewLink: string }> };
        const spreadsheets = (data.files || []).map((f) => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime, url: f.webViewLink }));
        return { content: [{ type: "text" as const, text: JSON.stringify({ spreadsheets, count: spreadsheets.length }, null, 2) }] };
    });

    mcpServer.registerTool("get_spreadsheet", {
        description: "Get spreadsheet metadata including sheet names and dimensions",
        inputSchema: { spreadsheetId: z.string().describe("The spreadsheet ID (from URL)") },
    }, async ({ spreadsheetId }) => {
        const token = await getToken();
        const headers = createAuthHeaders(token);
        const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,properties,sheets.properties`, { headers });
        if (!response.ok) { const e = (await response.json()) as { error?: { message?: string } }; throw new Error(e.error?.message || `API error: ${response.status}`); }
        const s = (await response.json()) as {
            spreadsheetId: string; properties?: { title?: string; locale?: string };
            sheets?: Array<{ properties: { sheetId: number; title: string; index: number; gridProperties?: { rowCount: number; columnCount: number } } }>;
        };
        return {
            content: [{
                type: "text" as const, text: JSON.stringify({
                    spreadsheetId: s.spreadsheetId, title: s.properties?.title, locale: s.properties?.locale,
                    sheets: (s.sheets || []).map((sh) => ({ sheetId: sh.properties.sheetId, title: sh.properties.title, index: sh.properties.index, rowCount: sh.properties.gridProperties?.rowCount, columnCount: sh.properties.gridProperties?.columnCount })),
                }, null, 2)
            }]
        };
    });

    mcpServer.registerTool("create_spreadsheet", {
        description: "Create a new Google Sheets spreadsheet",
        inputSchema: { title: z.string().describe("Title"), sheetTitle: z.string().optional().describe("First sheet title") },
    }, async ({ title, sheetTitle }) => {
        const token = await getToken();
        const headers = createAuthHeaders(token);
        const body: { properties: { title: string }; sheets?: Array<{ properties: { title: string } }> } = { properties: { title } };
        if (sheetTitle) body.sheets = [{ properties: { title: sheetTitle } }];
        const response = await fetch("https://sheets.googleapis.com/v4/spreadsheets", { method: "POST", headers, body: JSON.stringify(body) });
        if (!response.ok) { const e = (await response.json()) as { error?: { message?: string } }; throw new Error(e.error?.message || `API error: ${response.status}`); }
        const s = (await response.json()) as { spreadsheetId: string; properties?: { title?: string }; spreadsheetUrl?: string; sheets?: Array<{ properties: { sheetId: number; title: string } }> };
        return { content: [{ type: "text" as const, text: JSON.stringify({ spreadsheetId: s.spreadsheetId, title: s.properties?.title, url: s.spreadsheetUrl, sheets: (s.sheets || []).map((sh) => ({ sheetId: sh.properties.sheetId, title: sh.properties.title })) }, null, 2) }] };
    });

    mcpServer.registerTool("read_values", {
        description: "Read cell values from a spreadsheet using A1 notation",
        inputSchema: { spreadsheetId: z.string().describe("The spreadsheet ID"), range: z.string().describe("Cell range in A1 notation (e.g., 'Sheet1!A1:C10')") },
    }, async ({ spreadsheetId, range }) => {
        const token = await getToken();
        const headers = createAuthHeaders(token);
        const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`, { headers });
        if (!response.ok) { const e = (await response.json()) as { error?: { message?: string } }; throw new Error(e.error?.message || `API error: ${response.status}`); }
        const data = (await response.json()) as { range?: string; values?: string[][] };
        return { content: [{ type: "text" as const, text: JSON.stringify({ range: data.range, values: data.values || [], rowCount: (data.values || []).length, columnCount: (data.values || [])[0]?.length || 0 }, null, 2) }] };
    });

    mcpServer.registerTool("write_values", {
        description: "Write values to cells. Use 'values' for data or 'fillValue' to fill entire range",
        inputSchema: {
            spreadsheetId: z.string().describe("The spreadsheet ID"), range: z.string().describe("Cell range in A1 notation"),
            values: z.array(z.array(z.string())).optional().describe("2D array of values"), fillValue: z.string().optional().describe("Single value to fill entire range"),
        },
    }, async ({ spreadsheetId, range, values, fillValue }) => {
        const token = await getToken();
        const headers = createAuthHeaders(token);
        let writeValues = values;
        if (fillValue !== undefined) writeValues = await determineFillValues(spreadsheetId, range, fillValue, headers);
        if (!writeValues || !Array.isArray(writeValues)) return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Either 'values' or 'fillValue' is required" }) }], isError: true };
        const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, { method: "PUT", headers, body: JSON.stringify({ values: writeValues }) });
        if (!response.ok) { const e = (await response.json()) as { error?: { message?: string } }; throw new Error(e.error?.message || `API error: ${response.status}`); }
        const result = (await response.json()) as { updatedRange?: string; updatedRows?: number; updatedColumns?: number; updatedCells?: number };
        return { content: [{ type: "text" as const, text: JSON.stringify({ updatedRange: result.updatedRange, updatedRows: result.updatedRows, updatedColumns: result.updatedColumns, updatedCells: result.updatedCells, filledWithValue: fillValue !== undefined ? fillValue : undefined }, null, 2) }] };
    });

    mcpServer.registerTool("append_rows", {
        description: "Append rows of data to a sheet",
        inputSchema: { spreadsheetId: z.string().describe("The spreadsheet ID"), range: z.string().describe("Target range (e.g., 'Sheet1!A:A')"), values: z.array(z.array(z.string())).describe("2D array of rows to append") },
    }, async ({ spreadsheetId, range, values }) => {
        const token = await getToken();
        const headers = createAuthHeaders(token);
        const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { method: "POST", headers, body: JSON.stringify({ values }) });
        if (!response.ok) { const e = (await response.json()) as { error?: { message?: string } }; throw new Error(e.error?.message || `API error: ${response.status}`); }
        const result = (await response.json()) as { updates?: { updatedRange?: string; updatedRows?: number; updatedColumns?: number; updatedCells?: number } };
        return { content: [{ type: "text" as const, text: JSON.stringify({ updatedRange: result.updates?.updatedRange, updatedRows: result.updates?.updatedRows, updatedColumns: result.updates?.updatedColumns, updatedCells: result.updates?.updatedCells }, null, 2) }] };
    });
}

// =============================================================================
// HTTP Routes
// =============================================================================

export const googleSheetsMcpRoutes = new Hono();
const transport = new StreamableHTTPTransport();

googleSheetsMcpRoutes.all("/", async (c) => {
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

googleSheetsMcpRoutes.get("/info", async (c) => {
    return c.json({
        name: "google-sheets", version: "1.0.0",
        status: configured ? "ready" : "not_configured", configured,
        tools: configured ? ["list_spreadsheets", "get_spreadsheet", "create_spreadsheet", "read_values", "write_values", "append_rows"] : [],
    });
});
