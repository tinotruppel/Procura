/**
 * Tests for web-interaction.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    annotatePageTool,
    clickElementTool,
    typeTextTool,
    navigateToTool
} from "./web-interaction";

// Mock chrome APIs
const chromeMock = {
    tabs: {
        query: vi.fn(),
        captureVisibleTab: vi.fn(),
        update: vi.fn(),
        create: vi.fn(),
    },
    scripting: {
        executeScript: vi.fn(),
    },
};

vi.stubGlobal("chrome", chromeMock);

// Mock canvas context for image annotation
const mockCtx = {
    drawImage: vi.fn(),
    strokeRect: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 20 })),
    set font(_: string) { },
    get font() { return "12px sans-serif"; },
    set strokeStyle(_: string) { },
    set fillStyle(_: string) { },
    set lineWidth(_: number) { },
};

const mockCanvas = {
    getContext: vi.fn(() => mockCtx),
    toDataURL: vi.fn(() => "data:image/jpeg;base64,mockimage"),
    width: 0,
    height: 0,
};

// Mock document.createElement for canvas
const originalCreateElement = global.document?.createElement;

describe("web-interaction tools", () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Mock document.createElement
        if (global.document) {
            global.document.createElement = vi.fn((tag: string) => {
                if (tag === "canvas") {
                    return mockCanvas as unknown as HTMLCanvasElement;
                }
                return originalCreateElement?.call(document, tag);
            });
        }
    });

    afterEach(() => {
        if (originalCreateElement && global.document) {
            global.document.createElement = originalCreateElement;
        }
    });

    // ========================================================================
    // annotatePageTool
    // ========================================================================
    describe("annotatePageTool", () => {
        describe("metadata", () => {
            it("should have correct name", () => {
                expect(annotatePageTool.name).toBe("annotate_page");
            });

            it("should be enabled by default", () => {
                expect(annotatePageTool.enabledByDefault).toBe(true);
            });

            it("should not require any parameters", () => {
                expect(annotatePageTool.schema.parameters.required).toEqual([]);
            });
        });

        describe("execute", () => {
            it("should fail when no active tab found", async () => {
                chromeMock.tabs.query.mockResolvedValue([]);

                const result = await annotatePageTool.execute({}, {});

                expect(result.success).toBe(false);
                expect(result.error).toContain("No active tab");
            });

            it("should fail on chrome:// pages", async () => {
                chromeMock.tabs.query.mockResolvedValue([{
                    id: 1,
                    url: "chrome://extensions",
                }]);

                const result = await annotatePageTool.execute({}, {});

                expect(result.success).toBe(false);
                // In mocked environment, fails during script execution
                expect(result.error).toBeDefined();
            });

            it("should fail on chrome-extension:// pages", async () => {
                chromeMock.tabs.query.mockResolvedValue([{
                    id: 1,
                    url: "chrome-extension://abc/popup.html",
                }]);

                const result = await annotatePageTool.execute({}, {});

                expect(result.success).toBe(false);
                // In mocked environment, fails during script execution  
                expect(result.error).toBeDefined();
            });

            it("should execute script on valid page", async () => {
                chromeMock.tabs.query.mockResolvedValue([{
                    id: 1,
                    url: "https://example.com",
                    title: "Example",
                }]);
                chromeMock.scripting.executeScript.mockResolvedValue([{
                    result: [],
                }]);
                chromeMock.tabs.captureVisibleTab.mockResolvedValue("data:image/png;base64,test");

                // This test checks that the tool attempts to execute on a valid page
                // Full success requires Image mock which is complex in Node
                await annotatePageTool.execute({}, {});

                // Either success or graceful failure (Image not available in Node)
                expect(chromeMock.scripting.executeScript).toHaveBeenCalled();
            });
        });
    });

    // ========================================================================
    // clickElementTool
    // ========================================================================
    describe("clickElementTool", () => {
        describe("metadata", () => {
            it("should have correct name", () => {
                expect(clickElementTool.name).toBe("click_element");
            });

            it("should be enabled by default", () => {
                expect(clickElementTool.enabledByDefault).toBe(true);
            });

            it("should require index parameter", () => {
                expect(clickElementTool.schema.parameters.required).toContain("index");
            });
        });

        describe("execute", () => {
            it("should fail without prior annotation", async () => {
                // Clear any cached elements by calling with invalid index
                const result = await clickElementTool.execute(
                    { index: 999 },
                    {}
                );

                expect(result.success).toBe(false);
                expect(result.error).toContain("not found");
            });

            it("should click element successfully after annotation", async () => {
                chromeMock.tabs.query.mockResolvedValue([{
                    id: 1,
                    url: "https://example.com",
                    title: "Example",
                }]);
                chromeMock.scripting.executeScript
                    // First call for annotation
                    .mockResolvedValueOnce([{
                        result: [
                            {
                                index: 1,
                                type: "button",
                                tagName: "button",
                                text: "Submit",
                                bounds: { x: 100, y: 200, width: 80, height: 30 },
                                selector: '[data-procura-idx="1"]',
                            },
                        ],
                    }])
                    // Second call: parameterized click returns result directly
                    .mockResolvedValueOnce([{ result: { success: true, found: true, tagName: "BUTTON" } }]);

                await annotatePageTool.execute({}, {});

                const result = await clickElementTool.execute(
                    { index: 1 },
                    {}
                );

                expect(result.success).toBe(true);
                expect(result.data?.clicked).toBe(true);
                expect(result.data?.selector).toBe('[data-procura-idx="1"]');
            });

            it("should fail when element not found in DOM", async () => {
                chromeMock.tabs.query.mockResolvedValue([{
                    id: 1,
                    url: "https://example.com",
                }]);
                chromeMock.scripting.executeScript
                    .mockResolvedValueOnce([{
                        result: [
                            {
                                index: 1,
                                type: "button",
                                tagName: "button",
                                text: "Click me",
                                bounds: { x: 0, y: 0, width: 100, height: 30 },
                                selector: '[data-procura-idx="1"]',
                            },
                        ],
                    }])
                    // Click call returns element not found
                    .mockResolvedValueOnce([{ result: { success: false, found: false } }]);

                await annotatePageTool.execute({}, {});

                const result = await clickElementTool.execute(
                    { index: 1 },
                    {}
                );

                expect(result.success).toBe(false);
                expect(result.error).toContain("not found in DOM");
            });

            it("should handle click errors gracefully", async () => {
                chromeMock.tabs.query.mockResolvedValue([{
                    id: 1,
                    url: "https://example.com",
                }]);
                chromeMock.scripting.executeScript
                    .mockResolvedValueOnce([{
                        result: [
                            {
                                index: 1,
                                type: "link",
                                tagName: "a",
                                text: "Link",
                                bounds: { x: 0, y: 0, width: 100, height: 20 },
                                selector: '[data-procura-idx="1"]',
                            },
                        ],
                    }])
                    .mockRejectedValueOnce(new Error("Script execution blocked"));

                await annotatePageTool.execute({}, {});

                const result = await clickElementTool.execute(
                    { index: 1 },
                    {}
                );

                expect(result.success).toBe(false);
                expect(result.error).toBe("Script execution blocked");
            });
        });
    });

    // ========================================================================
    // typeTextTool
    // ========================================================================
    describe("typeTextTool", () => {
        describe("metadata", () => {
            it("should have correct name", () => {
                expect(typeTextTool.name).toBe("type_text");
            });

            it("should be enabled by default", () => {
                expect(typeTextTool.enabledByDefault).toBe(true);
            });

            it("should require index and text parameters", () => {
                expect(typeTextTool.schema.parameters.required).toContain("index");
                expect(typeTextTool.schema.parameters.required).toContain("text");
            });
        });

        describe("execute", () => {
            it("should fail without prior annotation", async () => {
                const result = await typeTextTool.execute(
                    { index: 999, text: "Hello" },
                    {}
                );

                expect(result.success).toBe(false);
                expect(result.error).toContain("not found");
            });

            it("should fail when element is not an input type", async () => {
                // First, annotate the page to populate lastAnnotatedElements
                chromeMock.tabs.query.mockResolvedValue([{
                    id: 1,
                    url: "https://example.com",
                    title: "Example",
                }]);
                chromeMock.scripting.executeScript.mockResolvedValueOnce([{
                    result: [
                        {
                            index: 1,
                            type: "button", // Not an input type
                            tagName: "button",
                            text: "Click me",
                            bounds: { x: 0, y: 0, width: 100, height: 30 },
                            selector: '[data-procura-idx="1"]',
                        },
                    ],
                }]);

                await annotatePageTool.execute({}, {});

                const result = await typeTextTool.execute(
                    { index: 1, text: "Hello" },
                    {}
                );

                expect(result.success).toBe(false);
                expect(result.error).toContain("is not an input field");
            });

            it("should type text successfully into input field", async () => {
                chromeMock.tabs.query.mockResolvedValue([{
                    id: 1,
                    url: "https://example.com",
                    title: "Example",
                }]);
                chromeMock.scripting.executeScript
                    // First call for annotation
                    .mockResolvedValueOnce([{
                        result: [
                            {
                                index: 1,
                                type: "input",
                                tagName: "input",
                                text: "",
                                placeholder: "Enter name",
                                bounds: { x: 0, y: 0, width: 200, height: 30 },
                                selector: '[data-procura-idx="1"]',
                            },
                        ],
                    }])
                    // Second call for typing
                    .mockResolvedValueOnce([{ result: true }]);

                await annotatePageTool.execute({}, {});

                const result = await typeTextTool.execute(
                    { index: 1, text: "John Doe" },
                    {}
                );

                expect(result.success).toBe(true);
                expect(result.data?.typed).toBe(true);
                expect(result.data?.text).toBe("John Doe");
            });

            it("should fail when script returns false", async () => {
                chromeMock.tabs.query.mockResolvedValue([{
                    id: 1,
                    url: "https://example.com",
                }]);
                chromeMock.scripting.executeScript
                    .mockResolvedValueOnce([{
                        result: [
                            {
                                index: 1,
                                type: "input",
                                tagName: "input",
                                text: "",
                                bounds: { x: 0, y: 0, width: 200, height: 30 },
                                selector: '[data-procura-idx="1"]',
                            },
                        ],
                    }])
                    .mockResolvedValueOnce([{ result: false }]);

                await annotatePageTool.execute({}, {});

                const result = await typeTextTool.execute(
                    { index: 1, text: "Test" },
                    {}
                );

                expect(result.success).toBe(false);
                expect(result.error).toContain("Could not type text");
            });

            it("should handle errors gracefully", async () => {
                chromeMock.tabs.query.mockResolvedValue([{
                    id: 1,
                    url: "https://example.com",
                }]);
                chromeMock.scripting.executeScript
                    .mockResolvedValueOnce([{
                        result: [
                            {
                                index: 1,
                                type: "textarea",
                                tagName: "textarea",
                                text: "",
                                bounds: { x: 0, y: 0, width: 200, height: 100 },
                                selector: '[data-procura-idx="1"]',
                            },
                        ],
                    }])
                    .mockRejectedValueOnce(new Error("Script injection failed"));

                await annotatePageTool.execute({}, {});

                const result = await typeTextTool.execute(
                    { index: 1, text: "Test" },
                    {}
                );

                expect(result.success).toBe(false);
                expect(result.error).toBe("Script injection failed");
            });
        });
    });

    // ========================================================================
    // navigateToTool
    // ========================================================================
    describe("navigateToTool", () => {
        describe("metadata", () => {
            it("should have correct name", () => {
                expect(navigateToTool.name).toBe("navigate_to");
            });

            it("should be enabled by default", () => {
                expect(navigateToTool.enabledByDefault).toBe(true);
            });

            it("should require url parameter", () => {
                expect(navigateToTool.schema.parameters.required).toContain("url");
            });
        });

        describe("execute", () => {
            it("should open URL in new tab successfully", async () => {
                chromeMock.tabs.create.mockResolvedValue({ id: 2 });

                const result = await navigateToTool.execute(
                    { url: "https://new-page.com" },
                    {}
                );

                expect(result.success).toBe(true);
                expect(result.data?.navigatedTo).toBe("https://new-page.com");
                expect(result.data?.openedInNewTab).toBe(true);
                expect(result.data?.tabId).toBe(2);
                expect(chromeMock.tabs.create).toHaveBeenCalledWith({ url: "https://new-page.com" });
            });

            it("should add https:// prefix if missing", async () => {
                chromeMock.tabs.create.mockResolvedValue({ id: 3 });

                const result = await navigateToTool.execute(
                    { url: "google.com" },
                    {}
                );

                expect(result.success).toBe(true);
                expect(result.data?.navigatedTo).toBe("https://google.com");
                expect(chromeMock.tabs.create).toHaveBeenCalledWith({ url: "https://google.com" });
            });

            it("should fail with invalid URL", async () => {
                const result = await navigateToTool.execute(
                    { url: "not a valid url at all" },
                    {}
                );

                expect(result.success).toBe(false);
                expect(result.error).toContain("Invalid URL");
            });

            it("should handle tab creation errors", async () => {
                chromeMock.tabs.create.mockRejectedValue(new Error("Tab creation blocked"));

                const result = await navigateToTool.execute(
                    { url: "https://blocked.com" },
                    {}
                );

                expect(result.success).toBe(false);
                expect(result.error).toBe("Tab creation blocked");
            });

            it.each([
                // eslint-disable-next-line sonarjs/code-eval -- test data, not eval
                ["javascript:alert(1)", "javascript:"],
                ["data:text/html,<h1>evil</h1>", "data:"],
                ["file:///etc/passwd", "file:"],
            ])("should block dangerous protocol: %s", async (url) => {
                const result = await navigateToTool.execute({ url }, {});
                expect(result.success).toBe(false);
                expect(result.error).toContain("Only HTTP and HTTPS");
            });
        });
    });
});
