import { Tool, SchemaType } from "./types";

/**
 * Check if a hostname resolves to a private or reserved network address.
 * Blocks SSRF attacks targeting localhost, internal networks, and cloud metadata endpoints.
 */
function isPrivateHost(hostname: string): boolean {
    const lower = hostname.toLowerCase();

    // Localhost variants
    if (lower === "localhost" || lower === "[::1]") return true;

    // Strip IPv6 brackets if present
    const bare = lower.startsWith("[") ? lower.slice(1, -1) : lower;

    // IPv6 loopback
    if (bare === "::1" || bare === "0:0:0:0:0:0:0:1") return true;

    // IPv4 private/reserved ranges
    const parts = bare.split(".").map(Number);
    if (parts.length === 4 && parts.every(p => !isNaN(p) && p >= 0 && p <= 255)) {
        const [a, b] = parts;
        if (a === 127) return true;                         // 127.0.0.0/8 loopback
        if (a === 10) return true;                          // 10.0.0.0/8 private
        if (a === 172 && b >= 16 && b <= 31) return true;   // 172.16.0.0/12 private
        if (a === 192 && b === 168) return true;            // 192.168.0.0/16 private
        if (a === 169 && b === 254) return true;            // 169.254.0.0/16 link-local / cloud metadata
        if (a === 0) return true;                           // 0.0.0.0/8 reserved
    }

    return false;
}


export const httpRequestTool: Tool = {
    name: "http_request",
    description: "Makes HTTP requests and returns the response. Supports GET, POST, PUT, DELETE.",
    enabledByDefault: true,

    defaultConfig: {
        timeout: 10000, // 10 seconds
        maxResponseSize: 100000, // 100KB
    },

    schema: {
        name: "http_request",
        description: "Makes an HTTP request to a URL and returns the response",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                url: {
                    type: SchemaType.STRING,
                    description: "The URL for the request, e.g. 'https://api.example.com/data'",
                },
                method: {
                    type: SchemaType.STRING,
                    description: "The HTTP method: GET, POST, PUT, DELETE (default: GET)",
                },
                headers: {
                    type: SchemaType.OBJECT,
                    description: "Optional HTTP headers as key-value pairs",
                    properties: {}, // Dynamic key-value pairs
                },
                body: {
                    type: SchemaType.STRING,
                    description: "Optional request body (for POST/PUT)",
                },
            },
            required: ["url"],
        },
    },

    execute: async (args, config) => {
        try {
            const url = args.url as string;
            const method = (args.method as string) || "GET";
            const headers = (args.headers as Record<string, string>) || {};
            const body = args.body as string | undefined;
            const timeout = (config.timeout as number) ?? 10000;
            const maxResponseSize = (config.maxResponseSize as number) ?? 100000;

            // Validate URL
            let parsedUrl: URL;
            try {
                parsedUrl = new URL(url);
            } catch {
                return {
                    success: false,
                    error: "Invalid URL",
                };
            }

            // Only allow http/https
            if (!["http:", "https:"].includes(parsedUrl.protocol)) {
                return {
                    success: false,
                    error: "Only HTTP and HTTPS URLs allowed",
                };
            }

            // Block private/reserved IP ranges (SSRF protection)
            const hostname = parsedUrl.hostname;
            if (isPrivateHost(hostname)) {
                return {
                    success: false,
                    error: "Requests to private or reserved network addresses are not allowed",
                };
            }

            // Create abort controller for timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            try {
                const response = await fetch(url, {
                    method,
                    headers,
                    body: ["POST", "PUT"].includes(method) ? body : undefined,
                    signal: controller.signal,
                });

                clearTimeout(timeoutId);

                // Get response text (limited by maxResponseSize)
                const text = await response.text();
                const truncated = text.length > maxResponseSize;
                const responseBody = truncated
                    ? text.slice(0, maxResponseSize) + "... [truncated]"
                    : text;

                // Check for HTTP error status codes (4xx, 5xx)
                if (!response.ok) {
                    // Include response body in error for LLM debugging (truncated to 500 chars)
                    const errorBody = responseBody.slice(0, 500);
                    const errorMessage = responseBody.trim()
                        ? `HTTP ${response.status} ${response.statusText}\n\nResponse:\n${errorBody}`
                        : `HTTP ${response.status} ${response.statusText}`;

                    return {
                        success: false,
                        error: errorMessage,
                        data: {
                            status: response.status,
                            statusText: response.statusText,
                            body: responseBody,
                        },
                    };
                }

                return {
                    success: true,
                    data: {
                        status: response.status,
                        statusText: response.statusText,
                        headers: Object.fromEntries(response.headers.entries()),
                        body: responseBody,
                        truncated,
                    },
                };
            } catch (error) {
                clearTimeout(timeoutId);
                if (error instanceof Error && error.name === "AbortError") {
                    return {
                        success: false,
                        error: `Timeout after ${timeout}ms`,
                    };
                }
                throw error;
            }
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : "HTTP request failed",
            };
        }
    },
};
