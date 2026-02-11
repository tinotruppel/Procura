import { Tool, SchemaType } from "./types";
import { getGoogleAccessToken, createAuthHeaders, ScopeSets } from "./google-auth";

type GoogleDocsOperation = "list_documents" | "get_document" | "create_document" | "append_text" | "replace_text" | "rename_document";

/**
 * Clear the token cache (useful for testing)
 */
/**
 * Extract plain text from Google Docs document structure
 */
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
                        if (textRun.content) {
                            textParts.push(textRun.content);
                        }
                    }
                }
            }
        }
    }

    return textParts.join("");
}

/**
 * Get the end index of a document for appending text
 */
function getDocumentEndIndex(doc: Record<string, unknown>): number {
    const body = doc.body as { content?: Array<{ endIndex?: number }> } | undefined;
    if (!body?.content || body.content.length === 0) return 1;

    const lastElement = body.content[body.content.length - 1];
    // Subtract 1 because the last index is exclusive and includes a trailing newline
    return (lastElement.endIndex || 1) - 1;
}

/**
 * Formatting request for Google Docs batchUpdate
 */
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

/**
 * Table data for insertion
 */
interface TableData {
    position: number;
    rows: string[][];
    numRows: number;
    numCols: number;
}

/**
 * Parse markdown text and return plain text + formatting requests
 * Supports: **bold**, *italic*, # headings (H1-H3), [text](url) links, --- horizontal rules (as visual separator), tables
 */
function parseMarkdownToRequests(
    markdown: string,
    startIndex: number
): { plainText: string; requests: FormattingRequest[]; tables: TableData[] } {
    const requests: FormattingRequest[] = [];
    const parsedTables: TableData[] = [];
    let plainText = markdown;

    // First, extract and process tables
    const tables: { match: string; rows: string[][]; startLineIndex: number }[] = [];

    // Find all tables and their line positions
    const allLines = plainText.split("\n");
    let lineIndex = 0;
    while (lineIndex < allLines.length) {
        const line = allLines[lineIndex];
        // Check if this line starts a table (starts with |)
        if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
            // Check for header separator on next line
            if (lineIndex + 1 < allLines.length && /^\|[-:| ]+\|$/.test(allLines[lineIndex + 1].trim())) {
                // This is a table, find all rows
                const tableLines: string[] = [line];
                let tableEndIndex = lineIndex + 1;
                for (let i = lineIndex + 1; i < allLines.length; i++) {
                    const tableLine = allLines[i];
                    if (tableLine.trim().startsWith("|") && tableLine.trim().endsWith("|")) {
                        tableLines.push(tableLine);
                        tableEndIndex = i;
                    } else {
                        break;
                    }
                }

                // Parse table rows (skip separator line at index 1)
                const rows: string[][] = [];
                for (let i = 0; i < tableLines.length; i++) {
                    if (i === 1) continue; // Skip separator line
                    const cells = tableLines[i]
                        .split("|")
                        .slice(1, -1) // Remove empty first/last from split
                        .map(cell => cell.trim());
                    rows.push(cells);
                }

                tables.push({
                    match: tableLines.join("\n"),
                    rows,
                    startLineIndex: lineIndex,
                });

                lineIndex = tableEndIndex + 1;
                continue;
            }
        }
        lineIndex++;
    }

    // Replace tables with placeholder markers
    for (const table of tables) {
        plainText = plainText.replace(table.match, `__TABLE_${tables.indexOf(table)}__`);
    }

    // Process headings, horizontal rules and tables first (line by line)
    const lines = plainText.split("\n");
    let currentIndex = startIndex;
    const processedLines: string[] = [];
    const headingRanges: { start: number; end: number; level: number }[] = [];
    const tablePositions: { index: number; tableIdx: number }[] = [];

    for (const line of lines) {
        // eslint-disable-next-line sonarjs/slow-regex -- safe: simple pattern on short markdown line
        const headingMatch = /^(#{1,3})\s+(.+)$/.exec(line);
        const hrMatch = /^---+$/.exec(line);
        const tableMatch = /^__TABLE_(\d+)__$/.exec(line);

        if (headingMatch) {
            const level = headingMatch[1].length;
            const text = headingMatch[2];
            headingRanges.push({
                start: currentIndex,
                end: currentIndex + text.length + 1, // +1 for newline
                level,
            });
            processedLines.push(text);
            currentIndex += text.length + 1;
        } else if (hrMatch) {
            // Replace --- with a visual horizontal line separator (Google Docs API doesn't support insertHorizontalRule)
            const visualLine = "────────────────────────────────────────";
            processedLines.push(visualLine);
            currentIndex += visualLine.length + 1;
        } else if (tableMatch) {
            // Track where to insert table
            const tableIdx = parseInt(tableMatch[1], 10);
            tablePositions.push({ index: currentIndex, tableIdx });
            processedLines.push(""); // Replace table placeholder with empty
            currentIndex += 1; // Just newline for placeholder
        } else {
            processedLines.push(line);
            currentIndex += line.length + 1;
        }
    }
    // eslint-disable-next-line sonarjs/no-dead-store -- false positive: plainText is used after reassignment
    plainText = processedLines.join("\n");

    // Collect table data for later insertion
    for (const pos of [...tablePositions].reverse()) {
        const table = tables[pos.tableIdx];
        if (!table) continue;

        const numRows = table.rows.length;
        const numCols = table.rows[0]?.length || 1;

        parsedTables.push({
            position: pos.index,
            rows: table.rows,
            numRows,
            numCols,
        });
    }
    plainText = processedLines.join("\n");

    // Add heading style requests
    for (const h of headingRanges) {
        // eslint-disable-next-line sonarjs/no-nested-conditional -- acceptable: simple level to style mapping
        const styleType = h.level === 1 ? "HEADING_1" : h.level === 2 ? "HEADING_2" : "HEADING_3";
        requests.push({
            updateParagraphStyle: {
                range: { startIndex: h.start, endIndex: h.end },
                paragraphStyle: { namedStyleType: styleType },
                fields: "namedStyleType",
            },
        });
    }

    // Process bold: **text**
    const boldRegex = /\*\*(.+?)\*\*/g;
    let match;
    let offset = 0;
    const boldRanges: { start: number; end: number }[] = [];

    while ((match = boldRegex.exec(plainText)) !== null) {
        const matchStart = match.index - offset;
        const innerText = match[1];
        boldRanges.push({
            start: startIndex + matchStart,
            end: startIndex + matchStart + innerText.length,
        });
        offset += 4; // Remove ** ** (4 chars)
    }
    plainText = plainText.replace(/\*\*(.+?)\*\*/g, "$1");

    // Process italic: *text* (but not **)
    const italicRegex = /(?<!\*)\*([^*]+?)\*(?!\*)/g;
    offset = 0;
    const italicRanges: { start: number; end: number }[] = [];

    while ((match = italicRegex.exec(plainText)) !== null) {
        const matchStart = match.index - offset;
        const innerText = match[1];
        italicRanges.push({
            start: startIndex + matchStart,
            end: startIndex + matchStart + innerText.length,
        });
        offset += 2; // Remove * * (2 chars)
    }
    plainText = plainText.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, "$1");

    // Process links: [text](url)
    // eslint-disable-next-line sonarjs/slow-regex -- safe: markdown link pattern on bounded input
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    offset = 0;
    const linkRanges: { start: number; end: number; url: string }[] = [];

    while ((match = linkRegex.exec(plainText)) !== null) {
        const matchStart = match.index - offset;
        const linkText = match[1];
        const url = match[2];
        linkRanges.push({
            start: startIndex + matchStart,
            end: startIndex + matchStart + linkText.length,
            url,
        });
        offset += match[0].length - linkText.length; // Remove []() syntax
    }
    // eslint-disable-next-line sonarjs/slow-regex -- safe: same markdown link pattern
    plainText = plainText.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");

    // Build formatting requests (in reverse order for proper index handling)
    for (const range of boldRanges) {
        requests.push({
            updateTextStyle: {
                range: { startIndex: range.start, endIndex: range.end },
                textStyle: { bold: true },
                fields: "bold",
            },
        });
    }

    for (const range of italicRanges) {
        requests.push({
            updateTextStyle: {
                range: { startIndex: range.start, endIndex: range.end },
                textStyle: { italic: true },
                fields: "italic",
            },
        });
    }

    for (const range of linkRanges) {
        requests.push({
            updateTextStyle: {
                range: { startIndex: range.start, endIndex: range.end },
                textStyle: { link: { url: range.url } },
                fields: "link",
            },
        });
    }

    return { plainText, requests, tables: parsedTables };
}

/**
 * Insert tables into a Google Docs document
 * This is a two-step process: 1) insert table structure, 2) insert cell content
 */
async function insertTablesIntoDocument(
    documentId: string,
    tables: TableData[],
    headers: { Authorization: string; "Content-Type": string }
): Promise<void> {
    if (tables.length === 0) return;

    // After text has been inserted, we need to get the current document state
    // and find the right position to insert each table

    // First, get the current document
    const initialDocResponse = await fetch(
        `https://docs.googleapis.com/v1/documents/${documentId}`,
        { method: "GET", headers }
    );

    if (!initialDocResponse.ok) {
        console.error("Failed to get document for table insertion");
        return;
    }

    const initialDoc = await initialDocResponse.json();
    const documentEndIndex = getDocumentEndIndex(initialDoc);

    // For simplicity, insert tables at the end of the document
    // (The position from parsing was relative and is now invalid after text insertion)
    for (const table of tables) {
        // Step 1: Insert the table structure at document end
        const insertTableResponse = await fetch(
            `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
            {
                method: "POST",
                headers,
                body: JSON.stringify({
                    requests: [{
                        insertTable: {
                            location: { index: documentEndIndex },
                            rows: table.numRows,
                            columns: table.numCols,
                        },
                    }],
                }),
            }
        );

        if (!insertTableResponse.ok) {
            const error = await insertTableResponse.text();
            console.error("Failed to insert table structure:", error);
            continue;
        }

        // Step 2: Get the document to find cell indices
        const docResponse = await fetch(
            `https://docs.googleapis.com/v1/documents/${documentId}`,
            { method: "GET", headers }
        );

        if (!docResponse.ok) {
            console.error("Failed to get document for cell indices");
            continue;
        }

        const doc = await docResponse.json();

        // Find the table we just inserted by looking for tables near our insertion point
        const findTableCells = (content: unknown[]): number[][] => {
            const cellIndices: number[][] = [];

            for (const element of content) {
                const el = element as { table?: { tableRows?: unknown[] }; startIndex?: number };
                if (el.table && el.startIndex !== undefined && el.startIndex >= table.position - 1) {
                    // Found a table, extract cell start indices
                    for (const row of (el.table.tableRows || []) as unknown[]) {
                        const rowCells: number[] = [];
                        const tableRow = row as { tableCells?: unknown[] };
                        for (const cell of (tableRow.tableCells || []) as unknown[]) {
                            const tableCell = cell as { content?: { paragraph?: { elements?: { startIndex?: number }[] } }[] };
                            // Get the first content element's start index
                            const firstPara = tableCell.content?.[0];
                            const para = firstPara as { paragraph?: { elements?: { startIndex?: number }[] } };
                            if (para?.paragraph?.elements?.[0]?.startIndex !== undefined) {
                                rowCells.push(para.paragraph.elements[0].startIndex);
                            }
                        }
                        if (rowCells.length > 0) {
                            cellIndices.push(rowCells);
                        }
                    }
                    break; // Found the table we just inserted
                }
            }
            return cellIndices;
        };

        const cellIndices = findTableCells(doc.body?.content || []);

        // Step 3: Insert content into cells (in reverse order) and remove bold
        const cellContentRequests: unknown[] = [];
        for (let rowIdx = table.rows.length - 1; rowIdx >= 0; rowIdx--) {
            for (let colIdx = table.rows[rowIdx].length - 1; colIdx >= 0; colIdx--) {
                const cellText = table.rows[rowIdx][colIdx];
                const cellIndex = cellIndices[rowIdx]?.[colIdx];

                if (typeof cellIndex !== "undefined" && cellText) {
                    cellContentRequests.push({
                        insertText: {
                            location: { index: cellIndex },
                            text: cellText,
                        },
                    });
                    // Reset bold styling (Google Docs defaults table cells to bold)
                    cellContentRequests.push({
                        updateTextStyle: {
                            range: {
                                startIndex: cellIndex,
                                endIndex: cellIndex + cellText.length,
                            },
                            textStyle: { bold: false },
                            fields: "bold",
                        },
                    });
                }
            }
        }

        if (cellContentRequests.length > 0) {
            await fetch(
                `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
                {
                    method: "POST",
                    headers,
                    body: JSON.stringify({ requests: cellContentRequests }),
                }
            );
        }
    }
}

// --- Handler Types and Functions ---

interface HandlerContext {
    args: Record<string, unknown>;
    headers: { Authorization: string; "Content-Type": string };
}

interface HandlerResult {
    success: boolean;
    data?: Record<string, unknown>;
    error?: string;
}

async function handleListDocuments(ctx: HandlerContext): Promise<HandlerResult> {
    const { args, headers } = ctx;
    const query = args.query as string | undefined;
    const limit = Math.min((args.limit as number) || 10, 50);

    // Use Drive API to list Google Docs
    let searchQuery = "mimeType='application/vnd.google-apps.document'";
    if (query) {
        searchQuery += ` and fullText contains '${query.replace(/'/g, "\\'")}'`;
    }

    const params = new URLSearchParams({
        q: searchQuery,
        pageSize: limit.toString(),
        fields: "files(id,name,createdTime,modifiedTime,webViewLink)",
        orderBy: "modifiedTime desc",
    });

    const response = await fetch(
        `https://www.googleapis.com/drive/v3/files?${params}`,
        { method: "GET", headers }
    );

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to list documents: ${response.status} ${error}`);
    }

    const data = await response.json();
    const files = data.files || [];

    return {
        success: true,
        data: {
            documents: files.map((f: Record<string, unknown>) => ({
                id: f.id,
                title: f.name,
                createdTime: f.createdTime,
                modifiedTime: f.modifiedTime,
                url: f.webViewLink,
            })),
            count: files.length,
        },
    };
}

async function handleGetDocument(ctx: HandlerContext): Promise<HandlerResult> {
    const { args, headers } = ctx;
    const documentId = args.documentId as string;

    if (!documentId) {
        return {
            success: false,
            error: "Missing required parameter: documentId is required for get_document",
        };
    }

    const response = await fetch(
        `https://docs.googleapis.com/v1/documents/${documentId}`,
        { method: "GET", headers }
    );

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to get document: ${response.status} ${error}`);
    }

    const doc = await response.json();
    const content = extractTextFromDocument(doc);

    return {
        success: true,
        data: {
            documentId: doc.documentId,
            title: doc.title,
            content,
            revisionId: doc.revisionId,
        },
    };
}

async function handleCreateDocument(ctx: HandlerContext): Promise<HandlerResult> {
    const { args, headers } = ctx;
    const title = args.title as string;
    const content = args.content as string | undefined;

    if (!title) {
        return {
            success: false,
            error: "Missing required parameter: title is required for create_document",
        };
    }

    // Step 1: Create empty document
    const createResponse = await fetch(
        "https://docs.googleapis.com/v1/documents",
        {
            method: "POST",
            headers,
            body: JSON.stringify({ title }),
        }
    );

    if (!createResponse.ok) {
        const error = await createResponse.text();
        throw new Error(`Failed to create document: ${createResponse.status} ${error}`);
    }

    const newDoc = await createResponse.json();

    // Step 2: Add content if provided (with markdown formatting)
    if (content) {
        const { plainText, requests: formattingRequests, tables } = parseMarkdownToRequests(content, 1);

        const allRequests = [
            {
                insertText: {
                    location: { index: 1 },
                    text: plainText,
                },
            },
            ...formattingRequests,
        ];

        const updateResponse = await fetch(
            `https://docs.googleapis.com/v1/documents/${newDoc.documentId}:batchUpdate`,
            {
                method: "POST",
                headers,
                body: JSON.stringify({ requests: allRequests }),
            }
        );

        if (!updateResponse.ok) {
            const error = await updateResponse.text();
            throw new Error(`Document created but failed to add content: ${updateResponse.status} ${error}`);
        }

        // Insert tables if any
        if (tables.length > 0) {
            await insertTablesIntoDocument(newDoc.documentId, tables, headers);
        }
    }

    return {
        success: true,
        data: {
            documentId: newDoc.documentId,
            title: newDoc.title,
            url: `https://docs.google.com/document/d/${newDoc.documentId}/edit`,
            message: content
                ? `Created document "${title}" with formatted content`
                : `Created empty document "${title}"`,
        },
    };
}

async function handleAppendText(ctx: HandlerContext): Promise<HandlerResult> {
    const { args, headers } = ctx;
    const documentId = args.documentId as string;
    const content = args.content as string;

    if (!documentId) {
        return {
            success: false,
            error: "Missing required parameter: documentId is required for append_text",
        };
    }

    if (!content) {
        return {
            success: false,
            error: "Missing required parameter: content is required for append_text",
        };
    }

    // First, get the document to find the end index
    const getResponse = await fetch(
        `https://docs.googleapis.com/v1/documents/${documentId}`,
        { method: "GET", headers }
    );

    if (!getResponse.ok) {
        const error = await getResponse.text();
        throw new Error(`Failed to get document: ${getResponse.status} ${error}`);
    }

    const doc = await getResponse.json();
    const endIndex = getDocumentEndIndex(doc);

    // Parse markdown and get formatting requests
    const { plainText, requests: formattingRequests, tables } = parseMarkdownToRequests(content, endIndex);

    // Build all requests: insert text first, then apply formatting
    const allRequests = [
        {
            insertText: {
                location: { index: endIndex },
                text: plainText,
            },
        },
        ...formattingRequests,
    ];

    // Insert text at the end with formatting
    const updateResponse = await fetch(
        `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
        {
            method: "POST",
            headers,
            body: JSON.stringify({ requests: allRequests }),
        }
    );

    if (!updateResponse.ok) {
        const error = await updateResponse.text();
        throw new Error(`Failed to append text: ${updateResponse.status} ${error}`);
    }

    // Insert tables if any
    if (tables.length > 0) {
        await insertTablesIntoDocument(documentId, tables, headers);
    }

    return {
        success: true,
        data: {
            documentId,
            title: doc.title,
            message: `Appended ${plainText.length} characters to document (markdown formatting applied)`,
            url: `https://docs.google.com/document/d/${documentId}/edit`,
        },
    };
}

async function handleReplaceText(ctx: HandlerContext): Promise<HandlerResult> {
    const { args, headers } = ctx;
    const documentId = args.documentId as string;
    const searchText = args.searchText as string;
    const replaceText = args.replaceText as string;
    const matchCase = (args.matchCase as boolean) ?? false;

    if (!documentId) {
        return {
            success: false,
            error: "Missing required parameter: documentId is required for replace_text",
        };
    }

    if (!searchText) {
        return {
            success: false,
            error: "Missing required parameter: searchText is required for replace_text",
        };
    }

    if (typeof replaceText === "undefined") {
        return {
            success: false,
            error: "Missing required parameter: replaceText is required for replace_text (use empty string to delete)",
        };
    }

    // First, get the document to find text positions
    const getResponse = await fetch(
        `https://docs.googleapis.com/v1/documents/${documentId}`,
        { method: "GET", headers }
    );

    if (!getResponse.ok) {
        const error = await getResponse.text();
        throw new Error(`Failed to get document: ${getResponse.status} ${error}`);
    }

    const doc = await getResponse.json();
    const documentText = extractTextFromDocument(doc);

    // Find all occurrences of searchText
    const occurrences: { startIndex: number; endIndex: number }[] = [];
    let searchIndex = 0;
    const searchLower = matchCase ? searchText : searchText.toLowerCase();
    const textToSearch = matchCase ? documentText : documentText.toLowerCase();

    while ((searchIndex = textToSearch.indexOf(searchLower, searchIndex)) !== -1) {
        // Add 1 because Google Docs indices are 1-based
        occurrences.push({
            startIndex: searchIndex + 1,
            endIndex: searchIndex + 1 + searchText.length,
        });
        searchIndex += searchText.length;
    }

    if (occurrences.length === 0) {
        return {
            success: true,
            data: {
                documentId,
                occurrencesReplaced: 0,
                message: `No occurrences of "${searchText}" found`,
                url: `https://docs.google.com/document/d/${documentId}/edit`,
            },
        };
    }

    // Process in reverse order to maintain index positions
    const allRequests: unknown[] = [];
    const allTables: TableData[] = [];
    // eslint-disable-next-line sonarjs/no-misleading-array-reverse -- intentional: need reverse order for index handling
    for (const occ of occurrences.reverse()) {
        // Parse markdown for the replacement text
        const { plainText, requests: formattingRequests, tables } = parseMarkdownToRequests(replaceText, occ.startIndex);
        allTables.push(...tables);

        // Delete old text first
        allRequests.push({
            deleteContentRange: {
                range: {
                    startIndex: occ.startIndex,
                    endIndex: occ.endIndex,
                },
            },
        });

        // Insert new text (only if not empty)
        if (plainText.length > 0) {
            allRequests.push({
                insertText: {
                    location: { index: occ.startIndex },
                    text: plainText,
                },
            });

            // Add formatting requests
            allRequests.push(...formattingRequests);
        }
    }

    const updateResponse = await fetch(
        `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
        {
            method: "POST",
            headers,
            body: JSON.stringify({ requests: allRequests }),
        }
    );

    if (!updateResponse.ok) {
        const error = await updateResponse.text();
        throw new Error(`Failed to replace text: ${updateResponse.status} ${error}`);
    }

    // Insert tables if any
    if (allTables.length > 0) {
        await insertTablesIntoDocument(documentId, allTables, headers);
    }

    return {
        success: true,
        data: {
            documentId,
            occurrencesReplaced: occurrences.length,
            message: occurrences.length > 0
                ? `Replaced ${occurrences.length} occurrence(s) of "${searchText}" with formatted text`
                : `No occurrences of "${searchText}" found`,
            url: `https://docs.google.com/document/d/${documentId}/edit`,
        },
    };
}

async function handleRenameDocument(ctx: HandlerContext): Promise<HandlerResult> {
    const { args, headers } = ctx;
    const documentId = args.documentId as string;
    const title = args.title as string;

    if (!documentId) {
        return {
            success: false,
            error: "Missing required parameter: documentId is required for rename_document",
        };
    }

    if (!title) {
        return {
            success: false,
            error: "Missing required parameter: title is required for rename_document",
        };
    }

    // Use Drive API to rename the document
    const updateResponse = await fetch(
        `https://www.googleapis.com/drive/v3/files/${documentId}`,
        {
            method: "PATCH",
            headers,
            body: JSON.stringify({ name: title }),
        }
    );

    if (!updateResponse.ok) {
        const error = await updateResponse.text();
        throw new Error(`Failed to rename document: ${updateResponse.status} ${error}`);
    }

    return {
        success: true,
        data: {
            documentId,
            title,
            message: `Document renamed to "${title}"`,
            url: `https://docs.google.com/document/d/${documentId}/edit`,
        },
    };
}

export const googleDocsTool: Tool = {
    name: "google_docs",
    description:
        "Read, create, and edit Google Docs documents. Markdown formatting (**bold**, *italic*, # headings, [links](url), ---, tables) is automatically converted. Operations: 'list_documents', 'get_document', 'create_document', 'append_text' (adds at document end only - use 'replace_text' to insert at other positions), 'replace_text' (find and replace, use empty replaceText to delete), 'rename_document'.",
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
                const token = await getGoogleAccessToken(clientId, ScopeSets.DOCS);
                if (token) return { success: true, message: "Connected! OAuth working." };
                return { success: false, message: "No token received" };
            } catch (e) {
                return { success: false, message: e instanceof Error ? e.message : "Auth failed" };
            }
        },
    },


    schema: {
        name: "google_docs",
        description: "Interact with Google Docs documents",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                operation: {
                    type: SchemaType.STRING,
                    description: "The operation: 'list_documents', 'get_document', 'create_document', 'append_text', 'replace_text', 'rename_document'",
                },
                documentId: {
                    type: SchemaType.STRING,
                    description: "Document ID (from URL: docs.google.com/document/d/{documentId}). Required for 'get_document' and 'append_text'.",
                },
                title: {
                    type: SchemaType.STRING,
                    description: "Document title. Required for 'create_document' and 'rename_document'.",
                },
                content: {
                    type: SchemaType.STRING,
                    description: "Text content with markdown support (**bold**, *italic*, # headings, [links](url), ---). Required for write operations.",
                },
                query: {
                    type: SchemaType.STRING,
                    description: "Search query. Optional for 'list_documents' to filter results.",
                },
                limit: {
                    type: SchemaType.INTEGER,
                    description: "Maximum number of documents to list (default: 10, max: 50).",
                },
                searchText: {
                    type: SchemaType.STRING,
                    description: "Text to search for in 'replace_text' operation.",
                },
                replaceText: {
                    type: SchemaType.STRING,
                    description: "Replacement text for 'replace_text' operation. Use empty string to delete text.",
                },
                matchCase: {
                    type: SchemaType.BOOLEAN,
                    description: "Case-sensitive matching for 'replace_text' (default: false).",
                },
            },
            required: ["operation"],
        },
    },

    execute: async (args, config) => {
        const clientId = config.clientId as string;
        const operation = args.operation as GoogleDocsOperation;

        if (!clientId) {
            return {
                success: false,
                error: "Google Docs Client ID is not configured. Please set it in the tool settings (create a Web Application OAuth client in Google Cloud Console).",
            };
        }

        try {
            // Get OAuth token using Web Application flow
            const token = await getGoogleAccessToken(clientId, ScopeSets.DOCS);
            const headers = createAuthHeaders(token);
            const ctx: HandlerContext = { args, headers };

            switch (operation) {
                case "list_documents":
                    return await handleListDocuments(ctx);
                case "get_document":
                    return await handleGetDocument(ctx);
                case "create_document":
                    return await handleCreateDocument(ctx);
                case "append_text":
                    return await handleAppendText(ctx);
                case "replace_text":
                    return await handleReplaceText(ctx);
                case "rename_document":
                    return await handleRenameDocument(ctx);
                default:
                    return {
                        success: false,
                        error: `Unknown operation: ${operation}. Valid operations: list_documents, get_document, create_document, append_text, replace_text, rename_document`,
                    };
            }
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : "Google Docs operation failed",
            };
        }
    },
};
