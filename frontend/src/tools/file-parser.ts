/**
 * File Parser Tool
 * Browser-based file parsing for text and structured formats
 * No external API dependencies - runs entirely in browser
 */
import { Tool, SchemaType } from "./types";
import { getFile, getLatestFile } from "@/lib/file-store";
import ExcelJS from "exceljs";
import JSZip from "jszip";

type FileParserOperation = "parse_file";

// Office MIME types (binary, need special handling)
const OFFICE_MIME_TYPES = [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // xlsx
    "application/vnd.ms-excel", // xls
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // docx
    "application/vnd.openxmlformats-officedocument.presentationml.presentation", // pptx
];

// MIME types we can parse natively
const TEXT_MIME_TYPES = [
    "text/plain",
    "text/markdown",
    "text/csv",
    "text/xml",
    "text/html",
    "text/css",
    "text/calendar",
    "application/json",
    "application/xml",
    "application/x-yaml",
    "application/javascript",
    "application/typescript",
];

// File extensions we can parse (for unknown MIME types)
const PARSEABLE_EXTENSIONS: Record<string, string> = {
    // Plain text
    ".txt": "text",
    ".log": "text",
    ".md": "markdown",
    ".markdown": "markdown",
    // Data formats
    ".json": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".toml": "toml",
    ".xml": "xml",
    ".gpx": "xml",
    ".csv": "csv",
    ".tsv": "tsv",
    // Calendar
    ".ics": "icalendar",
    ".ical": "icalendar",
    // Config files
    ".env": "env",
    ".ini": "ini",
    ".inc": "ini",
    ".conf": "ini",
    ".cfg": "ini",
    ".cnf": "ini",
    ".htaccess": "text",
    // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- false positive: this is a file extension, not a password
    ".htpasswd": "text",
    ".editorconfig": "ini",
    ".prettierrc": "json",
    ".eslintrc": "json",
    ".babelrc": "json",
    ".npmrc": "ini",
    ".yarnrc": "yaml",
    ".nvmrc": "text",
    ".properties": "properties",
    ".gitignore": "text",
    ".gitattributes": "text",
    ".dockerignore": "text",
    "Dockerfile": "text",
    "Makefile": "text",
    ".terraform": "text",
    // Web
    ".html": "html",
    ".htm": "html",
    ".css": "css",
    ".svg": "svg",
    // Code (treat as text with syntax info)
    ".js": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".py": "python",
    ".java": "java",
    ".go": "go",
    ".rs": "rust",
    ".c": "c",
    ".cpp": "cpp",
    ".h": "c",
    ".hpp": "cpp",
    ".cs": "csharp",
    ".rb": "ruby",
    ".php": "php",
    ".swift": "swift",
    ".kt": "kotlin",
    ".scala": "scala",
    ".sql": "sql",
    ".sh": "shell",
    ".bash": "shell",
    ".zsh": "shell",
    ".ps1": "powershell",
    // Subtitles
    ".srt": "srt",
    ".vtt": "vtt",
    // Office formats (Microsoft)
    ".xlsx": "excel",
    ".xls": "excel",
    ".docx": "word",
    ".pptx": "powerpoint",
    // OpenDocument formats (LibreOffice/OpenOffice)
    ".ods": "excel",      // OpenDocument Spreadsheet
    ".odt": "word",       // OpenDocument Text
    ".odp": "powerpoint", // OpenDocument Presentation
};

/**
 * Detect file type from MIME type or extension
 */
function detectFileType(mimeType: string, fileName: string): string | null {
    // Check by extension first (more reliable for uploaded files)
    const ext = /\.[^.]+$/.exec(fileName.toLowerCase())?.[0];
    if (ext && PARSEABLE_EXTENSIONS[ext]) {
        return PARSEABLE_EXTENSIONS[ext];
    }

    // Check Office MIME types
    if (OFFICE_MIME_TYPES.includes(mimeType)) {
        if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) return "excel";
        if (mimeType.includes("wordprocessing")) return "word";
        if (mimeType.includes("presentation")) return "powerpoint";
    }

    // Check exact text MIME types
    if (TEXT_MIME_TYPES.includes(mimeType)) {
        if (mimeType === "application/json") return "json";
        if (mimeType === "text/csv") return "csv";
        if (mimeType === "text/xml" || mimeType === "application/xml") return "xml";
        if (mimeType === "text/calendar") return "icalendar";
        if (mimeType === "text/markdown") return "markdown";
        return "text";
    }

    // Check if MIME starts with text/
    if (mimeType.startsWith("text/")) {
        return "text";
    }

    return null;
}

/**
 * Parse JSON and format nicely
 */
function parseJson(content: string): string {
    try {
        const parsed = JSON.parse(content);
        return JSON.stringify(parsed, null, 2);
    } catch {
        return content; // Return as-is if invalid
    }
}

/**
 * Parse CSV to readable table format
 */
function parseCsv(content: string, delimiter = ","): string {
    const lines = content.trim().split("\n");
    if (lines.length === 0) return content;

    const rows = lines.map(line => {
        const cells: string[] = [];
        let current = "";
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === delimiter && !inQuotes) {
                cells.push(current.trim());
                current = "";
            } else {
                current += char;
            }
        }
        cells.push(current.trim());
        return cells;
    });

    // Format as markdown table
    if (rows.length > 0) {
        const header = rows[0];
        const separator = header.map(() => "---");
        const dataRows = rows.slice(1);

        let table = `| ${header.join(" | ")} |\n`;
        table += `| ${separator.join(" | ")} |\n`;
        dataRows.forEach(row => {
            table += `| ${row.join(" | ")} |\n`;
        });

        return `Parsed CSV (${dataRows.length} rows, ${header.length} columns):\n\n${table}`;
    }

    return content;
}

/**
 * Parse iCalendar format
 */
function parseICalendar(content: string): string {
    const events: string[] = [];
    const lines = content.split(/\r?\n/);
    let currentEvent: Record<string, string> = {};
    let inEvent = false;

    for (const line of lines) {
        if (line === "BEGIN:VEVENT") {
            inEvent = true;
            currentEvent = {};
        } else if (line === "END:VEVENT") {
            inEvent = false;
            const summary = currentEvent.SUMMARY || "Untitled Event";
            const start = currentEvent.DTSTART || "";
            const end = currentEvent.DTEND || "";
            const location = currentEvent.LOCATION || "";
            const description = currentEvent.DESCRIPTION || "";

            let eventStr = `- **${summary}**`;
            if (start) eventStr += `\n  Start: ${formatICalDate(start)}`;
            if (end) eventStr += `\n  End: ${formatICalDate(end)}`;
            if (location) eventStr += `\n  Location: ${location}`;
            if (description) eventStr += `\n  Description: ${description.replace(/\\n/g, " ")}`;

            events.push(eventStr);
        } else if (inEvent) {

            const match = /^([^:;]+)[;:](.+)$/.exec(line);
            if (match) {
                const key = match[1];
                const value = match[2].replace(/^[^:]*:/, "");
                currentEvent[key] = value;
            }
        }
    }

    return events.length > 0
        ? `Parsed Calendar (${events.length} events):\n\n${events.join("\n\n")}`
        : content;
}

function formatICalDate(dateStr: string): string {
    // Format: 20240115T100000Z or 20240115

    const match = /(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/.exec(dateStr);
    if (match) {
        const [, year, month, day, hour, minute] = match;
        if (hour && minute) {
            return `${year}-${month}-${day} ${hour}:${minute}`;
        }
        return `${year}-${month}-${day}`;
    }
    return dateStr;
}

/**
 * Parse .env / .ini style files
 */
function parseEnvFile(content: string): string {
    const lines = content.split(/\r?\n/);
    const entries: string[] = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) {
            continue;
        }
        const match = /^([^=]+)=(.*)$/.exec(trimmed);
        if (match) {
            entries.push(`- \`${match[1].trim()}\`: ${match[2].trim()}`);
        }
    }

    return entries.length > 0
        ? `Parsed Config (${entries.length} entries):\n\n${entries.join("\n")}`
        : content;
}

/**
 * Parse Excel files using exceljs
 */
async function parseExcel(bytes: Uint8Array, fileName: string): Promise<string> {
    const workbook = new ExcelJS.Workbook();
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    await workbook.xlsx.load(buffer as ArrayBuffer);

    const sheets: string[] = [];

    workbook.eachSheet((worksheet, _sheetId) => {
        const rows: string[] = [];
        worksheet.eachRow((row, _rowNumber) => {
            const cells = row.values as (string | number | boolean | Date | null | undefined)[];
            // ExcelJS row.values is 1-indexed, first element is undefined
            const csvRow = cells.slice(1).map(cell => {
                if (cell === null || cell === undefined) return "";
                if (cell instanceof Date) return cell.toISOString();
                return String(cell);
            }).join(",");
            rows.push(csvRow);
        });

        const csv = rows.join("\n");
        sheets.push(`### Sheet: ${worksheet.name} (${rows.length} rows)\n\n${csv}`);
    });

    return `Parsed Excel (${fileName}, ${sheets.length} sheets):\n\n${sheets.join("\n\n---\n\n")}`;
}

/**
 * Parse Word documents (.docx) and OpenDocument Text (.odt) by extracting text from XML
 */
async function parseWord(bytes: Uint8Array, fileName: string): Promise<string> {
    // eslint-disable-next-line sonarjs/no-unsafe-unzip -- safe: parsing trusted Office format from user upload
    const zip = await JSZip.loadAsync(bytes);
    const isOdt = fileName.toLowerCase().endsWith(".odt");

    // Different XML paths for different formats
    const xmlPath = isOdt ? "content.xml" : "word/document.xml";
    const docXml = await zip.file(xmlPath)?.async("string");

    if (!docXml) {
        return `Document (${fileName}): Could not extract content.`;
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(docXml, "application/xml");
    const paragraphs: string[] = [];

    if (isOdt) {
        // OpenDocument: text in <text:p> elements, content in <text:span> or direct text
        const pNodes = doc.getElementsByTagName("text:p");
        for (const pNode of Array.from(pNodes)) {
            const pText = pNode.textContent?.trim() || "";
            if (pText) {
                paragraphs.push(pText);
            }
        }
    } else {
        // Office Open XML: text in <w:t> within <w:p>
        const paragraphNodes = doc.getElementsByTagName("w:p");
        for (const pNode of Array.from(paragraphNodes)) {
            const texts = pNode.getElementsByTagName("w:t");
            const pText = Array.from(texts).map(t => t.textContent || "").join("");
            if (pText.trim()) {
                paragraphs.push(pText);
            }
        }
    }

    const content = paragraphs.join("\n\n");
    const formatName = isOdt ? "OpenDocument Text" : "Word Document";
    return `Parsed ${formatName} (${fileName}, ${paragraphs.length} paragraphs):\n\n${content}`;
}

/**
 * Parse PowerPoint (.pptx) and OpenDocument Presentation (.odp) by extracting slide text
 */
async function parsePowerPoint(bytes: Uint8Array, fileName: string): Promise<string> {
    // eslint-disable-next-line sonarjs/no-unsafe-unzip -- safe: parsing trusted Office format from user upload
    const zip = await JSZip.loadAsync(bytes);
    const slides: string[] = [];
    const isOdp = fileName.toLowerCase().endsWith(".odp");

    if (isOdp) {
        // OpenDocument Presentation: all content in content.xml
        const contentXml = await zip.file("content.xml")?.async("string");
        if (!contentXml) {
            return `Presentation (${fileName}): Could not extract content.`;
        }

        const parser = new DOMParser();
        const doc = parser.parseFromString(contentXml, "application/xml");
        const pageNodes = doc.getElementsByTagName("draw:page");

        for (let i = 0; i < pageNodes.length; i++) {
            const pageNode = pageNodes[i];
            const textNodes = pageNode.getElementsByTagName("text:p");
            const texts = Array.from(textNodes)
                .map(t => t.textContent?.trim() || "")
                .filter(t => t.length > 0);

            if (texts.length > 0) {
                slides.push(`### Slide ${i + 1}\n${texts.join("\n")}`);
            } else {
                slides.push(`### Slide ${i + 1}\n(No text content)`);
            }
        }
    } else {
        // Office Open XML: slides in ppt/slides/slideN.xml
        const slideFiles = Object.keys(zip.files)
            .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
            .sort((a, b) => {
                const numA = parseInt(/slide(\d+)/.exec(a)?.[1] || "0");
                const numB = parseInt(/slide(\d+)/.exec(b)?.[1] || "0");
                return numA - numB;
            });

        for (const slideFile of slideFiles) {
            const slideXml = await zip.file(slideFile)?.async("string");
            if (!slideXml) continue;

            const parser = new DOMParser();
            const doc = parser.parseFromString(slideXml, "application/xml");
            const textNodes = doc.getElementsByTagName("a:t");
            const texts = Array.from(textNodes)
                .map(t => t.textContent?.trim() || "")
                .filter(t => t.length > 0);

            const slideNum = /slide(\d+)/.exec(slideFile)?.[1] || "?";
            if (texts.length > 0) {
                slides.push(`### Slide ${slideNum}\n${texts.join("\n")}`);
            } else {
                slides.push(`### Slide ${slideNum}\n(No text content)`);
            }
        }
    }

    const formatName = isOdp ? "OpenDocument Presentation" : "PowerPoint";
    return slides.length > 0
        ? `Parsed ${formatName} (${fileName}, ${slides.length} slides):\n\n${slides.join("\n\n")}`
        : `${formatName} (${fileName}): No slides found.`;
}

/**
 * Check if file type requires binary parsing
 */
function isBinaryFileType(fileType: string): boolean {
    return ["excel", "word", "powerpoint"].includes(fileType);
}

/**
 * Parse subtitle files
 */
function parseSrt(content: string): string {
    const blocks = content.trim().split(/\n\n+/);
    const lines: string[] = [];

    for (const block of blocks) {
        const parts = block.split("\n");
        if (parts.length >= 3) {
            // Skip index and timestamp, get text
            const text = parts.slice(2).join(" ");
            lines.push(text);
        }
    }

    return lines.length > 0
        ? `Parsed Subtitles (${lines.length} lines):\n\n${lines.join("\n")}`
        : content;
}

/**
 * Main parsing function
 */
function parseContent(content: string, fileType: string, fileName: string): string {
    switch (fileType) {
        case "json":
            return parseJson(content);
        case "csv":
            return parseCsv(content, ",");
        case "tsv":
            return parseCsv(content, "\t");
        case "icalendar":
            return parseICalendar(content);
        case "env":
        case "ini":
        case "properties":
            return parseEnvFile(content);
        case "srt":
        case "vtt":
            return parseSrt(content);
        case "xml":
        case "html":
        case "svg":
            // Return formatted with type hint
            return `Parsed ${fileType.toUpperCase()} (${fileName}):\n\n\`\`\`${fileType}\n${content}\n\`\`\``;
        case "javascript":
        case "typescript":
        case "python":
        case "java":
        case "go":
        case "rust":
        case "c":
        case "cpp":
        case "csharp":
        case "ruby":
        case "php":
        case "swift":
        case "kotlin":
        case "scala":
        case "sql":
        case "shell":
        case "powershell":
            // Return with syntax highlighting hint
            return `Source Code (${fileName}, ${fileType}):\n\n\`\`\`${fileType}\n${content}\n\`\`\``;
        case "markdown":
            return `Markdown Document (${fileName}):\n\n${content}`;
        default:
            return `File Content (${fileName}):\n\n${content}`;
    }
}

/**
 * Check if a file can be parsed by this tool
 */
export function canParseFile(mimeType: string, fileName: string): boolean {
    return detectFileType(mimeType, fileName) !== null;
}

/**
 * Get list of supported extensions for documentation
 */
export function getSupportedExtensions(): string[] {
    return Object.keys(PARSEABLE_EXTENSIONS);
}

export const fileParserTool: Tool = {
    name: "file_parser",
    description: "Parse text-based files (JSON, CSV, XML, Markdown, code, etc.) directly in browser. Use this for text files, config files, and source code. For PDFs and scanned documents, use the document-media server instead.",
    enabledByDefault: true,
    defaultConfig: {},
    schema: {
        name: "file_parser",
        description: "Parse a text-based file and extract its content. Supports JSON, CSV, XML, YAML, Markdown, iCalendar, config files (.env, .ini), source code, and more.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                operation: {
                    type: SchemaType.STRING,
                    description: "The operation to perform. Currently only 'parse_file' is supported.",
                },
                fileRef: {
                    type: SchemaType.STRING,
                    description: "The file reference ID from the attached file (e.g., 'file_abc123').",
                },
            },
            required: ["operation", "fileRef"],
        },
    },
    execute: async (args) => {
        const operation = args.operation as FileParserOperation;
        const fileRef = args.fileRef as string;

        if (operation !== "parse_file") {
            return {
                success: false,
                error: `Unknown operation: ${operation}. Use 'parse_file'.`,
            };
        }

        if (!fileRef) {
            return {
                success: false,
                error: "No file reference provided. Include a file attachment in your message.",
            };
        }

        // Get file from store
        let fileData = getFile(fileRef);
        let usedFallback = false;
        let actualFileRef = fileRef;

        // Fallback: if file not found, try the most recent file
        if (!fileData) {
            const latest = getLatestFile();
            if (latest) {
                fileData = latest.file;
                actualFileRef = latest.id;
                usedFallback = true;
                console.warn(`[FileParser] File ${fileRef} not found, using fallback: ${actualFileRef}`);
            } else {
                return {
                    success: false,
                    error: `File not found: ${fileRef}. No files are currently stored. Please attach a file to your message.`,
                };
            }
        }

        const { fileName, mimeType, dataUrl } = fileData;

        // Check if we can parse this file type
        const fileType = detectFileType(mimeType, fileName);
        if (!fileType) {
            return {
                success: false,
                error: `Cannot parse file type: ${mimeType} (${fileName}). This tool supports text-based files only. For PDFs and images, use the document-media server.`,
            };
        }

        try {
            // Extract base64 content and decode
            const base64Match = /^data:[^;]+;base64,(.+)$/.exec(dataUrl);
            if (!base64Match) {
                return {
                    success: false,
                    error: "Invalid file data format.",
                };
            }

            // Decode base64 to bytes
            const binaryString = atob(base64Match[1]);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            let parsed: string;
            let contentLength: number;

            // Handle binary Office formats
            if (isBinaryFileType(fileType)) {
                switch (fileType) {
                    case "excel":
                        parsed = await parseExcel(bytes, fileName);
                        break;
                    case "word":
                        parsed = await parseWord(bytes, fileName);
                        break;
                    case "powerpoint":
                        parsed = await parsePowerPoint(bytes, fileName);
                        break;
                    default:
                        parsed = `Binary file: ${fileName}`;
                }
                contentLength = bytes.length;
            } else {
                // Text-based files
                const content = new TextDecoder("utf-8").decode(bytes);
                parsed = parseContent(content, fileType, fileName);
                contentLength = content.length;
            }

            return {
                success: true,
                data: {
                    fileName,
                    fileType,
                    mimeType,
                    characterCount: contentLength,
                    content: parsed,
                    ...(usedFallback && {
                        warning: `The file reference '${fileRef}' was not found. Used the most recent file instead.`,
                        correctFileRef: actualFileRef,
                    }),
                },
            };
        } catch (error) {
            return {
                success: false,
                error: `Failed to parse file: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    },
};
