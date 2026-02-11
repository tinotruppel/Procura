import { describe, it, expect, vi, beforeEach } from "vitest";

let googleDocsTool: typeof import("./google-docs").googleDocsTool;
const getData = (result: { data?: unknown }) => result.data as any;

// Mock @/platform to always return extension mode for these tests
vi.mock("@/platform", () => ({
    isExtension: vi.fn(() => true),
    isWeb: vi.fn(() => false),
}));

// Mock chrome.identity API for launchWebAuthFlow
const mockLaunchWebAuthFlow = vi.fn();
const mockGetRedirectURL = vi.fn(() => "https://abcdefgh.chromiumapp.org/");
vi.stubGlobal("chrome", {
    identity: {
        launchWebAuthFlow: mockLaunchWebAuthFlow,
        getRedirectURL: mockGetRedirectURL,
    },
});

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("googleDocsTool", () => {
    const mockConfig = {
        clientId: "test-client-id.apps.googleusercontent.com",
    };

    beforeEach(async () => {
        vi.clearAllMocks();
        // Mock successful OAuth flow - returns URL with token in hash
        mockLaunchWebAuthFlow.mockResolvedValue(
            "https://abcdefgh.chromiumapp.org/#access_token=mock-token&expires_in=3600"
        );

        vi.resetModules();
        ({ googleDocsTool } = await import("./google-docs"));
    });

    describe("metadata", () => {
        it("should have correct name", () => {
            expect(googleDocsTool.name).toBe("google_docs");
        });

        it("should be disabled by default", () => {
            expect(googleDocsTool.enabledByDefault).toBe(false);
        });

        it("should have required operation parameter", () => {
            expect(googleDocsTool.schema.parameters?.required).toContain("operation");
        });
    });

    describe("validation", () => {
        it("should fail when clientId is not configured", async () => {
            const result = await googleDocsTool.execute(
                { operation: "list_documents" },
                { clientId: "" }
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("Client ID is not configured");
        });

        it("should fail for unknown operation", async () => {
            const result = await googleDocsTool.execute(
                { operation: "unknown" },
                mockConfig
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("Unknown operation");
        });
    });

    describe("list_documents", () => {
        it("should list documents successfully", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    files: [
                        { id: "doc1", name: "Document 1", modifiedTime: "2024-01-01" },
                        { id: "doc2", name: "Document 2", modifiedTime: "2024-01-02" },
                    ]
                }),
            });

            const result = await googleDocsTool.execute(
                { operation: "list_documents" },
                mockConfig
            );

            expect(result.success).toBe(true);
            expect(getData(result).documents).toHaveLength(2);
            expect(getData(result).count).toBe(2);
        });

        it("should include search query in request", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ files: [] }),
            });

            await googleDocsTool.execute(
                { operation: "list_documents", query: "meeting notes" },
                mockConfig
            );

            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining("fullText"),
                expect.any(Object)
            );
        });
    });

    describe("get_document", () => {
        it("should fail without documentId", async () => {
            const result = await googleDocsTool.execute(
                { operation: "get_document" },
                mockConfig
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("documentId is required");
        });

        it("should get document successfully", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    documentId: "doc123",
                    title: "Test Document",
                    body: {
                        content: [
                            {
                                paragraph: {
                                    elements: [{ textRun: { content: "Hello World" } }]
                                }
                            }
                        ]
                    }
                }),
            });

            const result = await googleDocsTool.execute(
                { operation: "get_document", documentId: "doc123" },
                mockConfig
            );

            expect(result.success).toBe(true);
            expect(getData(result).title).toBe("Test Document");
            expect(getData(result).content).toContain("Hello World");
        });
    });

    describe("create_document", () => {
        it("should fail without title", async () => {
            const result = await googleDocsTool.execute(
                { operation: "create_document" },
                mockConfig
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("title is required");
        });

        it("should create document successfully", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    documentId: "new-doc-123",
                    title: "New Document",
                }),
            });

            const result = await googleDocsTool.execute(
                { operation: "create_document", title: "New Document" },
                mockConfig
            );

            expect(result.success).toBe(true);
            expect(getData(result).documentId).toBe("new-doc-123");
            expect(getData(result).url).toContain("new-doc-123");
        });

        it("should create document with content", async () => {
            // Create response
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ documentId: "new-doc", title: "Test" }),
            });
            // Update response
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({}),
            });

            const result = await googleDocsTool.execute(
                { operation: "create_document", title: "Test", content: "Hello" },
                mockConfig
            );

            expect(result.success).toBe(true);
            expect(mockFetch).toHaveBeenCalledTimes(2);
        });
    });

    describe("append_text", () => {
        it("should fail without documentId", async () => {
            const result = await googleDocsTool.execute(
                { operation: "append_text", content: "text" },
                mockConfig
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("documentId is required");
        });

        it("should fail without content", async () => {
            const result = await googleDocsTool.execute(
                { operation: "append_text", documentId: "doc123" },
                mockConfig
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("content is required");
        });

        it("should append text successfully", async () => {
            // Get document response
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    documentId: "doc123",
                    title: "Test",
                    body: { content: [{ endIndex: 50 }] }
                }),
            });
            // Update response
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({}),
            });

            const result = await googleDocsTool.execute(
                { operation: "append_text", documentId: "doc123", content: "New text" },
                mockConfig
            );

            expect(result.success).toBe(true);
            expect(getData(result).message).toContain("Appended");
        });

        it("should convert horizontal rule to visual separator", async () => {
            // Get response with endIndex
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    documentId: "doc123",
                    body: { content: [{ endIndex: 10 }] },
                }),
            });
            // Update response
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({}),
            });

            const result = await googleDocsTool.execute(
                { operation: "append_text", documentId: "doc123", content: "Before\n---\nAfter" },
                mockConfig
            );

            expect(result.success).toBe(true);
            // Check that the batchUpdate was called with text containing visual separator
            const updateCall = mockFetch.mock.calls[1];
            const requestBody = JSON.parse(updateCall[1].body);
            // The insertText should contain the visual line separator, not ---
            const insertRequest = requestBody.requests.find((r: { insertText?: unknown }) => r.insertText);
            expect(insertRequest.insertText.text).toContain("────");
            expect(insertRequest.insertText.text).not.toContain("---");
        });
    });

    describe("error handling", () => {
        it("should handle auth token failure", async () => {
            mockLaunchWebAuthFlow.mockRejectedValueOnce(new Error("User denied access"));

            const result = await googleDocsTool.execute(
                { operation: "list_documents" },
                mockConfig
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("auth token");
        });

        it("should handle API errors", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 403,
                text: () => Promise.resolve("Forbidden"),
            });

            const result = await googleDocsTool.execute(
                { operation: "list_documents" },
                mockConfig
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("403");
        });
    });

    describe("replace_text", () => {
        it("should fail without documentId", async () => {
            const result = await googleDocsTool.execute(
                { operation: "replace_text", searchText: "old", replaceText: "new" },
                mockConfig
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("documentId");
        });

        it("should fail without searchText", async () => {
            const result = await googleDocsTool.execute(
                { operation: "replace_text", documentId: "doc123", replaceText: "new" },
                mockConfig
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("searchText");
        });

        it("should fail without replaceText", async () => {
            const result = await googleDocsTool.execute(
                { operation: "replace_text", documentId: "doc123", searchText: "old" },
                mockConfig
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("replaceText");
        });

        it("should replace text successfully", async () => {
            // First GET document to find occurrences
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    documentId: "doc123",
                    title: "Test",
                    body: {
                        content: [
                            { paragraph: { elements: [{ textRun: { content: "This is old text. And old again. More old here." } }] } }
                        ]
                    }
                }),
            });
            // Then batchUpdate
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({}),
            });

            const result = await googleDocsTool.execute(
                { operation: "replace_text", documentId: "doc123", searchText: "old", replaceText: "**new**" },
                mockConfig
            );

            expect(result.success).toBe(true);
            expect(getData(result).occurrencesReplaced).toBe(3);
            expect(getData(result).message).toContain("Replaced 3");
        });

        it("should report when no occurrences found", async () => {
            // GET document with no matching text
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    documentId: "doc123",
                    title: "Test",
                    body: {
                        content: [
                            { paragraph: { elements: [{ textRun: { content: "Nothing matches here." } }] } }
                        ]
                    }
                }),
            });

            const result = await googleDocsTool.execute(
                { operation: "replace_text", documentId: "doc123", searchText: "old", replaceText: "new" },
                mockConfig
            );

            expect(result.success).toBe(true);
            expect(getData(result).occurrencesReplaced).toBe(0);
            expect(getData(result).message).toContain("No occurrences");
        });
    });

    describe("rename_document", () => {
        it("should fail without documentId", async () => {
            const result = await googleDocsTool.execute(
                { operation: "rename_document", title: "New Title" },
                mockConfig
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("documentId");
        });

        it("should fail without title", async () => {
            const result = await googleDocsTool.execute(
                { operation: "rename_document", documentId: "doc123" },
                mockConfig
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("title");
        });

        it("should rename document successfully", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ id: "doc123", name: "New Title" }),
            });

            const result = await googleDocsTool.execute(
                { operation: "rename_document", documentId: "doc123", title: "New Title" },
                mockConfig
            );

            expect(result.success).toBe(true);
            expect(getData(result).title).toBe("New Title");
            expect(getData(result).message).toContain("renamed");
        });
    });

    describe("markdown tables", () => {
        it("should parse markdown table and insert into document", async () => {
            // Mock GET document response
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    documentId: "doc123",
                    title: "Test",
                    body: {
                        content: [{ paragraph: { elements: [{ textRun: { content: "Test" }, endIndex: 5 }] } }]
                    }
                }),
            });
            // Mock batchUpdate for text
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({}),
            });
            // Mock insertTable
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({}),
            });
            // Mock GET document for cell indices
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    documentId: "doc123",
                    body: {
                        content: [
                            { paragraph: {} },
                            {
                                table: {
                                    tableRows: [
                                        {
                                            tableCells: [
                                                { content: [{ paragraph: { elements: [{ startIndex: 10 }] } }] },
                                                { content: [{ paragraph: { elements: [{ startIndex: 15 }] } }] }
                                            ]
                                        },
                                        {
                                            tableCells: [
                                                { content: [{ paragraph: { elements: [{ startIndex: 20 }] } }] },
                                                { content: [{ paragraph: { elements: [{ startIndex: 25 }] } }] }
                                            ]
                                        }
                                    ]
                                },
                                startIndex: 6
                            }
                        ]
                    }
                }),
            });
            // Mock batchUpdate for cell content
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({}),
            });

            const markdownWithTable = `Some text

| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |`;

            const result = await googleDocsTool.execute(
                { operation: "append_text", documentId: "doc123", content: markdownWithTable },
                mockConfig
            );

            expect(result.success).toBe(true);
            expect(getData(result).message).toContain("Appended");
        });
    });
});
