import { Tool, SchemaType, getActiveTab } from "./types";
import { addFile } from "@/lib/file-store";

export const screenshotTool: Tool = {
    name: "screenshot",
    description: "Takes a screenshot of the currently active webpage. By default captures the visible viewport. Use fullPage=true to capture the entire page including content below the fold.",
    enabledByDefault: true,
    supportedPlatforms: ['chrome'], // Uses chrome.tabs.captureVisibleTab

    defaultConfig: {},

    schema: {
        name: "screenshot",
        description: "Takes a screenshot of the webpage.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                fullPage: {
                    type: SchemaType.BOOLEAN,
                    description: "Set to true to capture the entire page including content below the fold. Default is false (viewport only).",
                },
                reason: {
                    type: SchemaType.STRING,
                    description: "Optional description of why the screenshot is being taken",
                },
            },
            required: [],
        },
    },

    execute: async (args) => {
        try {
            const fullPage = (args.fullPage as boolean) || false;

            // Get the current active tab
            const tab = await getActiveTab();

            // Send message to content script to capture screenshot
            // The content script has html2canvas bundled, avoiding CSP issues
            const result = await chrome.tabs.sendMessage(tab.id, {
                type: "CAPTURE_SCREENSHOT",
                fullPage,
            }) as {
                success: boolean;
                dataUrl?: string;
                width?: number;
                height?: number;
                originalWidth?: number;
                originalHeight?: number;
                fullPage?: boolean;
                error?: string;
            };

            if (!result?.success || !result.dataUrl) {
                return {
                    success: false,
                    error: result?.error || "Failed to capture screenshot",
                };
            }

            // Register image in FileStore for reference by other tools
            const imageRef = addFile(result.dataUrl, `screenshot_${Date.now()}.jpg`);

            return {
                success: true,
                data: {
                    imageRef,
                    imageDataUrl: result.dataUrl,
                    format: "jpeg",
                    quality: 92,
                    width: result.width,
                    height: result.height,
                    originalWidth: result.originalWidth,
                    originalHeight: result.originalHeight,
                    fullPage: result.fullPage || false,
                    tabTitle: tab.title,
                    tabUrl: tab.url,
                },
            };
        } catch (error) {
            // Handle case where content script is not loaded (e.g., chrome:// pages)
            const errorMessage = error instanceof Error ? error.message : "Screenshot failed";

            if (errorMessage.includes("No active tab")) {
                return {
                    success: false,
                    error: "No active tab found",
                };
            }

            if (errorMessage.includes("Could not establish connection") ||
                errorMessage.includes("Receiving end does not exist")) {
                return {
                    success: false,
                    error: "Cannot capture screenshot on this page (restricted page or extension not active)",
                };
            }

            return {
                success: false,
                error: errorMessage,
            };
        }
    },
};
