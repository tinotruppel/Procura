/**
 * CV Database MCP Server
 * Implements the Model Context Protocol for CV/resume search and retrieval
 *
 * Endpoint: /mcp/cv-database
 * Transport: Streamable HTTP via @hono/mcp
 */

import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { z } from "zod";

// =============================================================================
// Types
// =============================================================================

interface FlowcaseAuth {
    subdomain: string;
    apiKey: string;
}

interface FlowcaseSearchResponse {
    cvs?: Array<{
        user_id: string;
        cv_id: string;
        name: string;
        email?: string;
        title?: string;
        office_name?: string;
    }>;
    total?: number;
}

// =============================================================================
// Flowcase API Helpers
// =============================================================================

function getHeaders(apiKey: string): Record<string, string> {
    return {
        "Authorization": `Token token="${apiKey}"`,
        "Content-Type": "application/json",
    };
}

async function searchByName(
    subdomain: string,
    apiKey: string,
    query: string,
    offset: number,
    size: number
): Promise<FlowcaseSearchResponse> {
    const response = await fetch(`https://${subdomain}.flowcase.com/api/v4/search`, {
        method: "POST",
        headers: getHeaders(apiKey),
        body: JSON.stringify({
            office_ids: [],
            offset,
            size,
            must: [{
                bool: {
                    should: [{
                        query: { field: "name", value: query }
                    }]
                }
            }],
            should: [],
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Name search failed: ${response.status} ${error}`);
    }

    return response.json() as Promise<FlowcaseSearchResponse>;
}

async function searchContent(
    subdomain: string,
    apiKey: string,
    query: string,
    offset: number,
    size: number
): Promise<FlowcaseSearchResponse> {
    const response = await fetch(`https://${subdomain}.flowcase.com/api/v4/search`, {
        method: "POST",
        headers: getHeaders(apiKey),
        body: JSON.stringify({
            office_ids: [],
            offset,
            size,
            must: [{
                bool: {
                    must: [{
                        query: { value: query }
                    }]
                }
            }],
            should: [],
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Content search failed: ${response.status} ${error}`);
    }

    return response.json() as Promise<FlowcaseSearchResponse>;
}

async function getCv(
    subdomain: string,
    apiKey: string,
    userId: string,
    cvId: string
): Promise<Record<string, unknown>> {
    const response = await fetch(`https://${subdomain}.flowcase.com/api/v3/cvs/${userId}/${cvId}`, {
        method: "GET",
        headers: getHeaders(apiKey),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to get CV: ${response.status} ${error}`);
    }

    return response.json() as Promise<Record<string, unknown>>;
}

// =============================================================================
// MCP Server Setup
// =============================================================================

function getDefaultAuth(): FlowcaseAuth | null {
    const subdomain = process.env.FLOWCASE_SUBDOMAIN;
    const apiKey = process.env.FLOWCASE_API_KEY;

    if (!subdomain || !apiKey) {
        return null;
    }

    return { subdomain, apiKey };
}

// Create MCP server instance
const mcpServer = new McpServer({
    name: "cv-database",
    version: "1.0.0",
});

const auth = getDefaultAuth();

if (auth) {
    // --- search_by_name ---
    mcpServer.registerTool(
        "search_by_name",
        {
            description: "Search for people by name in the CV database",
            inputSchema: {
                query: z.string().describe("Name to search for (e.g. 'John Doe')"),
                offset: z.number().optional().describe("Pagination offset (default: 0)"),
                size: z.number().optional().describe("Number of results (default: 30, max: 500)"),
            },
        },
        async ({ query, offset = 0, size = 30 }) => {
            const limitedSize = Math.min(size, 500);
            const results = await searchByName(auth.subdomain, auth.apiKey, query, offset, limitedSize);

            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        results: results.cvs || [],
                        total: results.total || results.cvs?.length || 0,
                        offset,
                        size: limitedSize,
                        query,
                        searchType: "name",
                        message: `Found ${results.total || results.cvs?.length || 0} person(s) matching name "${query}"`,
                        hint: "Use user_id and cv_id from results to call get_cv"
                    }, null, 2)
                }]
            };
        }
    );

    // --- search_content ---
    mcpServer.registerTool(
        "search_content",
        {
            description: "Search CV content for skills, technologies, or experience keywords",
            inputSchema: {
                query: z.string().describe("Skills, technologies, or keywords to search for"),
                offset: z.number().optional().describe("Pagination offset (default: 0)"),
                size: z.number().optional().describe("Number of results (default: 30, max: 500)"),
            },
        },
        async ({ query, offset = 0, size = 30 }) => {
            const limitedSize = Math.min(size, 500);
            const results = await searchContent(auth.subdomain, auth.apiKey, query, offset, limitedSize);

            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        results: results.cvs || [],
                        total: results.total || results.cvs?.length || 0,
                        offset,
                        size: limitedSize,
                        query,
                        searchType: "content",
                        message: `Found ${results.total || results.cvs?.length || 0} CV(s) with content matching "${query}"`,
                        hint: "Use user_id and cv_id from results to call get_cv"
                    }, null, 2)
                }]
            };
        }
    );

    // --- get_cv ---
    mcpServer.registerTool(
        "get_cv",
        {
            description: "Get full CV details for a person",
            inputSchema: {
                user_id: z.string().describe("User ID from search results"),
                cv_id: z.string().describe("CV ID from search results"),
            },
        },
        async ({ user_id, cv_id }) => {
            const cv = await getCv(auth.subdomain, auth.apiKey, user_id, cv_id);

            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        cv,
                        userId: user_id,
                        cvId: cv_id,
                        name: (cv.name as string) || (cv.user as { name?: string })?.name,
                        message: `Retrieved CV for ${(cv.name as string) || (cv.user as { name?: string })?.name || user_id}`
                    }, null, 2)
                }]
            };
        }
    );
}

// =============================================================================
// HTTP Routes with Hono MCP Transport
// =============================================================================

export const cvDatabaseMcpRoutes = new Hono();

const transport = new StreamableHTTPTransport();

/**
 * MCP endpoint - handles all MCP communication
 */
cvDatabaseMcpRoutes.all("/", async (c) => {
    if (!auth) {
        return c.json({
            error: "CV Database MCP server not configured. Set FLOWCASE_SUBDOMAIN and FLOWCASE_API_KEY environment variables."
        }, 503);
    }

    if (!mcpServer.isConnected()) {
        await mcpServer.connect(transport);
    }

    return transport.handleRequest(c);
});

/**
 * Health/info endpoint
 */
cvDatabaseMcpRoutes.get("/info", async (c) => {
    return c.json({
        name: "cv-database",
        version: "1.0.0",
        description: "CV/resume search and retrieval",
        status: auth ? "ready" : "not_configured",
        configured: !!auth,
        tools: auth ? ["search_by_name", "search_content", "get_cv"] : [],
        note: auth ? undefined : "Set FLOWCASE_SUBDOMAIN and FLOWCASE_API_KEY environment variables"
    });
});
