/**
 * Google Slides Tool
 * Provides operations for managing Google Slides presentations
 */

import { Tool, SchemaType, ToolExecutionResult } from "./types";
import { getGoogleAccessToken, createAuthHeaders, ScopeSets } from "./google-auth";

// =============================================================================
// Types
// =============================================================================

type GoogleSlidesOperation =
    | "list_presentations"
    | "get_presentation"
    | "create_presentation"
    | "add_slide"
    | "add_text"
    | "add_image"
    | "replace_text"
    | "delete_slide";

/** Context passed to all handlers */
interface SlidesContext {
    headers: HeadersInit;
}

/** Arguments passed to handlers */
interface SlidesArgs {
    [key: string]: unknown;
}

// =============================================================================
// Helper Functions
// =============================================================================

/** Extract a readable summary of slide elements */
function summarizeSlide(page: Record<string, unknown>): Record<string, unknown> {
    const objectId = page.objectId as string;
    const elements = (page.pageElements || []) as Record<string, unknown>[];

    const elementSummaries = elements.map((el) => {
        const elId = el.objectId as string;
        const shape = el.shape as Record<string, unknown> | undefined;
        const image = el.image as Record<string, unknown> | undefined;
        const table = el.table as Record<string, unknown> | undefined;

        if (shape) {
            const shapeType = shape.shapeType as string;
            const textContent = extractTextFromShape(shape);
            return { objectId: elId, type: "shape", shapeType, text: textContent || undefined };
        }
        if (image) {
            const sourceUrl = image.sourceUrl as string | undefined;
            return { objectId: elId, type: "image", sourceUrl };
        }
        if (table) {
            return { objectId: elId, type: "table", rows: (table.rows as number) || 0, columns: (table.columns as number) || 0 };
        }
        return { objectId: elId, type: "unknown" };
    });

    return {
        pageObjectId: objectId,
        elementCount: elements.length,
        elements: elementSummaries,
    };
}

/** Extract plain text from a shape element */
function extractTextFromShape(shape: Record<string, unknown>): string {
    const text = shape.text as { textElements?: Record<string, unknown>[] } | undefined;
    if (!text?.textElements) return "";

    return text.textElements
        .map((te) => {
            const textRun = te.textRun as { content?: string } | undefined;
            return textRun?.content || "";
        })
        .join("")
        .trim();
}

// =============================================================================
// Operation Handlers
// =============================================================================

async function handleListPresentations(args: SlidesArgs, ctx: SlidesContext): Promise<ToolExecutionResult> {
    const query = args.query as string | undefined;
    const limit = Math.min((args.limit as number) || 10, 50);

    let searchQuery = "mimeType='application/vnd.google-apps.presentation'";
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
        { headers: ctx.headers }
    );

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || `API error: ${response.status}`);
    }

    const data = await response.json();
    const files = (data.files || []).map((f: Record<string, unknown>) => ({
        id: f.id,
        title: f.name,
        createdTime: f.createdTime,
        modifiedTime: f.modifiedTime,
        url: f.webViewLink,
    }));

    return {
        success: true,
        data: { presentations: files, count: files.length },
    };
}

async function handleGetPresentation(args: SlidesArgs, ctx: SlidesContext): Promise<ToolExecutionResult> {
    const presentationId = args.presentationId as string;
    if (!presentationId) {
        return { success: false, error: "presentationId is required for get_presentation" };
    }

    const response = await fetch(
        `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(presentationId)}`,
        { headers: ctx.headers }
    );

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || `API error: ${response.status}`);
    }

    const presentation = await response.json();
    const slides = ((presentation.slides || []) as Record<string, unknown>[]).map(summarizeSlide);

    return {
        success: true,
        data: {
            presentationId: presentation.presentationId,
            title: presentation.title,
            slideCount: slides.length,
            slides,
            locale: presentation.locale,
        },
    };
}

async function handleCreatePresentation(args: SlidesArgs, ctx: SlidesContext): Promise<ToolExecutionResult> {
    const title = args.title as string;
    if (!title) {
        return { success: false, error: "title is required for create_presentation" };
    }

    const response = await fetch(
        "https://slides.googleapis.com/v1/presentations",
        {
            method: "POST",
            headers: ctx.headers,
            body: JSON.stringify({ title }),
        }
    );

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || `API error: ${response.status}`);
    }

    const presentation = await response.json();
    return {
        success: true,
        data: {
            presentationId: presentation.presentationId,
            title: presentation.title,
            url: `https://docs.google.com/presentation/d/${presentation.presentationId}/edit`,
            slideCount: (presentation.slides || []).length,
        },
    };
}

async function handleAddSlide(args: SlidesArgs, ctx: SlidesContext): Promise<ToolExecutionResult> {
    const presentationId = args.presentationId as string;
    if (!presentationId) {
        return { success: false, error: "presentationId is required for add_slide" };
    }

    const insertionIndex = args.insertionIndex as number | undefined;
    const layoutId = args.layoutId as string | undefined;

    const createSlideRequest: Record<string, unknown> = {};
    if (insertionIndex !== undefined) {
        createSlideRequest.insertionIndex = insertionIndex;
    }
    if (layoutId) {
        createSlideRequest.slideLayoutReference = { layoutId };
    }

    const response = await fetch(
        `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(presentationId)}:batchUpdate`,
        {
            method: "POST",
            headers: ctx.headers,
            body: JSON.stringify({
                requests: [{ createSlide: createSlideRequest }],
            }),
        }
    );

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || `API error: ${response.status}`);
    }

    const result = await response.json();
    const newSlideId = result.replies?.[0]?.createSlide?.objectId;
    const positionMsg = insertionIndex !== undefined ? " at position " + insertionIndex : "";

    return {
        success: true,
        data: {
            presentationId,
            newSlideId,
            message: "Slide created" + positionMsg,
        },
    };
}

async function handleAddText(args: SlidesArgs, ctx: SlidesContext): Promise<ToolExecutionResult> {
    const presentationId = args.presentationId as string;
    const objectId = args.objectId as string;
    const text = args.text as string;

    if (!presentationId) {
        return { success: false, error: "presentationId is required for add_text" };
    }
    if (!objectId) {
        return { success: false, error: "objectId is required for add_text (the shape/text box ID from get_presentation)" };
    }
    if (!text) {
        return { success: false, error: "text is required for add_text" };
    }

    const insertionIndex = args.insertionIndex as number | undefined;

    const insertTextRequest: Record<string, unknown> = {
        objectId,
        text,
    };
    if (insertionIndex !== undefined) {
        insertTextRequest.insertionIndex = insertionIndex;
    }

    const response = await fetch(
        `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(presentationId)}:batchUpdate`,
        {
            method: "POST",
            headers: ctx.headers,
            body: JSON.stringify({
                requests: [{ insertText: insertTextRequest }],
            }),
        }
    );

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || `API error: ${response.status}`);
    }

    return {
        success: true,
        data: {
            presentationId,
            objectId,
            message: `Inserted ${text.length} characters into shape "${objectId}"`,
        },
    };
}

async function handleAddImage(args: SlidesArgs, ctx: SlidesContext): Promise<ToolExecutionResult> {
    const presentationId = args.presentationId as string;
    const imageUrl = args.imageUrl as string;
    const pageObjectId = args.pageObjectId as string;

    if (!presentationId) {
        return { success: false, error: "presentationId is required for add_image" };
    }
    if (!imageUrl) {
        return { success: false, error: "imageUrl is required for add_image (publicly accessible URL)" };
    }
    if (!pageObjectId) {
        return { success: false, error: "pageObjectId is required for add_image (slide ID from get_presentation)" };
    }

    const width = (args.width as number) || 300;
    const height = (args.height as number) || 300;
    const x = (args.x as number) || 100;
    const y = (args.y as number) || 100;

    const response = await fetch(
        `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(presentationId)}:batchUpdate`,
        {
            method: "POST",
            headers: ctx.headers,
            body: JSON.stringify({
                requests: [{
                    createImage: {
                        url: imageUrl,
                        elementProperties: {
                            pageObjectId,
                            size: {
                                width: { magnitude: width, unit: "PT" },
                                height: { magnitude: height, unit: "PT" },
                            },
                            transform: {
                                scaleX: 1,
                                scaleY: 1,
                                translateX: x,
                                translateY: y,
                                unit: "PT",
                            },
                        },
                    },
                }],
            }),
        }
    );

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || `API error: ${response.status}`);
    }

    const result = await response.json();
    const newImageId = result.replies?.[0]?.createImage?.objectId;

    return {
        success: true,
        data: {
            presentationId,
            imageObjectId: newImageId,
            message: `Image added to slide "${pageObjectId}"`,
        },
    };
}

async function handleReplaceText(args: SlidesArgs, ctx: SlidesContext): Promise<ToolExecutionResult> {
    const presentationId = args.presentationId as string;
    const searchText = args.searchText as string;
    const replaceText = args.replaceText as string;

    if (!presentationId) {
        return { success: false, error: "presentationId is required for replace_text" };
    }
    if (!searchText) {
        return { success: false, error: "searchText is required for replace_text" };
    }
    if (typeof replaceText === "undefined") {
        return { success: false, error: "replaceText is required for replace_text (use empty string to delete)" };
    }

    const matchCase = (args.matchCase as boolean) ?? false;

    const response = await fetch(
        `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(presentationId)}:batchUpdate`,
        {
            method: "POST",
            headers: ctx.headers,
            body: JSON.stringify({
                requests: [{
                    replaceAllText: {
                        containsText: {
                            text: searchText,
                            matchCase,
                        },
                        replaceText,
                    },
                }],
            }),
        }
    );

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || `API error: ${response.status}`);
    }

    const result = await response.json();
    const occurrences = result.replies?.[0]?.replaceAllText?.occurrencesChanged || 0;

    return {
        success: true,
        data: {
            presentationId,
            occurrencesReplaced: occurrences,
            message: occurrences > 0
                ? `Replaced ${occurrences} occurrence(s) of "${searchText}"`
                : `No occurrences of "${searchText}" found`,
        },
    };
}

async function handleDeleteSlide(args: SlidesArgs, ctx: SlidesContext): Promise<ToolExecutionResult> {
    const presentationId = args.presentationId as string;
    const pageObjectId = args.pageObjectId as string;

    if (!presentationId) {
        return { success: false, error: "presentationId is required for delete_slide" };
    }
    if (!pageObjectId) {
        return { success: false, error: "pageObjectId is required for delete_slide (slide ID from get_presentation)" };
    }

    const response = await fetch(
        `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(presentationId)}:batchUpdate`,
        {
            method: "POST",
            headers: ctx.headers,
            body: JSON.stringify({
                requests: [{ deleteObject: { objectId: pageObjectId } }],
            }),
        }
    );

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || `API error: ${response.status}`);
    }

    return {
        success: true,
        data: {
            presentationId,
            deletedSlideId: pageObjectId,
            message: `Slide "${pageObjectId}" deleted`,
        },
    };
}

// =============================================================================
// Tool Definition
// =============================================================================

export const googleSlidesTool: Tool = {
    name: "google_slides",
    description: `Manage Google Slides presentations. Operations:
- list_presentations: List user's presentations (optional query filter)
- get_presentation: Get presentation metadata with slide summaries (element IDs, types, text)
- create_presentation: Create a new presentation
- add_slide: Add a new slide (optional position and layout)
- add_text: Insert text into a shape/text box (use objectId from get_presentation)
- add_image: Add an image from URL onto a slide
- replace_text: Find and replace text across all slides
- delete_slide: Delete a slide by its page ID`,
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
                const token = await getGoogleAccessToken(clientId, ScopeSets.SLIDES);
                if (token) return { success: true, message: "Connected! OAuth working." };
                return { success: false, message: "No token received" };
            } catch (e) {
                return { success: false, message: e instanceof Error ? e.message : "Auth failed" };
            }
        },
    },

    schema: {
        name: "google_slides",
        description: "Manage Google Slides presentations",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                operation: {
                    type: SchemaType.STRING,
                    description: "The operation to perform: 'list_presentations', 'get_presentation', 'create_presentation', 'add_slide', 'add_text', 'add_image', 'replace_text', 'delete_slide'",
                },
                presentationId: {
                    type: SchemaType.STRING,
                    description: "Presentation ID (from URL). Required for most operations except list and create",
                },
                title: {
                    type: SchemaType.STRING,
                    description: "Title for new presentation. Required for create_presentation",
                },
                objectId: {
                    type: SchemaType.STRING,
                    description: "Shape/text box element ID (from get_presentation). Required for add_text",
                },
                pageObjectId: {
                    type: SchemaType.STRING,
                    description: "Slide page ID (from get_presentation). Required for add_image, delete_slide",
                },
                text: {
                    type: SchemaType.STRING,
                    description: "Text to insert. Required for add_text",
                },
                imageUrl: {
                    type: SchemaType.STRING,
                    description: "Publicly accessible image URL. Required for add_image",
                },
                searchText: {
                    type: SchemaType.STRING,
                    description: "Text to search for. Required for replace_text",
                },
                replaceText: {
                    type: SchemaType.STRING,
                    description: "Replacement text. Required for replace_text (empty string to delete)",
                },
                matchCase: {
                    type: SchemaType.BOOLEAN,
                    description: "Case-sensitive matching for replace_text (default: false)",
                },
                insertionIndex: {
                    type: SchemaType.INTEGER,
                    description: "Position index for add_slide (0-based) or text insertion position for add_text",
                },
                layoutId: {
                    type: SchemaType.STRING,
                    description: "Layout ID for add_slide (from the presentation's layouts)",
                },
                width: {
                    type: SchemaType.NUMBER,
                    description: "Image width in points for add_image (default: 300)",
                },
                height: {
                    type: SchemaType.NUMBER,
                    description: "Image height in points for add_image (default: 300)",
                },
                x: {
                    type: SchemaType.NUMBER,
                    description: "Image X position in points for add_image (default: 100)",
                },
                y: {
                    type: SchemaType.NUMBER,
                    description: "Image Y position in points for add_image (default: 100)",
                },
                query: {
                    type: SchemaType.STRING,
                    description: "Search query for list_presentations",
                },
                limit: {
                    type: SchemaType.INTEGER,
                    description: "Max results for list_presentations (default: 10, max: 50)",
                },
            },
            required: ["operation"],
        },
    },

    execute: async (args, config) => {
        const operation = args.operation as GoogleSlidesOperation;
        const clientId = config?.clientId as string;

        if (!clientId) {
            return {
                success: false,
                error: "Google OAuth Client ID not configured. Please add it in Settings.",
            };
        }

        try {
            const token = await getGoogleAccessToken(clientId, ScopeSets.SLIDES);
            const headers = createAuthHeaders(token);
            const ctx: SlidesContext = { headers };

            switch (operation) {
                case "list_presentations":
                    return await handleListPresentations(args, ctx);
                case "get_presentation":
                    return await handleGetPresentation(args, ctx);
                case "create_presentation":
                    return await handleCreatePresentation(args, ctx);
                case "add_slide":
                    return await handleAddSlide(args, ctx);
                case "add_text":
                    return await handleAddText(args, ctx);
                case "add_image":
                    return await handleAddImage(args, ctx);
                case "replace_text":
                    return await handleReplaceText(args, ctx);
                case "delete_slide":
                    return await handleDeleteSlide(args, ctx);
                default:
                    return {
                        success: false,
                        error: `Unknown operation: ${operation}. Valid: list_presentations, get_presentation, create_presentation, add_slide, add_text, add_image, replace_text, delete_slide`,
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
