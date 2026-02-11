/**
 * Web Interaction Tools
 * Tools for interacting with web pages: annotate visible elements, click, and type.
 */
import { Tool, SchemaType, getActiveTab } from "./types";
import { addFile } from "@/lib/file-store";

// ============================================================================
// Types
// ============================================================================

interface ElementInfo {
    index: number;
    type: "button" | "link" | "input" | "select" | "textarea" | "checkbox" | "radio" | "other";
    tagName: string;
    text: string;
    ariaLabel?: string;
    title?: string;
    placeholder?: string;
    inputType?: string;
    options?: string[];
    checked?: boolean;
    bounds: { x: number; y: number; width: number; height: number };
    selector: string;
}

// Store the last annotated elements for click/type operations
let lastAnnotatedElements: ElementInfo[] = [];

/** Reset annotation state (call on chat switch to prevent cross-session leaks) */
export function clearAnnotationState(): void {
    lastAnnotatedElements = [];
}

// ============================================================================
// Content Script Functions (executed in page context)
// ============================================================================

/**
 * Content script to extract interactive elements from the page
 */
function getInteractiveElementsScript(): ElementInfo[] {
    const interactiveSelectors = [
        "button",
        "a[href]",
        "input:not([type='hidden'])",
        "textarea",
        "select",
        "[role='button']",
        "[role='link']",
        "[role='checkbox']",
        "[role='menuitem']",
        "[role='tab']",
        "[onclick]",
        "[tabindex]:not([tabindex='-1'])",
    ];

    const elements: ElementInfo[] = [];
    const seen = new Set<Element>();

    // Get viewport dimensions
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    // Query all interactive elements
    const allElements = document.querySelectorAll(interactiveSelectors.join(", "));

    let index = 1;
    for (const el of allElements) {
        if (seen.has(el)) continue;
        seen.add(el);

        const rect = el.getBoundingClientRect();

        // Skip elements outside viewport or too small
        if (
            rect.width < 10 ||
            rect.height < 10 ||
            rect.bottom < 0 ||
            rect.top > viewportHeight ||
            rect.right < 0 ||
            rect.left > viewportWidth
        ) {
            continue;
        }

        // Skip invisible elements
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
            continue;
        }

        // Determine element type
        const tagName = el.tagName.toLowerCase();
        let type: ElementInfo["type"] = "other";
        if (tagName === "button" || el.getAttribute("role") === "button") {
            type = "button";
        } else if (tagName === "a") {
            type = "link";
        } else if (tagName === "input") {
            const inputType = (el as HTMLInputElement).type;
            if (inputType === "checkbox") type = "checkbox";
            else if (inputType === "radio") type = "radio";
            else type = "input";
        } else if (tagName === "select") {
            type = "select";
        } else if (tagName === "textarea") {
            type = "textarea";
        }

        // *** ADD UNIQUE DATA ATTRIBUTE TO ELEMENT ***
        el.setAttribute("data-procura-idx", String(index));

        // Get text content
        const text =
            el.getAttribute("aria-label") ||
            el.getAttribute("title") ||
            (el as HTMLInputElement).placeholder ||
            el.textContent?.trim().slice(0, 50) ||
            "";

        // Build element info - use data attribute as unique selector
        const info: ElementInfo = {
            index,
            type,
            tagName,
            text,
            bounds: {
                x: Math.round(rect.left),
                y: Math.round(rect.top),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
            },
            selector: `[data-procura-idx="${index}"]`, // UNIQUE selector via data attribute
        };

        // Add optional attributes
        const ariaLabel = el.getAttribute("aria-label");
        if (ariaLabel) info.ariaLabel = ariaLabel;

        const title = el.getAttribute("title");
        if (title) info.title = title;

        const placeholder = (el as HTMLInputElement).placeholder;
        if (placeholder) info.placeholder = placeholder;

        if (tagName === "input") {
            info.inputType = (el as HTMLInputElement).type;
            if (info.inputType === "checkbox" || info.inputType === "radio") {
                info.checked = (el as HTMLInputElement).checked;
            }
        }

        if (tagName === "select") {
            info.options = Array.from((el as HTMLSelectElement).options).map((o) => o.text);
        }

        elements.push(info);
        index++;
    }

    return elements;
}

/**
 * Content script to type text into an element
 */
function typeTextScript(selector: string, text: string): boolean {
    // Log executable JavaScript for debugging
    const escapedText = text.replace(/'/g, "\\'").replace(/\n/g, "\\n");
    console.log(`[Procura] ▶ Type Script - Copy this to debug:`);
    console.log(`document.querySelector('${selector}')`);
    console.log(`const el = document.querySelector('${selector}'); el.focus(); el.value = '${escapedText}'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));`);

    const el = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
    if (!el) {
        console.log("[Procura] ❌ Element not found for selector:", selector);
        return false;
    }

    console.log("[Procura] ✓ Found element:", el.tagName, el);

    el.focus();
    el.value = text;

    // Dispatch input event to trigger any listeners
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));

    console.log("[Procura] ✓ Text typed successfully");
    return true;
}

// ============================================================================
// Image Annotation (using Canvas)
// ============================================================================

async function annotateImage(
    imageDataUrl: string,
    elements: ElementInfo[]
): Promise<string> {
    // Create an image from the data URL
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = imageDataUrl;
    });

    // === COMPRESSION: Resize to max 800px width/height ===
    const MAX_SIZE = 800;
    let targetWidth = img.width;
    let targetHeight = img.height;
    let scale = 1;

    if (img.width > MAX_SIZE || img.height > MAX_SIZE) {
        if (img.width > img.height) {
            scale = MAX_SIZE / img.width;
        } else {
            scale = MAX_SIZE / img.height;
        }
        targetWidth = Math.round(img.width * scale);
        targetHeight = Math.round(img.height * scale);
    }

    // Create canvas with resized dimensions
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d")!;

    // Draw the original image (scaled down)
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    // Calculate scale factor for element bounds
    // Screenshots are taken at device pixel ratio, so we need to scale bounds
    const dpr = window.devicePixelRatio || 1;

    // Draw labels on each element
    for (const el of elements) {
        const x = el.bounds.x * dpr * scale;
        const y = el.bounds.y * dpr * scale;
        const width = el.bounds.width * dpr * scale;
        const height = el.bounds.height * dpr * scale;

        // Draw border around element
        ctx.strokeStyle = "#FF00FF";
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, width, height);

        // Draw label background
        const label = `[${el.index}]`;
        const fontSize = Math.max(10, Math.round(14 * scale));
        ctx.font = `bold ${fontSize}px Arial`;
        const textMetrics = ctx.measureText(label);
        const labelWidth = textMetrics.width + 6;
        const labelHeight = fontSize + 4;

        // Smart label positioning: if above would be cut off, draw inside the element
        let labelY = y - labelHeight;
        let textY = y - 4;

        if (labelY < 0) {
            // Draw inside the element at the top
            labelY = y + 2;
            textY = y + labelHeight - 2;
        }

        ctx.fillStyle = "#FF00FF";
        ctx.fillRect(x, labelY, labelWidth, labelHeight);

        // Draw label text
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(label, x + 3, textY);
    }

    // === COMPRESSION: Use JPEG at 60% quality instead of PNG ===
    return canvas.toDataURL("image/jpeg", 0.6);
}

// ============================================================================
// Tools
// ============================================================================

export const annotatePageTool: Tool = {
    name: "annotate_page",
    description:
        "Scans the current webpage for INTERACTIVE ELEMENTS ONLY (buttons, links, input fields) and returns their numbers for clicking/typing. Returns 'tabUrl' containing the current browser tab URL (use this to extract document IDs or other URL parameters). NOT suitable for understanding or summarizing page content - use the screenshot tool instead. Set include_image=true only when you need visual context for complex layouts.",
    enabledByDefault: true,
    supportedPlatforms: ['chrome'], // Uses chrome.scripting
    defaultConfig: {},

    schema: {
        name: "annotate_page",
        description:
            "Finds clickable elements and returns tabUrl (current browser URL). Required before click_element or type_text. Use tabUrl to extract document IDs from URLs.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                include_image: {
                    type: SchemaType.BOOLEAN,
                    description: "If true, captures and annotates a screenshot (SLOW - adds 5-15s). Only use when you need visual context for complex layouts. Default: false (fast, text-only)",
                },
                reason: {
                    type: SchemaType.STRING,
                    description: "Optional description of why the page is being analyzed",
                },
            },
            required: [],
        },
    },

    execute: async (args) => {
        try {
            const includeImage = (args.include_image as boolean) ?? false;
            // Get the current active tab
            const tab = await getActiveTab();

            // Execute content script to get interactive elements
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: getInteractiveElementsScript,
            });

            if (!results?.[0]?.result) {
                return {
                    success: false,
                    error: "Could not extract elements",
                };
            }

            const elements: ElementInfo[] = results[0].result;

            // Store for later use
            lastAnnotatedElements = elements;

            // Only capture and annotate screenshot if requested (slow operation)
            let annotatedImage: string | undefined;
            if (includeImage) {
                const screenshotDataUrl = await chrome.tabs.captureVisibleTab({
                    format: "png",
                });
                annotatedImage = await annotateImage(screenshotDataUrl, elements);
            }

            // Build legend text - IMPORTANT: Use index numbers exactly as shown
            const legend = elements
                .map((el) => {
                    // Make index very clear - this is the number to use with click_element/type_text
                    let desc = `Element #${el.index}: ${el.type.toUpperCase()}`;
                    if (el.text) {
                        desc += ` "${el.text}"`;
                    }
                    if (el.ariaLabel && el.ariaLabel !== el.text) {
                        desc += ` (aria: "${el.ariaLabel}")`;
                    }
                    if (el.placeholder) {
                        desc += ` (placeholder: "${el.placeholder}")`;
                    }
                    if (el.options) {
                        desc += ` → Optionen: ${JSON.stringify(el.options)}`;
                    }
                    if (el.checked !== undefined) {
                        desc += ` [${el.checked ? "✓" : "○"}]`;
                    }
                    return desc;
                })
                .join("\n");

            // Register image in FileStore if included
            const imageRef = includeImage && annotatedImage ? addFile(annotatedImage, `annotated_${Date.now()}.png`) : undefined;

            return {
                success: true,
                data: {
                    ...(imageRef ? { imageRef } : {}),
                    ...(includeImage ? { imageDataUrl: annotatedImage } : {}),
                    elementCount: elements.length,
                    legend,
                    elements,
                    tabTitle: tab.title,
                    tabUrl: tab.url,
                    imageIncluded: includeImage,
                },
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : "Annotation failed",
            };
        }
    },
};

export const clickElementTool: Tool = {
    name: "click_element",
    description:
        "Clicks on an element by its number from annotate_page. STRONGLY RECOMMENDED: Always call annotate_page before clicking, as the DOM may have changed due to navigation, user interaction, or dynamic content updates. Call annotate_page first to see current elements.",
    enabledByDefault: true,
    supportedPlatforms: ['chrome'], // Uses chrome.scripting
    defaultConfig: {},

    schema: {
        name: "click_element",
        description: "Clicks on a numbered element from the last annotate_page analysis",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                index: {
                    type: SchemaType.INTEGER,
                    description: "The element number from annotate_page (e.g. 1, 2, 3...)",
                },
            },
            required: ["index"],
        },
    },

    execute: async (args) => {
        try {
            const index = args.index as number;

            // Find the element
            const element = lastAnnotatedElements.find((el) => el.index === index);
            if (!element) {
                return {
                    success: false,
                    error: `Element ${index} not found. Please call annotate_page first.`,
                };
            }

            // Get the current active tab
            const tab = await getActiveTab();

            // Execute click via parameterized function — selector is passed as data,
            // not interpolated into code, preventing XSS via malicious selectors
            const clickResults = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                world: "MAIN",
                func: (selector: string) => {
                    const el = document.querySelector(selector);
                    if (el) {
                        (el as HTMLElement).click();
                        return { success: true, found: true, tagName: el.tagName };
                    }
                    return { success: false, found: false };
                },
                args: [element.selector],
            });

            const result = clickResults?.[0]?.result;
            if (!result?.success) {
                return {
                    success: false,
                    error: result?.found === false
                        ? `Element ${index} not found in DOM (Selector: ${element.selector})`
                        : `Could not click element ${index}`,
                };
            }

            return {
                success: true,
                data: {
                    clicked: true,
                    selector: element.selector,
                    element: {
                        index: element.index,
                        type: element.type,
                        text: element.text,
                    },
                },
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : "Click failed",
            };
        }
    },
};

export const typeTextTool: Tool = {
    name: "type_text",
    description:
        "Types text into an input field by its number from annotate_page. STRONGLY RECOMMENDED: Always call annotate_page before typing, as the DOM may have changed due to navigation, user interaction, or dynamic content updates. Call annotate_page first to see current elements.",
    enabledByDefault: true,
    supportedPlatforms: ['chrome'], // Uses chrome.scripting
    defaultConfig: {},

    schema: {
        name: "type_text",
        description: "Types text into an input field from the last annotate_page analysis",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                index: {
                    type: SchemaType.INTEGER,
                    description: "The input field number from annotate_page",
                },
                text: {
                    type: SchemaType.STRING,
                    description: "The text to type",
                },
            },
            required: ["index", "text"],
        },
    },

    execute: async (args) => {
        try {
            const index = args.index as number;
            const text = args.text as string;

            // Find the element
            const element = lastAnnotatedElements.find((el) => el.index === index);
            if (!element) {
                return {
                    success: false,
                    error: `Element ${index} not found. Please call annotate_page first.`,
                };
            }

            // Verify it's an input type
            if (!["input", "textarea", "select"].includes(element.type)) {
                return {
                    success: false,
                    error: `Element ${index} is not an input field (type: ${element.type})`,
                };
            }

            // Get the current active tab
            const tab = await getActiveTab();

            // Execute type
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: typeTextScript,
                args: [element.selector, text],
            });

            if (!results?.[0]?.result) {
                return {
                    success: false,
                    error: `Could not type text into element ${index}`,
                };
            }

            return {
                success: true,
                data: {
                    typed: true,
                    text,
                    element: {
                        index: element.index,
                        type: element.type,
                        placeholder: element.placeholder,
                    },
                },
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : "Text input failed",
            };
        }
    },
};

// ============================================================================
// Navigate To Tool
// ============================================================================

export const navigateToTool: Tool = {
    name: "navigate_to",
    description:
        "Navigates to any URL in a new tab. Use this to open websites.",
    enabledByDefault: true,
    supportedPlatforms: ['chrome'], // Uses chrome.tabs.create
    defaultConfig: {},

    schema: {
        name: "navigate_to",
        description: "Opens a URL in a new tab",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                url: {
                    type: SchemaType.STRING,
                    description: "The full URL (e.g. 'https://google.com')",
                },
            },
            required: ["url"],
        },
    },

    execute: async (args) => {
        try {
            let url = args.url as string;

            // Block dangerous protocols before adding prefix
            // eslint-disable-next-line sonarjs/code-eval -- blocklist, not eval
            const dangerousProtocols = ["javascript:", "data:", "file:", "blob:", "vbscript:"];
            if (dangerousProtocols.some(p => url.toLowerCase().startsWith(p))) {
                return {
                    success: false,
                    error: `Only HTTP and HTTPS URLs are allowed, got: ${url.split(":")[0]}:`,
                };
            }

            // Ensure URL has protocol (for bare hostnames like "google.com")
            if (!url.startsWith("http://") && !url.startsWith("https://")) {
                url = "https://" + url;
            }

            // Validate URL
            try {
                new URL(url);
            } catch {
                return {
                    success: false,
                    error: `Invalid URL: ${url}`,
                };
            }

            // Create new tab with the URL
            console.log(`[Procura] Opening in new tab: ${url}`);
            const newTab = await chrome.tabs.create({ url });

            return {
                success: true,
                data: {
                    navigatedTo: url,
                    tabId: newTab.id,
                    openedInNewTab: true,
                },
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : "Navigation failed",
            };
        }
    },
};
