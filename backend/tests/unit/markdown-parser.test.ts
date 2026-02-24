/**
 * Unit Tests for Google Docs Markdown Parser helpers
 *
 * Tests the pure-function helpers extracted from parseMarkdownToRequests:
 * extractTables, processLines, extractInlineFormatting, parseMarkdownToRequests
 */

import { describe, it, expect } from "vitest";
import {
    extractTables,
    processLines,
    extractInlineFormatting,
    parseMarkdownToRequests,
} from "../../src/lib/markdown-parser";

// =============================================================================
// extractTables
// =============================================================================

describe("extractTables", () => {
    it("should extract a simple table", () => {
        const md = "Before\n| A | B |\n|---|---|\n| 1 | 2 |\nAfter";
        const { text, tables } = extractTables(md);
        expect(tables).toHaveLength(1);
        expect(tables[0].rows).toEqual([["A", "B"], ["1", "2"]]);
        expect(text).toContain("__TABLE_0__");
        expect(text).not.toContain("|");
    });

    it("should extract multi-row table", () => {
        const md = "| H1 | H2 |\n|---|---|\n| a | b |\n| c | d |";
        const { tables } = extractTables(md);
        expect(tables).toHaveLength(1);
        expect(tables[0].rows).toEqual([["H1", "H2"], ["a", "b"], ["c", "d"]]);
    });

    it("should extract multiple tables", () => {
        const md = "| A |\n|---|\n| 1 |\n\nText\n\n| B |\n|---|\n| 2 |";
        const { text, tables } = extractTables(md);
        expect(tables).toHaveLength(2);
        expect(text).toContain("__TABLE_0__");
        expect(text).toContain("__TABLE_1__");
    });

    it("should return text unchanged when no tables", () => {
        const md = "Hello world\nNo tables here";
        const { text, tables } = extractTables(md);
        expect(tables).toHaveLength(0);
        expect(text).toBe(md);
    });

    it("should not treat a single pipe line as a table", () => {
        const md = "| Not a table |";
        const { tables } = extractTables(md);
        expect(tables).toHaveLength(0);
    });

    it("should skip separator row in rows output", () => {
        const md = "| Col |\n|---|\n| Val |";
        const { tables } = extractTables(md);
        // header + data, separator skipped
        expect(tables[0].rows).toEqual([["Col"], ["Val"]]);
    });
});

// =============================================================================
// processLines
// =============================================================================

describe("processLines", () => {
    it("should detect h1 headings", () => {
        const { plainText, headingRanges } = processLines("# Title", 1);
        expect(plainText).toBe("Title");
        expect(headingRanges).toHaveLength(1);
        expect(headingRanges[0].level).toBe(1);
        expect(headingRanges[0].start).toBe(1);
    });

    it("should detect h2 and h3 headings", () => {
        const { headingRanges } = processLines("## Sub\n### Sub-sub", 1);
        expect(headingRanges).toHaveLength(2);
        expect(headingRanges[0].level).toBe(2);
        expect(headingRanges[1].level).toBe(3);
    });

    it("should replace HR with visual line", () => {
        const { plainText } = processLines("---", 1);
        expect(plainText).toContain("────");
    });

    it("should track table placeholder positions", () => {
        const { tablePositions } = processLines("__TABLE_0__", 1);
        expect(tablePositions).toHaveLength(1);
        expect(tablePositions[0]).toEqual({ index: 1, tableIdx: 0 });
    });

    it("should pass through plain text unchanged", () => {
        const { plainText, headingRanges, tablePositions } = processLines("Hello world", 1);
        expect(plainText).toBe("Hello world");
        expect(headingRanges).toHaveLength(0);
        expect(tablePositions).toHaveLength(0);
    });

    it("should handle multiple line types", () => {
        const { plainText, headingRanges } = processLines("# Title\nBody\n---\n## Sub", 1);
        expect(headingRanges).toHaveLength(2);
        expect(plainText).toContain("Title");
        expect(plainText).toContain("Body");
        expect(plainText).toContain("────");
        expect(plainText).toContain("Sub");
    });
});

// =============================================================================
// extractInlineFormatting
// =============================================================================

describe("extractInlineFormatting", () => {
    it("should extract bold formatting", () => {
        const { plainText, boldRanges } = extractInlineFormatting("**bold** text", 1);
        expect(plainText).toBe("bold text");
        expect(boldRanges).toHaveLength(1);
        expect(boldRanges[0]).toEqual({ start: 1, end: 5 });
    });

    it("should extract italic formatting", () => {
        const { plainText, italicRanges } = extractInlineFormatting("*italic* text", 1);
        expect(plainText).toBe("italic text");
        expect(italicRanges).toHaveLength(1);
        expect(italicRanges[0]).toEqual({ start: 1, end: 7 });
    });

    it("should extract links", () => {
        const { plainText, linkRanges } = extractInlineFormatting("[Google](https://google.com)", 1);
        expect(plainText).toBe("Google");
        expect(linkRanges).toHaveLength(1);
        expect(linkRanges[0].url).toBe("https://google.com");
    });

    it("should handle mixed formatting", () => {
        const { plainText, boldRanges, italicRanges } = extractInlineFormatting("**bold** and *italic*", 1);
        expect(plainText).toBe("bold and italic");
        expect(boldRanges).toHaveLength(1);
        expect(italicRanges).toHaveLength(1);
    });

    it("should return empty arrays for plain text", () => {
        const result = extractInlineFormatting("no formatting", 1);
        expect(result.boldRanges).toHaveLength(0);
        expect(result.italicRanges).toHaveLength(0);
        expect(result.linkRanges).toHaveLength(0);
        expect(result.plainText).toBe("no formatting");
    });

    it("should handle multiple bold segments", () => {
        const { boldRanges } = extractInlineFormatting("**a** and **b**", 1);
        expect(boldRanges).toHaveLength(2);
    });
});

// =============================================================================
// parseMarkdownToRequests (integration of all helpers)
// =============================================================================

describe("parseMarkdownToRequests", () => {
    it("should parse plain text with no formatting", () => {
        const { plainText, requests, tables } = parseMarkdownToRequests("Hello world", 1);
        expect(plainText).toBe("Hello world");
        expect(requests).toHaveLength(0);
        expect(tables).toHaveLength(0);
    });

    it("should generate heading style requests", () => {
        const { requests } = parseMarkdownToRequests("# Title", 1);
        const headingReq = requests.find((r) => r.updateParagraphStyle);
        expect(headingReq).toBeDefined();
        expect(headingReq!.updateParagraphStyle!.paragraphStyle.namedStyleType).toBe("HEADING_1");
    });

    it("should generate bold text style requests", () => {
        const { plainText, requests } = parseMarkdownToRequests("**bold**", 1);
        expect(plainText).toBe("bold");
        const boldReq = requests.find((r) => r.updateTextStyle?.textStyle.bold);
        expect(boldReq).toBeDefined();
    });

    it("should generate italic text style requests", () => {
        const { requests } = parseMarkdownToRequests("*italic*", 1);
        const italicReq = requests.find((r) => r.updateTextStyle?.textStyle.italic);
        expect(italicReq).toBeDefined();
    });

    it("should generate link text style requests", () => {
        const { requests } = parseMarkdownToRequests("[link](https://example.com)", 1);
        const linkReq = requests.find((r) => r.updateTextStyle?.textStyle.link);
        expect(linkReq).toBeDefined();
        expect(linkReq!.updateTextStyle!.textStyle.link!.url).toBe("https://example.com");
    });

    it("should extract tables and return table data", () => {
        const md = "| A | B |\n|---|---|\n| 1 | 2 |";
        const { tables } = parseMarkdownToRequests(md, 1);
        expect(tables).toHaveLength(1);
        expect(tables[0].numRows).toBe(2);
        expect(tables[0].numCols).toBe(2);
    });

    it("should handle complex markdown with all features", () => {
        const md = "# Heading\n**bold** and *italic*\n---\n[link](https://test.com)\n| A |\n|---|\n| 1 |";
        const { plainText, requests, tables } = parseMarkdownToRequests(md, 1);
        expect(plainText).toContain("Heading");
        expect(plainText).toContain("bold");
        expect(plainText).toContain("italic");
        expect(plainText).toContain("link");
        expect(requests.length).toBeGreaterThan(0);
        expect(tables).toHaveLength(1);
    });

    it("should use correct start index offsets", () => {
        const { requests } = parseMarkdownToRequests("**bold**", 10);
        const boldReq = requests.find((r) => r.updateTextStyle?.textStyle.bold);
        expect(boldReq!.updateTextStyle!.range.startIndex).toBe(10);
    });

    it("should handle h2 and h3 heading styles", () => {
        const { requests } = parseMarkdownToRequests("## Sub\n### SubSub", 1);
        const h2 = requests.find((r) => r.updateParagraphStyle?.paragraphStyle.namedStyleType === "HEADING_2");
        const h3 = requests.find((r) => r.updateParagraphStyle?.paragraphStyle.namedStyleType === "HEADING_3");
        expect(h2).toBeDefined();
        expect(h3).toBeDefined();
    });
});
