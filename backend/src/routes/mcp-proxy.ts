/**
 * MCP Proxy Route
 * POST /mcp-proxy - Forward MCP requests to bypass CORS
 */

import { Hono } from "hono";
import { mcpProxyBodySchema } from "../validators/schemas";
import { getConfig } from "../config";

export const mcpProxyRoutes = new Hono();

/**
 * POST /mcp-proxy - Forward MCP requests
 */
mcpProxyRoutes.post("/", async (c) => {
    const config = getConfig();

    try {
        const body = await c.req.json();
        const parseResult = mcpProxyBodySchema.safeParse(body);

        if (!parseResult.success) {
            return c.json(
                { error: parseResult.error.errors[0]?.message || "Missing targetUrl or body" },
                400
            );
        }

        const { targetUrl, body: requestBody, headers: customHeaders = {} } = parseResult.data;

        // Validate URL is HTTPS (allow localhost for local dev)
        const parsedUrl = new URL(targetUrl);
        const isLocalhost = parsedUrl.hostname === "localhost" || parsedUrl.hostname === "127.0.0.1";
        if (!targetUrl.startsWith("https://") && !isLocalhost) {
            return c.json({ error: "Only HTTPS URLs are allowed" }, 400);
        }

        // Check allowed domains if configured
        if (config.mcpProxyAllowedDomains.length > 0) {
            const url = new URL(targetUrl);
            const isAllowed = config.mcpProxyAllowedDomains.some(
                domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`)
            );

            if (!isAllowed) {
                return c.json({ error: "Target domain not allowed" }, 403);
            }
        }

        // Build headers for outgoing request
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": "2024-11-05",
        };

        // Add custom headers (allowlist only — block smuggling of Cookie, X-Forwarded-For, etc.)
        const allowedHeaders = ["authorization", "mcp-session-id"];
        for (const [name, value] of Object.entries(customHeaders)) {
            if (allowedHeaders.includes(name.toLowerCase())) {
                headers[name] = value;
            }
        }

        // Forward X-API-Key from the original proxy request to the target
        // (the proxy already validated auth, so internal MCP endpoints can re-validate)
        const incomingApiKey = c.req.header("X-API-Key");
        if (incomingApiKey) {
            headers["X-API-Key"] = incomingApiKey;
        }

        // Forward request to MCP server
        const response = await fetch(targetUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(requestBody),
        });

        // Forward relevant headers back to client
        const mcpSessionId = response.headers.get("mcp-session-id");
        if (mcpSessionId) {
            c.header("Mcp-Session-Id", mcpSessionId);
        }

        // Forward WWW-Authenticate for 401s (OAuth discovery)
        const wwwAuth = response.headers.get("www-authenticate");
        if (wwwAuth) {
            c.header("WWW-Authenticate", wwwAuth);
        }

        const contentType = response.headers.get("content-type");
        if (contentType) {
            c.header("Content-Type", contentType);
        }

        // Return response
        c.status(response.status as 200);
        return c.body(await response.text());

    } catch (error) {
        console.error("MCP proxy error:", error);
        const message = error instanceof Error ? error.message : "Unknown error";
        return c.json({ error: `Failed to connect to MCP server: ${message}` }, 502);
    }
});
