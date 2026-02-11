import { describe, it, expect, vi, beforeEach } from "vitest";
import { fileParserTool, canParseFile, getSupportedExtensions } from "./file-parser";
import * as fileStore from "@/lib/file-store";

// Mock file-store
vi.mock("@/lib/file-store", () => ({
    getFile: vi.fn(),
    getLatestFile: vi.fn(),
}));

describe("File Parser Tool", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("canParseFile", () => {
        it("should return true for JSON files", () => {
            expect(canParseFile("application/json", "data.json")).toBe(true);
        });

        it("should return true for CSV files", () => {
            expect(canParseFile("text/csv", "data.csv")).toBe(true);
        });

        it("should return true for text files by extension", () => {
            expect(canParseFile("application/octet-stream", "readme.md")).toBe(true);
            expect(canParseFile("application/octet-stream", "config.yaml")).toBe(true);
            expect(canParseFile("application/octet-stream", "script.py")).toBe(true);
        });

        it("should return true for Excel files", () => {
            expect(canParseFile("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "data.xlsx")).toBe(true);
        });

        it("should return true for Word files", () => {
            expect(canParseFile("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "doc.docx")).toBe(true);
        });

        it("should return true for PowerPoint files", () => {
            expect(canParseFile("application/vnd.openxmlformats-officedocument.presentationml.presentation", "slides.pptx")).toBe(true);
        });

        it("should return false for PDF files", () => {
            // PDF by MIME type only - no extension mapping
            expect(canParseFile("application/pdf", "doc.unknown")).toBe(false);
        });

        it("should return false for image files", () => {
            expect(canParseFile("image/png", "image.png")).toBe(false);
        });
    });

    describe("getSupportedExtensions", () => {
        it("should return array of extensions", () => {
            const extensions = getSupportedExtensions();
            expect(extensions).toContain(".json");
            expect(extensions).toContain(".csv");
            expect(extensions).toContain(".md");
            expect(extensions).toContain(".xlsx");
            expect(extensions).toContain(".docx");
            expect(extensions).toContain(".pptx");
        });
    });

    describe("execute", () => {
        it("should return error for unknown operation", async () => {
            const result = await fileParserTool.execute(
                { operation: "unknown", fileRef: "file_123" },
                {}
            );
            expect(result.success).toBe(false);
            expect(result.error).toContain("Unknown operation");
        });

        it("should return error when no file reference provided", async () => {
            const result = await fileParserTool.execute(
                { operation: "parse_file", fileRef: "" },
                {}
            );
            expect(result.success).toBe(false);
            expect(result.error).toContain("No file reference provided");
        });

        it("should return error when file not found and no fallback available", async () => {
            vi.mocked(fileStore.getFile).mockReturnValue(undefined);
            vi.mocked(fileStore.getLatestFile).mockReturnValue(undefined);

            const result = await fileParserTool.execute(
                { operation: "parse_file", fileRef: "file_notfound" },
                {}
            );
            expect(result.success).toBe(false);
            expect(result.error).toContain("No files are currently stored");
        });

        it("should use fallback file and include warning when original not found", async () => {
            const jsonContent = JSON.stringify({ fallback: true });
            const base64 = btoa(jsonContent);

            vi.mocked(fileStore.getFile).mockReturnValue(undefined);
            vi.mocked(fileStore.getLatestFile).mockReturnValue({
                id: "file_real123",
                file: {
                    fileName: "fallback.json",
                    mimeType: "application/json",
                    fileSize: jsonContent.length,
                    dataUrl: `data:application/json;base64,${base64}`,
                },
            });

            const result = await fileParserTool.execute(
                { operation: "parse_file", fileRef: "file_wrong" },
                {}
            );
            expect(result.success).toBe(true);
            const data = result.data as { warning: string; correctFileRef: string };
            expect(data.warning).toContain("file_wrong");
            expect(data.correctFileRef).toBe("file_real123");
        });

        it("should return error for unsupported file type", async () => {
            vi.mocked(fileStore.getFile).mockReturnValue({
                id: "file_123",
                fileName: "image.png",
                mimeType: "image/png",
                fileSize: 1000,
                dataUrl: "data:image/png;base64,iVBORw0KGgo=",
            });

            const result = await fileParserTool.execute(
                { operation: "parse_file", fileRef: "file_123" },
                {}
            );
            expect(result.success).toBe(false);
            expect(result.error).toContain("Cannot parse file type");
        });

        it("should parse JSON file", async () => {
            const jsonContent = JSON.stringify({ name: "test", value: 123 });
            const base64 = btoa(jsonContent);

            vi.mocked(fileStore.getFile).mockReturnValue({
                id: "file_json",
                fileName: "data.json",
                mimeType: "application/json",
                fileSize: jsonContent.length,
                dataUrl: `data:application/json;base64,${base64}`,
            });

            const result = await fileParserTool.execute(
                { operation: "parse_file", fileRef: "file_json" },
                {}
            );
            expect(result.success).toBe(true);
            expect(result.data).toBeDefined();
            const data = result.data as { fileName: string; fileType: string; content: string };
            expect(data.fileName).toBe("data.json");
            expect(data.fileType).toBe("json");
            expect(data.content).toContain("name");
            expect(data.content).toContain("test");
        });

        it("should parse CSV file to markdown table", async () => {
            const csvContent = "Name,Age,City\nAlice,30,Berlin\nBob,25,Munich";
            const base64 = btoa(csvContent);

            vi.mocked(fileStore.getFile).mockReturnValue({
                id: "file_csv",
                fileName: "data.csv",
                mimeType: "text/csv",
                fileSize: csvContent.length,
                dataUrl: `data:text/csv;base64,${base64}`,
            });

            const result = await fileParserTool.execute(
                { operation: "parse_file", fileRef: "file_csv" },
                {}
            );
            expect(result.success).toBe(true);
            const data = result.data as { content: string };
            expect(data.content).toContain("| Name | Age | City |");
            expect(data.content).toContain("| Alice | 30 | Berlin |");
            expect(data.content).toContain("2 rows");
        });

        it("should parse iCalendar file", async () => {
            const icsContent = `BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:Team Meeting
DTSTART:20240115T100000Z
DTEND:20240115T110000Z
LOCATION:Room A
END:VEVENT
END:VCALENDAR`;
            const base64 = btoa(icsContent);

            vi.mocked(fileStore.getFile).mockReturnValue({
                id: "file_ics",
                fileName: "calendar.ics",
                mimeType: "text/calendar",
                fileSize: icsContent.length,
                dataUrl: `data:text/calendar;base64,${base64}`,
            });

            const result = await fileParserTool.execute(
                { operation: "parse_file", fileRef: "file_ics" },
                {}
            );
            expect(result.success).toBe(true);
            const data = result.data as { content: string };
            expect(data.content).toContain("Team Meeting");
            expect(data.content).toContain("2024-01-15");
            expect(data.content).toContain("Room A");
        });

        it("should parse env file", async () => {
            const envContent = `# Database config
DB_HOST=localhost
DB_PORT=5432
API_KEY=secret123`;
            const base64 = btoa(envContent);

            vi.mocked(fileStore.getFile).mockReturnValue({
                id: "file_env",
                fileName: ".env",
                mimeType: "text/plain",
                fileSize: envContent.length,
                dataUrl: `data:text/plain;base64,${base64}`,
            });

            const result = await fileParserTool.execute(
                { operation: "parse_file", fileRef: "file_env" },
                {}
            );
            expect(result.success).toBe(true);
            const data = result.data as { content: string };
            expect(data.content).toContain("DB_HOST");
            expect(data.content).toContain("localhost");
        });

        it("should parse SRT subtitle file", async () => {
            const srtContent = `1
00:00:01,000 --> 00:00:04,000
Hello world

2
00:00:05,000 --> 00:00:08,000
This is a test`;
            const base64 = btoa(srtContent);

            vi.mocked(fileStore.getFile).mockReturnValue({
                id: "file_srt",
                fileName: "subtitles.srt",
                mimeType: "text/plain",
                fileSize: srtContent.length,
                dataUrl: `data:text/plain;base64,${base64}`,
            });

            const result = await fileParserTool.execute(
                { operation: "parse_file", fileRef: "file_srt" },
                {}
            );
            expect(result.success).toBe(true);
            const data = result.data as { content: string };
            expect(data.content).toContain("Hello world");
            expect(data.content).toContain("This is a test");
        });

        it("should parse markdown file", async () => {
            const mdContent = "# Heading\n\nSome **bold** text.";
            const base64 = btoa(mdContent);

            vi.mocked(fileStore.getFile).mockReturnValue({
                id: "file_md",
                fileName: "readme.md",
                mimeType: "text/markdown",
                fileSize: mdContent.length,
                dataUrl: `data:text/markdown;base64,${base64}`,
            });

            const result = await fileParserTool.execute(
                { operation: "parse_file", fileRef: "file_md" },
                {}
            );
            expect(result.success).toBe(true);
            const data = result.data as { content: string; fileType: string };
            expect(data.fileType).toBe("markdown");
            expect(data.content).toContain("# Heading");
        });

        it("should parse source code file with syntax hint", async () => {
            const pyContent = "def hello():\n    print('Hello')";
            const base64 = btoa(pyContent);

            vi.mocked(fileStore.getFile).mockReturnValue({
                id: "file_py",
                fileName: "script.py",
                mimeType: "application/octet-stream", // Unknown MIME, use extension
                fileSize: pyContent.length,
                dataUrl: `data:application/octet-stream;base64,${base64}`,
            });

            const result = await fileParserTool.execute(
                { operation: "parse_file", fileRef: "file_py" },
                {}
            );
            expect(result.success).toBe(true);
            const data = result.data as { content: string; fileType: string };
            expect(data.fileType).toBe("python");
            expect(data.content).toContain("```python");
            expect(data.content).toContain("def hello()");
        });

        it("should return error for invalid data URL format", async () => {
            vi.mocked(fileStore.getFile).mockReturnValue({
                id: "file_bad",
                fileName: "data.json",
                mimeType: "application/json",
                fileSize: 100,
                dataUrl: "invalid-data-url",
            });

            const result = await fileParserTool.execute(
                { operation: "parse_file", fileRef: "file_bad" },
                {}
            );
            expect(result.success).toBe(false);
            expect(result.error).toContain("Invalid file data format");
        });

        it("should parse TSV file with tab delimiters", async () => {
            const tsvContent = "Name\tAge\tCity\nAlice\t30\tBerlin";
            const base64 = btoa(tsvContent);

            vi.mocked(fileStore.getFile).mockReturnValue({
                id: "file_tsv",
                fileName: "data.tsv",
                mimeType: "text/tab-separated-values",
                fileSize: tsvContent.length,
                dataUrl: `data:text/tab-separated-values;base64,${base64}`,
            });

            const result = await fileParserTool.execute(
                { operation: "parse_file", fileRef: "file_tsv" },
                {}
            );
            expect(result.success).toBe(true);
            const data = result.data as { fileType: string; content: string };
            expect(data.fileType).toBe("tsv");
            expect(data.content).toContain("| Name | Age | City |");
        });

        it("should parse XML file with markup formatting", async () => {
            const xmlContent = "<root><item>Hello</item></root>";
            const base64 = btoa(xmlContent);

            vi.mocked(fileStore.getFile).mockReturnValue({
                id: "file_xml",
                fileName: "data.xml",
                mimeType: "application/xml",
                fileSize: xmlContent.length,
                dataUrl: `data:application/xml;base64,${base64}`,
            });

            const result = await fileParserTool.execute(
                { operation: "parse_file", fileRef: "file_xml" },
                {}
            );
            expect(result.success).toBe(true);
            const data = result.data as { fileType: string; content: string };
            expect(data.fileType).toBe("xml");
            expect(data.content).toContain("```xml");
        });

        it("should detect file type from text/ MIME prefix as fallback", async () => {
            const content = "some custom text format";
            const base64 = btoa(content);

            vi.mocked(fileStore.getFile).mockReturnValue({
                id: "file_custom",
                fileName: "data.unknown",
                mimeType: "text/x-custom",
                fileSize: content.length,
                dataUrl: `data:text/x-custom;base64,${base64}`,
            });

            const result = await fileParserTool.execute(
                { operation: "parse_file", fileRef: "file_custom" },
                {}
            );
            expect(result.success).toBe(true);
            const data = result.data as { fileType: string };
            expect(data.fileType).toBe("text");
        });

        it("should parse CSV with quoted fields containing commas", async () => {
            const csvContent = 'Name,Location\n"Alice, Bob","Berlin, Germany"';
            const base64 = btoa(csvContent);

            vi.mocked(fileStore.getFile).mockReturnValue({
                id: "file_csv_q",
                fileName: "quoted.csv",
                mimeType: "text/csv",
                fileSize: csvContent.length,
                dataUrl: `data:text/csv;base64,${base64}`,
            });

            const result = await fileParserTool.execute(
                { operation: "parse_file", fileRef: "file_csv_q" },
                {}
            );
            expect(result.success).toBe(true);
            const data = result.data as { content: string };
            expect(data.content).toContain("Alice, Bob");
        });

        it("should parse iCalendar event without optional fields", async () => {
            const icsContent = `BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:Quick Sync
DTSTART:20240220
END:VEVENT
END:VCALENDAR`;
            const base64 = btoa(icsContent);

            vi.mocked(fileStore.getFile).mockReturnValue({
                id: "file_ics2",
                fileName: "simple.ics",
                mimeType: "text/calendar",
                fileSize: icsContent.length,
                dataUrl: `data:text/calendar;base64,${base64}`,
            });

            const result = await fileParserTool.execute(
                { operation: "parse_file", fileRef: "file_ics2" },
                {}
            );
            expect(result.success).toBe(true);
            const data = result.data as { content: string };
            expect(data.content).toContain("Quick Sync");
            expect(data.content).toContain("2024-02-20");
        });

        it("should parse VTT subtitle file", async () => {
            const vttContent = "WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\nHello world";
            const base64 = btoa(vttContent);

            vi.mocked(fileStore.getFile).mockReturnValue({
                id: "file_vtt",
                fileName: "subs.vtt",
                mimeType: "text/vtt",
                fileSize: vttContent.length,
                dataUrl: `data:text/vtt;base64,${base64}`,
            });

            const result = await fileParserTool.execute(
                { operation: "parse_file", fileRef: "file_vtt" },
                {}
            );
            expect(result.success).toBe(true);
            const data = result.data as { content: string };
            expect(data.content).toContain("Hello world");
        });

        it("should handle invalid JSON gracefully", async () => {
            const invalidJson = "{ broken json: }}}";
            const base64 = btoa(invalidJson);

            vi.mocked(fileStore.getFile).mockReturnValue({
                id: "file_bad_json",
                fileName: "broken.json",
                mimeType: "application/json",
                fileSize: invalidJson.length,
                dataUrl: `data:application/json;base64,${base64}`,
            });

            const result = await fileParserTool.execute(
                { operation: "parse_file", fileRef: "file_bad_json" },
                {}
            );
            expect(result.success).toBe(true);
            // Should return raw content when JSON parse fails
            const data = result.data as { content: string };
            expect(data.content).toContain("broken json");
        });
    });

    describe("tool schema", () => {
        it("should have correct name", () => {
            expect(fileParserTool.name).toBe("file_parser");
        });

        it("should be enabled by default", () => {
            expect(fileParserTool.enabledByDefault).toBe(true);
        });

        it("should have required parameters", () => {
            expect(fileParserTool.schema.parameters?.required).toContain("operation");
            expect(fileParserTool.schema.parameters?.required).toContain("fileRef");
        });
    });
});
