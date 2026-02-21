import { describe, it, expect, vi, beforeEach } from "vitest";

let googleSlidesTool: typeof import("./google-slides").googleSlidesTool;
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

describe("googleSlidesTool", () => {
    const mockConfig = {
        clientId: "test-client-id.apps.googleusercontent.com",
    };

    beforeEach(async () => {
        vi.clearAllMocks();
        mockLaunchWebAuthFlow.mockResolvedValue(
            "https://abcdefgh.chromiumapp.org/#access_token=mock-token&expires_in=3600"
        );
        vi.resetModules();
        ({ googleSlidesTool } = await import("./google-slides"));
    });

    describe("metadata", () => {
        it("should have correct name", () => {
            expect(googleSlidesTool.name).toBe("google_slides");
        });

        it("should be disabled by default", () => {
            expect(googleSlidesTool.enabledByDefault).toBe(false);
        });

        it("should have required operation parameter", () => {
            expect(googleSlidesTool.schema.parameters?.required).toContain("operation");
        });
    });

    describe("validation", () => {
        it("should fail when clientId is not configured", async () => {
            const result = await googleSlidesTool.execute(
                { operation: "list_presentations" },
                { clientId: "" }
            );
            expect(result.success).toBe(false);
            expect(result.error).toContain("Client ID not configured");
        });

        it("should fail for unknown operation", async () => {
            const result = await googleSlidesTool.execute(
                { operation: "unknown_op" },
                mockConfig
            );
            expect(result.success).toBe(false);
            expect(result.error).toContain("Unknown operation");
        });
    });

    describe("list_presentations", () => {
        it("should list presentations successfully", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    files: [
                        { id: "pres1", name: "Presentation 1", modifiedTime: "2024-01-01", webViewLink: "https://docs.google.com/presentation/d/pres1" },
                        { id: "pres2", name: "Presentation 2", modifiedTime: "2024-01-02", webViewLink: "https://docs.google.com/presentation/d/pres2" },
                    ]
                }),
            });

            const result = await googleSlidesTool.execute(
                { operation: "list_presentations" },
                mockConfig
            );

            expect(result.success).toBe(true);
            expect(getData(result).presentations).toHaveLength(2);
            expect(getData(result).count).toBe(2);
        });

        it("should handle empty list", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ files: [] }),
            });

            const result = await googleSlidesTool.execute(
                { operation: "list_presentations" },
                mockConfig
            );

            expect(result.success).toBe(true);
            expect(getData(result).presentations).toHaveLength(0);
        });

        it("should handle API error", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 403,
                json: () => Promise.resolve({ error: { message: "Access denied" } }),
            });

            const result = await googleSlidesTool.execute(
                { operation: "list_presentations" },
                mockConfig
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("Access denied");
        });
    });

    describe("get_presentation", () => {
        it("should get presentation with slide summaries", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    presentationId: "pres123",
                    title: "My Presentation",
                    locale: "en",
                    slides: [
                        {
                            objectId: "slide1",
                            pageElements: [
                                {
                                    objectId: "shape1",
                                    shape: {
                                        shapeType: "TEXT_BOX",
                                        text: { textElements: [{ textRun: { content: "Hello World" } }] },
                                    },
                                },
                                { objectId: "img1", image: { sourceUrl: "https://example.com/img.png" } },
                            ],
                        },
                    ],
                }),
            });

            const result = await googleSlidesTool.execute(
                { operation: "get_presentation", presentationId: "pres123" },
                mockConfig
            );

            expect(result.success).toBe(true);
            expect(getData(result).title).toBe("My Presentation");
            expect(getData(result).slideCount).toBe(1);
            expect(getData(result).slides[0].elementCount).toBe(2);
            expect(getData(result).slides[0].elements[0].type).toBe("shape");
            expect(getData(result).slides[0].elements[0].text).toBe("Hello World");
            expect(getData(result).slides[0].elements[1].type).toBe("image");
        });

        it("should fail without presentationId", async () => {
            const result = await googleSlidesTool.execute(
                { operation: "get_presentation" },
                mockConfig
            );
            expect(result.success).toBe(false);
            expect(result.error).toContain("presentationId is required");
        });

        it("should summarize table and unknown elements", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    presentationId: "pres-tables",
                    title: "Tables Test",
                    slides: [{
                        objectId: "slide1",
                        pageElements: [
                            { objectId: "tbl1", table: { rows: 3, columns: 4 } },
                            { objectId: "vid1", video: { source: "YOUTUBE" } },
                        ],
                    }],
                }),
            });

            const result = await googleSlidesTool.execute(
                { operation: "get_presentation", presentationId: "pres-tables" },
                mockConfig
            );

            expect(result.success).toBe(true);
            const elements = getData(result).slides[0].elements;
            expect(elements[0].type).toBe("table");
            expect(elements[0].rows).toBe(3);
            expect(elements[0].columns).toBe(4);
            expect(elements[1].type).toBe("unknown");
        });
    });

    describe("create_presentation", () => {
        it("should create presentation successfully", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    presentationId: "new-pres-id",
                    title: "New Presentation",
                    slides: [{ objectId: "slide1" }],
                }),
            });

            const result = await googleSlidesTool.execute(
                { operation: "create_presentation", title: "New Presentation" },
                mockConfig
            );

            expect(result.success).toBe(true);
            expect(getData(result).presentationId).toBe("new-pres-id");
            expect(getData(result).url).toContain("new-pres-id");
        });

        it("should fail without title", async () => {
            const result = await googleSlidesTool.execute(
                { operation: "create_presentation" },
                mockConfig
            );
            expect(result.success).toBe(false);
            expect(result.error).toContain("title is required");
        });
    });

    describe("add_slide", () => {
        it("should add a slide successfully", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    replies: [{ createSlide: { objectId: "new-slide-id" } }],
                }),
            });

            const result = await googleSlidesTool.execute(
                { operation: "add_slide", presentationId: "pres123" },
                mockConfig
            );

            expect(result.success).toBe(true);
            expect(getData(result).newSlideId).toBe("new-slide-id");
        });

        it("should add slide at specific position", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    replies: [{ createSlide: { objectId: "new-slide-id" } }],
                }),
            });

            const result = await googleSlidesTool.execute(
                { operation: "add_slide", presentationId: "pres123", insertionIndex: 2 },
                mockConfig
            );

            expect(result.success).toBe(true);
            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.requests[0].createSlide.insertionIndex).toBe(2);
        });

        it("should fail without presentationId", async () => {
            const result = await googleSlidesTool.execute(
                { operation: "add_slide" },
                mockConfig
            );
            expect(result.success).toBe(false);
            expect(result.error).toContain("presentationId is required");
        });

        it("should add slide with layoutId", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    replies: [{ createSlide: { objectId: "new-slide" } }],
                }),
            });

            const result = await googleSlidesTool.execute(
                { operation: "add_slide", presentationId: "pres123", layoutId: "TITLE_SLIDE" },
                mockConfig
            );

            expect(result.success).toBe(true);
            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.requests[0].createSlide.slideLayoutReference.layoutId).toBe("TITLE_SLIDE");
        });
    });

    describe("add_text", () => {
        it("should insert text into a shape", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ replies: [{}] }),
            });

            const result = await googleSlidesTool.execute(
                { operation: "add_text", presentationId: "pres123", objectId: "shape1", text: "Hello" },
                mockConfig
            );

            expect(result.success).toBe(true);
            expect(getData(result).message).toContain("5 characters");
        });

        it("should fail without objectId", async () => {
            const result = await googleSlidesTool.execute(
                { operation: "add_text", presentationId: "pres123", text: "Hello" },
                mockConfig
            );
            expect(result.success).toBe(false);
            expect(result.error).toContain("objectId is required");
        });

        it("should fail without text", async () => {
            const result = await googleSlidesTool.execute(
                { operation: "add_text", presentationId: "pres123", objectId: "shape1" },
                mockConfig
            );
            expect(result.success).toBe(false);
            expect(result.error).toContain("text is required");
        });

        it("should insert text at specific index", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ replies: [{}] }),
            });

            const result = await googleSlidesTool.execute(
                { operation: "add_text", presentationId: "pres123", objectId: "shape1", text: "Hi", insertionIndex: 5 },
                mockConfig
            );

            expect(result.success).toBe(true);
            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.requests[0].insertText.insertionIndex).toBe(5);
        });
    });

    describe("add_image", () => {
        it("should add image to a slide", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    replies: [{ createImage: { objectId: "img-id" } }],
                }),
            });

            const result = await googleSlidesTool.execute(
                { operation: "add_image", presentationId: "pres123", pageObjectId: "slide1", imageUrl: "https://example.com/img.png" },
                mockConfig
            );

            expect(result.success).toBe(true);
            expect(getData(result).imageObjectId).toBe("img-id");
        });

        it("should fail without imageUrl", async () => {
            const result = await googleSlidesTool.execute(
                { operation: "add_image", presentationId: "pres123", pageObjectId: "slide1" },
                mockConfig
            );
            expect(result.success).toBe(false);
            expect(result.error).toContain("imageUrl is required");
        });

        it("should fail without pageObjectId", async () => {
            const result = await googleSlidesTool.execute(
                { operation: "add_image", presentationId: "pres123", imageUrl: "https://example.com/img.png" },
                mockConfig
            );
            expect(result.success).toBe(false);
            expect(result.error).toContain("pageObjectId is required");
        });
    });

    describe("replace_text", () => {
        it("should replace text across all slides", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    replies: [{ replaceAllText: { occurrencesChanged: 3 } }],
                }),
            });

            const result = await googleSlidesTool.execute(
                { operation: "replace_text", presentationId: "pres123", searchText: "old", replaceText: "new" },
                mockConfig
            );

            expect(result.success).toBe(true);
            expect(getData(result).occurrencesReplaced).toBe(3);
        });

        it("should handle zero replacements", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    replies: [{ replaceAllText: { occurrencesChanged: 0 } }],
                }),
            });

            const result = await googleSlidesTool.execute(
                { operation: "replace_text", presentationId: "pres123", searchText: "nonexistent", replaceText: "" },
                mockConfig
            );

            expect(result.success).toBe(true);
            expect(getData(result).occurrencesReplaced).toBe(0);
            expect(getData(result).message).toContain("No occurrences");
        });

        it("should fail without searchText", async () => {
            const result = await googleSlidesTool.execute(
                { operation: "replace_text", presentationId: "pres123", replaceText: "new" },
                mockConfig
            );
            expect(result.success).toBe(false);
            expect(result.error).toContain("searchText is required");
        });
    });

    describe("delete_slide", () => {
        it("should delete a slide", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ replies: [{}] }),
            });

            const result = await googleSlidesTool.execute(
                { operation: "delete_slide", presentationId: "pres123", pageObjectId: "slide1" },
                mockConfig
            );

            expect(result.success).toBe(true);
            expect(getData(result).deletedSlideId).toBe("slide1");
        });

        it("should fail without pageObjectId", async () => {
            const result = await googleSlidesTool.execute(
                { operation: "delete_slide", presentationId: "pres123" },
                mockConfig
            );
            expect(result.success).toBe(false);
            expect(result.error).toContain("pageObjectId is required");
        });
    });

    describe("OAuth", () => {
        it("should request OAuth token with presentations scope", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ files: [] }),
            });

            await googleSlidesTool.execute(
                { operation: "list_presentations" },
                mockConfig
            );

            expect(mockLaunchWebAuthFlow).toHaveBeenCalled();
            const authUrl = mockLaunchWebAuthFlow.mock.calls[0][0].url;
            expect(authUrl).toContain("presentations");
        });

        it("should handle OAuth failure", async () => {
            mockLaunchWebAuthFlow.mockRejectedValueOnce(new Error("User cancelled"));

            const result = await googleSlidesTool.execute(
                { operation: "list_presentations" },
                mockConfig
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("auth token");
        });

        it("should cache OAuth token", async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ files: [] }),
            });

            await googleSlidesTool.execute(
                { operation: "list_presentations" },
                mockConfig
            );
            await googleSlidesTool.execute(
                { operation: "list_presentations" },
                mockConfig
            );

            expect(mockLaunchWebAuthFlow).toHaveBeenCalledTimes(1);
        });
    });
});
