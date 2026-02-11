/**
 * Tests for read-page tool
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readPageTool } from "./read-page";

// Mock chrome APIs
const mockChrome = {
    tabs: {
        query: vi.fn(),
    },
    scripting: {
        executeScript: vi.fn(),
    },
};

vi.stubGlobal("chrome", mockChrome);

describe("readPageTool", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("tool definition", () => {
        it("should have correct name and description", () => {
            expect(readPageTool.name).toBe("read_page");
            expect(readPageTool.description).toContain("Reads and extracts");
        });

        it("should be enabled by default", () => {
            expect(readPageTool.enabledByDefault).toBe(true);
        });

        it("should only support chrome platform", () => {
            expect(readPageTool.supportedPlatforms).toEqual(["chrome"]);
        });

        it("should have optional parameters", () => {
            expect(readPageTool.schema.parameters?.required).toEqual([]);
            expect(readPageTool.schema.parameters?.properties).toHaveProperty("max_length");
            expect(readPageTool.schema.parameters?.properties).toHaveProperty("include_links");
        });
    });

    describe("execute", () => {
        it("should fail when no active tab found", async () => {
            mockChrome.tabs.query.mockResolvedValue([]);

            const result = await readPageTool.execute({}, readPageTool.defaultConfig);

            expect(result.success).toBe(false);
            expect(result.error).toContain("No active tab");
        });

        it("should fail on chrome:// pages", async () => {
            mockChrome.tabs.query.mockResolvedValue([{ id: 1, url: "chrome://extensions" }]);
            mockChrome.scripting.executeScript.mockRejectedValue(
                new Error("Cannot access a chrome:// URL")
            );

            const result = await readPageTool.execute({}, readPageTool.defaultConfig);

            expect(result.success).toBe(false);
            expect(result.error).toContain("Cannot read this page");
        });

        it("should extract page content successfully", async () => {
            mockChrome.tabs.query.mockResolvedValue([{ id: 1, url: "https://example.com" }]);
            mockChrome.scripting.executeScript.mockResolvedValue([{
                result: {
                    content: "# Page Title\n\nThis is the main content of the page.",
                    source: "main",
                    title: "Example Page",
                    url: "https://example.com",
                    truncated: false,
                    charCount: 50,
                },
            }]);

            const result = await readPageTool.execute({}, readPageTool.defaultConfig);

            expect(result.success).toBe(true);
            expect(result.data?.content).toContain("Page Title");
            expect(result.data?.source).toBe("main");
            expect(result.data?.title).toBe("Example Page");
            expect(result.data?.url).toBe("https://example.com");
            expect(result.data?.truncated).toBe(false);
        });

        it("should pass max_length parameter", async () => {
            mockChrome.tabs.query.mockResolvedValue([{ id: 1, url: "https://example.com" }]);
            mockChrome.scripting.executeScript.mockResolvedValue([{
                result: {
                    content: "Short content",
                    source: "body",
                    title: "Test",
                    url: "https://example.com",
                    truncated: false,
                    charCount: 13,
                },
            }]);

            const result = await readPageTool.execute(
                { max_length: 5000 },
                readPageTool.defaultConfig
            );

            expect(result.success).toBe(true);
            expect(mockChrome.scripting.executeScript).toHaveBeenCalledWith(
                expect.objectContaining({
                    args: [5000, false],
                })
            );
        });

        it("should pass include_links parameter", async () => {
            mockChrome.tabs.query.mockResolvedValue([{ id: 1, url: "https://example.com" }]);
            mockChrome.scripting.executeScript.mockResolvedValue([{
                result: {
                    content: "Content with link [https://example.com]",
                    source: "article",
                    title: "Test",
                    url: "https://example.com",
                    truncated: false,
                    charCount: 40,
                },
            }]);

            const result = await readPageTool.execute(
                { include_links: true },
                readPageTool.defaultConfig
            );

            expect(result.success).toBe(true);
            expect(mockChrome.scripting.executeScript).toHaveBeenCalledWith(
                expect.objectContaining({
                    args: [15000, true],
                })
            );
        });

        it("should fail when page content is empty", async () => {
            mockChrome.tabs.query.mockResolvedValue([{ id: 1, url: "https://example.com" }]);
            mockChrome.scripting.executeScript.mockResolvedValue([{
                result: {
                    content: "",
                    source: "body",
                    title: "",
                    url: "https://example.com",
                    truncated: false,
                    charCount: 0,
                },
            }]);

            const result = await readPageTool.execute({}, readPageTool.defaultConfig);

            expect(result.success).toBe(false);
            expect(result.error).toContain("empty");
        });

        it("should fail when script returns no result", async () => {
            mockChrome.tabs.query.mockResolvedValue([{ id: 1, url: "https://example.com" }]);
            mockChrome.scripting.executeScript.mockResolvedValue([]);

            const result = await readPageTool.execute({}, readPageTool.defaultConfig);

            expect(result.success).toBe(false);
            expect(result.error).toContain("Could not extract");
        });

        it("should handle truncated content", async () => {
            mockChrome.tabs.query.mockResolvedValue([{ id: 1, url: "https://example.com" }]);
            mockChrome.scripting.executeScript.mockResolvedValue([{
                result: {
                    content: "Very long content that was truncated...",
                    source: "main",
                    title: "Long Page",
                    url: "https://example.com",
                    truncated: true,
                    charCount: 15000,
                },
            }]);

            const result = await readPageTool.execute({}, readPageTool.defaultConfig);

            expect(result.success).toBe(true);
            expect(result.data?.truncated).toBe(true);
            expect(result.data?.charCount).toBe(15000);
        });

        it("should handle receiving end does not exist error", async () => {
            mockChrome.tabs.query.mockResolvedValue([{ id: 1, url: "https://example.com" }]);
            mockChrome.scripting.executeScript.mockRejectedValue(
                new Error("Receiving end does not exist")
            );

            const result = await readPageTool.execute({}, readPageTool.defaultConfig);

            expect(result.success).toBe(false);
            expect(result.error).toContain("Cannot read this page");
        });

        it("should handle generic script errors", async () => {
            mockChrome.tabs.query.mockResolvedValue([{ id: 1, url: "https://example.com" }]);
            mockChrome.scripting.executeScript.mockRejectedValue(
                new Error("Some unexpected error")
            );

            const result = await readPageTool.execute({}, readPageTool.defaultConfig);

            expect(result.success).toBe(false);
            expect(result.error).toBe("Some unexpected error");
        });

        it("should use default max_length of 15000", async () => {
            mockChrome.tabs.query.mockResolvedValue([{ id: 1, url: "https://example.com" }]);
            mockChrome.scripting.executeScript.mockResolvedValue([{
                result: {
                    content: "Test content",
                    source: "main",
                    title: "Test",
                    url: "https://example.com",
                    truncated: false,
                    charCount: 12,
                },
            }]);

            await readPageTool.execute({}, readPageTool.defaultConfig);

            expect(mockChrome.scripting.executeScript).toHaveBeenCalledWith(
                expect.objectContaining({
                    args: [15000, false],
                })
            );
        });
    });
});
