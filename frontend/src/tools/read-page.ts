/**
 * Read Page Tool
 * Extracts semantic text content from web pages for LLM understanding.
 * Uses prioritized content selectors to find main content area.
 */
import { Tool, SchemaType, getActiveTab } from "./types";

// ============================================================================
// Content Script - Runs in page context
// ============================================================================

interface ExtractionResult {
    content: string;
    source: string;
    title: string;
    url: string;
    truncated: boolean;
    charCount: number;
}

/**
 * Content script function to extract semantic text from the page.
 * Injected and executed in the page context.
 */
function extractSemanticContentScript(maxLength: number, includeLinks: boolean): ExtractionResult {
    // Prioritized selectors - first match wins
    const mainContentSelectors = [
        // App-specific (highest priority)
        '[aria-label="Email message"]',           // Outlook Email
        '[aria-label="Message body"]',            // Outlook alt
        '[aria-label="Reading Pane"]',            // Outlook reading pane
        '[role="document"]',                      // Common for email/doc content

        // Google apps
        '.doc-content',                           // Google Docs
        '.gmail_default',                         // Gmail
        '[data-message-id]',                      // Gmail message

        // Semantic HTML5
        'main',
        'article',
        '[role="main"]',
        '[role="article"]',

        // Common patterns
        '#content',
        '#main-content',
        '#main',
        '.content',
        '.main-content',
        '.main',
        '.post-content',
        '.article-content',
        '.article-body',
        '.entry-content',
        '.page-content',

        // Reading panes (email clients)
        '.ReadingPane',
        '.reading-pane',

        // CMS patterns
        '.prose',                                 // Tailwind typography
        '.markdown-body',                         // GitHub
        '.rich-text',

        // Fallbacks
        '#app',
        '.app',
        'body'  // Ultimate fallback
    ];

    // Selectors where we want the LAST match (e.g., Gmail conversations show newest at bottom)
    const takeLastSelectors = new Set(['[data-message-id]']);

    // Find first matching container
    let container: Element | null = null;
    let matchedSelector = 'body';

    for (const selector of mainContentSelectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length === 0) continue;

        // For Gmail messages, take the LAST one (opened/newest email in conversation)
        const el = takeLastSelectors.has(selector)
            ? elements[elements.length - 1]
            : elements[0];

        if (el && el.textContent && el.textContent.trim().length > 50) {
            container = el;
            matchedSelector = selector + (takeLastSelectors.has(selector) ? ' (last)' : '');
            break;
        }
    }

    if (!container) {
        container = document.body;
    }

    // Elements to skip entirely
    const skipTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH', 'IFRAME', 'NAV', 'HEADER', 'FOOTER', 'ASIDE']);
    const skipRoles = new Set(['navigation', 'banner', 'contentinfo', 'complementary']);

    // Walk the DOM tree and extract text with structure
    const parts: string[] = [];
    let currentLength = 0;
    let truncated = false;

    function shouldSkip(el: Element): boolean {
        if (skipTags.has(el.tagName)) return true;
        const role = el.getAttribute('role');
        if (role && skipRoles.has(role)) return true;
        // Skip hidden elements
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return true;
        return false;
    }

    function processNode(node: Node): void {
        if (truncated) return;

        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent?.trim();
            if (text && text.length > 1) {
                if (currentLength + text.length > maxLength) {
                    // Add partial text up to limit
                    const remaining = maxLength - currentLength;
                    if (remaining > 20) {
                        parts.push(text.slice(0, remaining) + '...');
                    }
                    truncated = true;
                    return;
                }
                parts.push(text);
                currentLength += text.length;
            }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as Element;

            if (shouldSkip(el)) return;

            const tag = el.tagName;

            // Add structural markers before content
            if (tag === 'H1') parts.push('\n\n# ');
            else if (tag === 'H2') parts.push('\n\n## ');
            else if (tag === 'H3') parts.push('\n\n### ');
            else if (tag === 'H4' || tag === 'H5' || tag === 'H6') parts.push('\n\n#### ');
            else if (tag === 'P') parts.push('\n\n');
            else if (tag === 'BR') parts.push('\n');
            else if (tag === 'LI') parts.push('\n• ');
            else if (tag === 'HR') parts.push('\n---\n');
            else if (tag === 'DIV' || tag === 'SECTION') {
                // Only add newline if there's content before
                if (parts.length > 0 && !parts[parts.length - 1].endsWith('\n')) {
                    parts.push('\n');
                }
            }

            // Process children
            for (const child of el.childNodes) {
                processNode(child);
                if (truncated) return;
            }

            // Add link URL after link text if requested
            if (includeLinks && tag === 'A') {
                const href = el.getAttribute('href');
                // eslint-disable-next-line sonarjs/code-eval -- just checking href value, not executing
                if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
                    parts.push(` [${href}]`);
                    currentLength += href.length + 3;
                }
            }
        }
    }

    processNode(container);

    // Clean up the result
    const content = parts.join('')
        .replace(/\n{3,}/g, '\n\n')  // Max 2 consecutive newlines
        .replace(/[ \t]+/g, ' ')      // Normalize spaces
        .trim();

    return {
        content,
        source: matchedSelector,
        title: document.title || '',
        url: window.location.href,
        truncated,
        charCount: content.length
    };
}

// ============================================================================
// Tool Definition
// ============================================================================

export const readPageTool: Tool = {
    name: "read_page",
    description: "Reads and extracts the main text content from the current webpage. Returns structured text optimized for understanding page content, emails, articles, etc. Much faster than screenshots and works well with context windows. Use this to understand what content is displayed on a page.",
    enabledByDefault: true,
    supportedPlatforms: ['chrome'],
    defaultConfig: {},

    schema: {
        name: "read_page",
        description: "Extracts readable text content from the current webpage for analysis",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                max_length: {
                    type: SchemaType.INTEGER,
                    description: "Maximum characters to extract (default: 15000). Use smaller values for quick summaries.",
                },
                include_links: {
                    type: SchemaType.BOOLEAN,
                    description: "Include link URLs inline after link text (default: false)",
                },
            },
            required: [],
        },
    },

    execute: async (args) => {
        try {
            const maxLength = (args.max_length as number) || 15000;
            const includeLinks = (args.include_links as boolean) || false;

            // Get the current active tab
            const tab = await getActiveTab();

            // Execute content script to extract text
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: extractSemanticContentScript,
                args: [maxLength, includeLinks],
            });

            if (!results?.[0]?.result) {
                return {
                    success: false,
                    error: "Could not extract page content",
                };
            }

            const result = results[0].result as ExtractionResult;

            if (!result.content || result.content.length < 10) {
                return {
                    success: false,
                    error: "Page appears to be empty or content could not be extracted",
                };
            }

            return {
                success: true,
                data: {
                    content: result.content,
                    source: result.source,
                    title: result.title,
                    url: result.url,
                    charCount: result.charCount,
                    truncated: result.truncated,
                },
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Read failed";

            if (errorMessage.includes("Cannot access") ||
                errorMessage.includes("chrome://") ||
                errorMessage.includes("Receiving end does not exist")) {
                return {
                    success: false,
                    error: "Cannot read this page (restricted page or extension not active)",
                };
            }

            return {
                success: false,
                error: errorMessage,
            };
        }
    },
};
