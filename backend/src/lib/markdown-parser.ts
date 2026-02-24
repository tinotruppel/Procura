/**
 * Markdown-to-Google-Docs parser helpers
 *
 * Pure functions that convert markdown text into Google Docs API
 * insert/format requests. Extracted from google-docs-mcp.ts for
 * independent unit-testability.
 */

// =============================================================================
// Types
// =============================================================================

export interface FormattingRequest {
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

export interface TableData {
    position: number;
    rows: string[][];
    numRows: number;
    numCols: number;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Extract markdown tables from text and replace them with placeholders.
 */
export function extractTables(text: string): { text: string; tables: { match: string; rows: string[][] }[] } {
    const tables: { match: string; rows: string[][] }[] = [];
    const allLines = text.split("\n");
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
                    if (i === 1) continue; // skip separator row
                    rows.push(tableLines[i].split("|").slice(1, -1).map((cell) => cell.trim()));
                }
                tables.push({ match: tableLines.join("\n"), rows });
                lineIndex = tableEndIndex + 1;
                continue;
            }
        }
        lineIndex++;
    }
    let result = text;
    for (const table of tables) {
        result = result.replace(table.match, `__TABLE_${tables.indexOf(table)}__`);
    }
    return { text: result, tables };
}

/**
 * Process lines for structural elements: headings, HRs, and table placeholders.
 */
export function processLines(
    text: string,
    startIndex: number
): { plainText: string; headingRanges: { start: number; end: number; level: number }[]; tablePositions: { index: number; tableIdx: number }[] } {
    const lines = text.split("\n");
    let currentIndex = startIndex;
    const processedLines: string[] = [];
    const headingRanges: { start: number; end: number; level: number }[] = [];
    const tablePositions: { index: number; tableIdx: number }[] = [];

    for (const line of lines) {
        const headingMatch = /^(#{1,3}) (.+)$/.exec(line);
        const hrMatch = /^-{3,}$/.exec(line);
        const tableMatch = /^__TABLE_(\d+)__$/.exec(line);
        if (headingMatch) {
            const level = headingMatch[1].length;
            const headingText = headingMatch[2];
            headingRanges.push({ start: currentIndex, end: currentIndex + headingText.length + 1, level });
            processedLines.push(headingText);
            currentIndex += headingText.length + 1;
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
    return { plainText: processedLines.join("\n"), headingRanges, tablePositions };
}

/**
 * Extract inline formatting (bold, italic, links) and return ranges + stripped text.
 */
export function extractInlineFormatting(
    text: string,
    startIndex: number
): { plainText: string; boldRanges: { start: number; end: number }[]; italicRanges: { start: number; end: number }[]; linkRanges: { start: number; end: number; url: string }[] } {
    let plainText = text;
    let match;

    // Bold
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
    // eslint-disable-next-line sonarjs/slow-regex -- standard markdown link pattern, input is user-owned
    const linkRegex = /\[([^\]]+)]\(([^)]+)\)/g;
    while ((match = linkRegex.exec(plainText)) !== null) {
        linkRanges.push({ start: startIndex + match.index - offset, end: startIndex + match.index - offset + match[1].length, url: match[2] });
        offset += match[0].length - match[1].length;
    }
    // eslint-disable-next-line sonarjs/slow-regex -- standard markdown link pattern, input is user-owned
    plainText = plainText.replace(/\[([^\]]+)]\(([^)]+)\)/g, "$1");

    return { plainText, boldRanges, italicRanges, linkRanges };
}

/**
 * Parse markdown text into Google Docs API insert/format requests.
 */
export function parseMarkdownToRequests(
    markdown: string,
    startIndex: number
): { plainText: string; requests: FormattingRequest[]; tables: TableData[] } {
    const requests: FormattingRequest[] = [];

    // 1. Extract tables
    const { text: textWithPlaceholders, tables } = extractTables(markdown);

    // 2. Process structural elements (headings, HRs, table placeholders)
    const { plainText: structuredText, headingRanges, tablePositions } = processLines(textWithPlaceholders, startIndex);

    // 3. Resolve table data from positions
    const parsedTables: TableData[] = [];
    for (const pos of [...tablePositions].reverse()) {
        const table = tables[pos.tableIdx];
        if (!table) continue;
        parsedTables.push({ position: pos.index, rows: table.rows, numRows: table.rows.length, numCols: table.rows[0]?.length || 1 });
    }

    // 4. Generate heading style requests
    for (const h of headingRanges) {
        let styleType: string;
        if (h.level === 1) styleType = "HEADING_1";
        else if (h.level === 2) styleType = "HEADING_2";
        else styleType = "HEADING_3";
        requests.push({ updateParagraphStyle: { range: { startIndex: h.start, endIndex: h.end }, paragraphStyle: { namedStyleType: styleType }, fields: "namedStyleType" } });
    }

    // 5. Extract inline formatting
    const { plainText, boldRanges, italicRanges, linkRanges } = extractInlineFormatting(structuredText, startIndex);

    for (const r of boldRanges) requests.push({ updateTextStyle: { range: { startIndex: r.start, endIndex: r.end }, textStyle: { bold: true }, fields: "bold" } });
    for (const r of italicRanges) requests.push({ updateTextStyle: { range: { startIndex: r.start, endIndex: r.end }, textStyle: { italic: true }, fields: "italic" } });
    for (const r of linkRanges) requests.push({ updateTextStyle: { range: { startIndex: r.start, endIndex: r.end }, textStyle: { link: { url: r.url } }, fields: "link" } });

    return { plainText, requests, tables: parsedTables };
}
