/**
 * Google Sheets Tool
 * Provides operations for managing Google Sheets spreadsheets
 */

import { Tool, SchemaType, ToolExecutionResult } from "./types";
import { getGoogleAccessToken, createAuthHeaders, ScopeSets } from "./google-auth";

// =============================================================================
// Types
// =============================================================================

type GoogleSheetsOperation =
    | "list_spreadsheets"
    | "get_spreadsheet"
    | "create_spreadsheet"
    | "read_values"
    | "write_values"
    | "append_rows";

/** Context passed to all handlers */
interface SheetsContext {
    headers: HeadersInit;
}

/** Arguments passed to handlers */
interface SheetsArgs {
    [key: string]: unknown;
}

// Re-export for testing

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Convert column letter(s) to number (A=1, B=2, ..., AA=27, etc.)
 */
function columnToNumber(col: string): number {
    let num = 0;
    for (let i = 0; i < col.length; i++) {
        num = num * 26 + (col.charCodeAt(i) - 64);
    }
    return num;
}

/**
 * Parse range dimensions from A1 notation (e.g., A1:C10)
 */
function parseRangeDimensions(range: string): { rows: number; cols: number } | null {
    // Use bounded quantifiers {1,3} to prevent ReDoS - Excel columns max out at XFD (3 chars)
    const rangeMatch = /([A-Z]{1,3})(\d+)?:([A-Z]{1,3})(\d+)?/i.exec(range);
    if (!rangeMatch) return null;

    const startCol = rangeMatch[1].toUpperCase();
    const startRow = rangeMatch[2] ? parseInt(rangeMatch[2]) : 1;
    const endCol = rangeMatch[3].toUpperCase();
    const endRow = rangeMatch[4] ? parseInt(rangeMatch[4]) : 1000; // Default to 1000 rows if full column

    const numCols = columnToNumber(endCol) - columnToNumber(startCol) + 1;
    const numRows = endRow - startRow + 1;

    return { rows: numRows, cols: numCols };
}

/**
 * Create a 2D array filled with a single value
 */
function createFilledArray(rows: number, cols: number, value: string): string[][] {
    return Array(rows).fill(null).map(() => Array(cols).fill(value));
}

// =============================================================================
// Operation Handlers
// =============================================================================

async function handleListSpreadsheets(ctx: SheetsContext): Promise<ToolExecutionResult> {
    const response = await fetch(
        "https://www.googleapis.com/drive/v3/files?q=mimeType='application/vnd.google-apps.spreadsheet'&fields=files(id,name,modifiedTime,webViewLink)&orderBy=modifiedTime desc&pageSize=20",
        { headers: ctx.headers }
    );

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || `API error: ${response.status}`);
    }

    const data = await response.json();
    const spreadsheets = (data.files || []).map((file: { id: string; name: string; modifiedTime: string; webViewLink: string }) => ({
        id: file.id,
        name: file.name,
        modifiedTime: file.modifiedTime,
        url: file.webViewLink,
    }));

    return {
        success: true,
        data: {
            spreadsheets,
            count: spreadsheets.length,
        },
    };
}

async function handleGetSpreadsheet(args: SheetsArgs, ctx: SheetsContext): Promise<ToolExecutionResult> {
    const spreadsheetId = args.spreadsheetId as string;
    if (!spreadsheetId) {
        return { success: false, error: "spreadsheetId is required for get_spreadsheet" };
    }

    const response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,properties,sheets.properties`,
        { headers: ctx.headers }
    );

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || `API error: ${response.status}`);
    }

    const spreadsheet = await response.json();
    return {
        success: true,
        data: {
            spreadsheetId: spreadsheet.spreadsheetId,
            title: spreadsheet.properties?.title,
            locale: spreadsheet.properties?.locale,
            sheets: (spreadsheet.sheets || []).map((sheet: { properties: { sheetId: number; title: string; index: number; gridProperties?: { rowCount: number; columnCount: number } } }) => ({
                sheetId: sheet.properties.sheetId,
                title: sheet.properties.title,
                index: sheet.properties.index,
                rowCount: sheet.properties.gridProperties?.rowCount,
                columnCount: sheet.properties.gridProperties?.columnCount,
            })),
        },
    };
}

async function handleCreateSpreadsheet(args: SheetsArgs, ctx: SheetsContext): Promise<ToolExecutionResult> {
    const title = args.title as string;
    if (!title) {
        return { success: false, error: "title is required for create_spreadsheet" };
    }

    const sheetTitle = args.sheetTitle as string | undefined;
    const body: { properties: { title: string }; sheets?: Array<{ properties: { title: string } }> } = {
        properties: { title },
    };

    if (sheetTitle) {
        body.sheets = [{ properties: { title: sheetTitle } }];
    }

    const response = await fetch(
        "https://sheets.googleapis.com/v4/spreadsheets",
        {
            method: "POST",
            headers: ctx.headers,
            body: JSON.stringify(body),
        }
    );

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || `API error: ${response.status}`);
    }

    const spreadsheet = await response.json();
    return {
        success: true,
        data: {
            spreadsheetId: spreadsheet.spreadsheetId,
            title: spreadsheet.properties?.title,
            url: spreadsheet.spreadsheetUrl,
            sheets: (spreadsheet.sheets || []).map((sheet: { properties: { sheetId: number; title: string } }) => ({
                sheetId: sheet.properties.sheetId,
                title: sheet.properties.title,
            })),
        },
    };
}

async function handleReadValues(args: SheetsArgs, ctx: SheetsContext): Promise<ToolExecutionResult> {
    const spreadsheetId = args.spreadsheetId as string;
    const range = args.range as string;

    if (!spreadsheetId) {
        return { success: false, error: "spreadsheetId is required for read_values" };
    }
    if (!range) {
        return { success: false, error: "range is required for read_values (e.g., 'Sheet1!A1:C10')" };
    }

    const response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
        { headers: ctx.headers }
    );

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || `API error: ${response.status}`);
    }

    const data = await response.json();
    return {
        success: true,
        data: {
            range: data.range,
            values: data.values || [],
            rowCount: (data.values || []).length,
            columnCount: (data.values || [])[0]?.length || 0,
        },
    };
}

async function handleWriteValues(args: SheetsArgs, ctx: SheetsContext): Promise<ToolExecutionResult> {
    const spreadsheetId = args.spreadsheetId as string;
    const range = args.range as string;
    let values = args.values as string[][] | undefined;
    const fillValue = args.fillValue as string | undefined;

    if (!spreadsheetId) {
        return { success: false, error: "spreadsheetId is required for write_values" };
    }
    if (!range) {
        return { success: false, error: "range is required for write_values (e.g., 'Sheet1!A1:C10')" };
    }

    // If fillValue is provided, determine the range size and fill it
    if (fillValue !== undefined) {
        values = await determineFillValues(spreadsheetId, range, fillValue, ctx);
    }

    if (!values || !Array.isArray(values)) {
        return { success: false, error: "Either 'values' (2D array) or 'fillValue' is required for write_values" };
    }

    const response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
        {
            method: "PUT",
            headers: ctx.headers,
            body: JSON.stringify({ values }),
        }
    );

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || `API error: ${response.status}`);
    }

    const result = await response.json();
    return {
        success: true,
        data: {
            updatedRange: result.updatedRange,
            updatedRows: result.updatedRows,
            updatedColumns: result.updatedColumns,
            updatedCells: result.updatedCells,
            filledWithValue: fillValue !== undefined ? fillValue : undefined,
        },
    };
}

/**
 * Determine values array for filling a range with a single value
 */
async function determineFillValues(
    spreadsheetId: string,
    range: string,
    fillValue: string,
    ctx: SheetsContext
): Promise<string[][]> {
    // First, try to read the range to get its dimensions
    const readResponse = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
        { headers: ctx.headers }
    );

    if (!readResponse.ok) {
        const error = await readResponse.json();
        throw new Error(error.error?.message || `API error reading range: ${readResponse.status}`);
    }

    const readData = await readResponse.json();
    const existingRows = readData.values?.length || 0;
    const existingCols = readData.values?.[0]?.length || 0;

    // If range has data, use its dimensions
    if (existingRows > 0 && existingCols > 0) {
        return createFilledArray(existingRows, existingCols, fillValue);
    }

    // Try to parse range dimensions from A1 notation
    const dimensions = parseRangeDimensions(range);
    if (dimensions) {
        return createFilledArray(dimensions.rows, dimensions.cols, fillValue);
    }

    // Fallback: single cell
    return [[fillValue]];
}

async function handleAppendRows(args: SheetsArgs, ctx: SheetsContext): Promise<ToolExecutionResult> {
    const spreadsheetId = args.spreadsheetId as string;
    const range = args.range as string;
    const values = args.values as string[][];

    if (!spreadsheetId) {
        return { success: false, error: "spreadsheetId is required for append_rows" };
    }
    if (!range) {
        return { success: false, error: "range is required for append_rows (e.g., 'Sheet1!A:A' or 'Sheet1')" };
    }
    if (!values || !Array.isArray(values)) {
        return { success: false, error: "values (2D array) is required for append_rows" };
    }

    const response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
        {
            method: "POST",
            headers: ctx.headers,
            body: JSON.stringify({ values }),
        }
    );

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || `API error: ${response.status}`);
    }

    const result = await response.json();
    return {
        success: true,
        data: {
            updatedRange: result.updates?.updatedRange,
            updatedRows: result.updates?.updatedRows,
            updatedColumns: result.updates?.updatedColumns,
            updatedCells: result.updates?.updatedCells,
        },
    };
}

// =============================================================================
// Tool Definition
// =============================================================================

/**
 * Google Sheets Tool Definition
 */
export const googleSheetsTool: Tool = {
    name: "google_sheets",
    description: `Manage Google Sheets spreadsheets. Operations:
- list_spreadsheets: List user's spreadsheets
- get_spreadsheet: Get spreadsheet metadata (sheets, titles)
- create_spreadsheet: Create a new spreadsheet
- read_values: Read cell values using A1 notation (e.g., "Sheet1!A1:C10")
- write_values: Write values to cells. Use 'values' for data or 'fillValue' to fill entire range with one value (e.g., fillValue="" to clear column)
- append_rows: Append rows to a sheet`,
    enabledByDefault: false,

    defaultConfig: {
        clientId: "",
    },

    settingsFields: [
        { key: "clientId", label: "Google OAuth Client ID", type: "text", placeholder: "Your Client ID from Google Cloud Console..." },
    ],

    connectionTester: {
        apiLink: { url: "https://console.cloud.google.com/apis/credentials", label: "Google Cloud Console (Web Application type)" },
        requiredFields: ["clientId"],
        test: async (getSetting) => {
            try {
                const clientId = getSetting("clientId");
                // Use shared OAuth function that works in both extension and PWA
                const token = await getGoogleAccessToken(clientId, ScopeSets.SHEETS);
                if (token) return { success: true, message: "Connected! OAuth working." };
                return { success: false, message: "No token received" };
            } catch (e) {
                return { success: false, message: e instanceof Error ? e.message : "Auth failed" };
            }
        },
    },


    schema: {
        name: "google_sheets",
        description: "Manage Google Sheets spreadsheets",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                operation: {
                    type: SchemaType.STRING,
                    description: "The operation to perform: 'list_spreadsheets', 'get_spreadsheet', 'create_spreadsheet', 'read_values', 'write_values', 'append_rows'",
                },
                spreadsheetId: {
                    type: SchemaType.STRING,
                    description: "The spreadsheet ID (from URL). Required for get_spreadsheet, read_values, write_values, append_rows",
                },
                range: {
                    type: SchemaType.STRING,
                    description: "Cell range in A1 notation (e.g., 'Sheet1!A1:C10', 'A1:B5'). Required for read_values, write_values, append_rows",
                },
                values: {
                    type: SchemaType.ARRAY,
                    description: "2D array of values to write. Each inner array is a row. Required for write_values (unless fillValue is used), append_rows",
                    items: {
                        type: SchemaType.ARRAY,
                        items: {
                            type: SchemaType.STRING,
                        },
                    },
                },
                title: {
                    type: SchemaType.STRING,
                    description: "Title for new spreadsheet. Required for create_spreadsheet",
                },
                sheetTitle: {
                    type: SchemaType.STRING,
                    description: "Optional: Title for the first sheet in a new spreadsheet",
                },
                fillValue: {
                    type: SchemaType.STRING,
                    description: "Optional: Single value to fill the entire range with (e.g., '' to clear, '0' to fill with zeros). If provided, the range will be filled with this value.",
                },
            },
            required: ["operation"],
        },
    },

    execute: async (args, config) => {
        const operation = args.operation as GoogleSheetsOperation;
        const clientId = config?.clientId as string;

        if (!clientId) {
            return {
                success: false,
                error: "Google OAuth Client ID not configured. Please add it in Settings.",
            };
        }

        try {
            // Get access token with Sheets scopes
            const token = await getGoogleAccessToken(clientId, ScopeSets.SHEETS);
            const headers = createAuthHeaders(token);
            const ctx: SheetsContext = { headers };

            switch (operation) {
                case "list_spreadsheets":
                    return await handleListSpreadsheets(ctx);
                case "get_spreadsheet":
                    return await handleGetSpreadsheet(args, ctx);
                case "create_spreadsheet":
                    return await handleCreateSpreadsheet(args, ctx);
                case "read_values":
                    return await handleReadValues(args, ctx);
                case "write_values":
                    return await handleWriteValues(args, ctx);
                case "append_rows":
                    return await handleAppendRows(args, ctx);
                default:
                    return {
                        success: false,
                        error: `Unknown operation: ${operation}. Valid operations: list_spreadsheets, get_spreadsheet, create_spreadsheet, read_values, write_values, append_rows`,
                    };
            }
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : "Unknown error occurred",
            };
        }
    },
};
