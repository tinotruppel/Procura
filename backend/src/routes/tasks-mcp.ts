/**
 * Tasks MCP Server
 * Implements the Model Context Protocol for task and ticket management
 * 
 * Endpoint: /mcp/tasks
 * Transport: Streamable HTTP via @hono/mcp
 */

import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { z } from "zod";

const TRELLO_API_BASE = "https://api.trello.com/1";

// =============================================================================
// Types
// =============================================================================

interface TrelloAuth {
    apiKey: string;
    apiToken: string;
    authParams: string;
}

interface TrelloCard {
    id: string;
    name: string;
    desc: string;
    idList: string;
    idBoard?: string;
    url: string;
    labels: { id: string; name: string; color: string }[];
    due: string | null;
    dueComplete: boolean;
    closed: boolean;
}

interface TrelloList {
    id: string;
    name: string;
}

interface TrelloLabel {
    id: string;
    name: string;
    color: string;
}

interface TrelloAttachment {
    id: string;
    name: string;
    url: string;
    mimeType: string;
    bytes: number;
    date: string;
    isUpload: boolean;
    previews?: { url: string; width: number; height: number }[];
}

interface TrelloBoard {
    id: string;
    name: string;
    url: string;
    closed: boolean;
}

interface TrelloComment {
    id: string;
    data?: { text?: string };
    date: string;
    memberCreator?: { fullName?: string; username?: string };
}

// =============================================================================
// Trello API Helpers
// =============================================================================

async function trelloRequest<T>(url: string, options?: RequestInit): Promise<T> {
    const response = await fetch(url, options);
    if (!response.ok) {
        throw new Error(`Trello API error: ${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<T>;
}

// =============================================================================
// MCP Server Setup
// =============================================================================

// Default auth from environment (can be overridden per-session)
function getDefaultAuth(): TrelloAuth | null {
    const apiKey = process.env.TRELLO_API_KEY;
    const apiToken = process.env.TRELLO_TOKEN;

    if (!apiKey || !apiToken) {
        return null;
    }

    return {
        apiKey,
        apiToken,
        authParams: `key=${apiKey}&token=${apiToken}`
    };
}

// Create MCP server instance
const mcpServer = new McpServer({
    name: "tasks",
    version: "1.0.0",
});

// We'll use default auth - per-request auth would require more complex session handling
const auth = getDefaultAuth();

if (auth) {
    // --- list_projects ---
    mcpServer.registerTool(
        "list_projects",
        {
            description: "List available projects",
        },
        async () => {
            const boards = await trelloRequest<TrelloBoard[]>(
                `${TRELLO_API_BASE}/members/me/boards?${auth.authParams}`
            );
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        projects: boards.map(b => ({
                            id: b.id,
                            name: b.name,
                            url: b.url,
                            closed: b.closed
                        })),
                        hint: "Use the 'id' field as projectId in other calls"
                    }, null, 2)
                }]
            };
        }
    );

    // --- list_statuses ---
    mcpServer.registerTool(
        "list_statuses",
        {
            description: "Get all status columns in a project",
            inputSchema: {
                projectId: z.string().describe("ID of the project (from list_projects)")
            },
        },
        async ({ projectId }) => {
            if (!projectId) {
                throw new Error("Missing projectId. Use list_projects to find available projects.");
            }
            const lists = await trelloRequest<TrelloList[]>(
                `${TRELLO_API_BASE}/boards/${projectId}/lists?${auth.authParams}`
            );
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        lists: lists.map(l => ({ id: l.id, name: l.name })),
                        hint: "Use the 'id' field as statusId when creating tickets"
                    }, null, 2)
                }]
            };
        }
    );

    // --- list_labels ---
    mcpServer.registerTool(
        "list_labels",
        {
            description: "Get all labels in a project",
            inputSchema: {
                projectId: z.string().describe("ID of the project (from list_projects)")
            },
        },
        async ({ projectId }) => {
            const labels = await trelloRequest<TrelloLabel[]>(
                `${TRELLO_API_BASE}/boards/${projectId}/labels?${auth.authParams}`
            );
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        labels: labels.map(l => ({
                            id: l.id,
                            name: l.name || `(${l.color})`,
                            color: l.color
                        })),
                        hint: "Use comma-separated 'id' values as labelIds"
                    }, null, 2)
                }]
            };
        }
    );

    // --- list_tickets ---
    mcpServer.registerTool(
        "list_tickets",
        {
            description: "Get all tickets in a project with their statuses",
            inputSchema: {
                projectId: z.string().describe("ID of the project (from list_projects)")
            },
        },
        async ({ projectId }) => {
            const [lists, cards] = await Promise.all([
                trelloRequest<TrelloList[]>(`${TRELLO_API_BASE}/boards/${projectId}/lists?${auth.authParams}`),
                trelloRequest<TrelloCard[]>(`${TRELLO_API_BASE}/boards/${projectId}/cards?${auth.authParams}`)
            ]);
            const listNames = Object.fromEntries(lists.map(l => [l.id, l.name]));
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        statuses: lists.map(l => ({ id: l.id, name: l.name })),
                        tickets: cards.map(c => ({
                            id: c.id,
                            name: c.name,
                            status: listNames[c.idList] || c.idList,
                            statusId: c.idList,
                            labels: c.labels.map(l => l.name).join(", "),
                            due: c.due,
                            dueComplete: c.dueComplete
                        }))
                    }, null, 2)
                }]
            };
        }
    );

    // --- create_ticket ---
    mcpServer.registerTool(
        "create_ticket",
        {
            description: "Create a new ticket in a project",
            inputSchema: {
                projectId: z.string().describe("ID of the project (from list_projects)"),
                statusId: z.string().describe("ID of the status column to create the ticket in (must belong to the project)"),
                name: z.string().describe("Title of the ticket"),
                description: z.string().optional().describe("Description of the ticket"),
                due: z.string().optional().describe("Due date in ISO 8601 format"),
                labelIds: z.string().optional().describe("Comma-separated label IDs")
            },
        },
        async ({ projectId, statusId, name, description, due, labelIds }) => {
            const cardData: Record<string, string> = { idList: statusId, name, desc: description || "" };
            cardData.idBoard = projectId;
            if (due) cardData.due = due;
            if (labelIds) cardData.idLabels = labelIds;

            const card = await trelloRequest<TrelloCard>(
                `${TRELLO_API_BASE}/cards?${auth.authParams}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(cardData)
                }
            );
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        id: card.id,
                        name: card.name,
                        url: card.url,
                        message: "Ticket created successfully"
                    }, null, 2)
                }]
            };
        }
    );

    // --- get_ticket ---
    mcpServer.registerTool(
        "get_ticket",
        {
            description: "Get details of a specific ticket",
            inputSchema: {
                ticketId: z.string().describe("ID of the ticket to retrieve"),
                projectId: z.string().describe("ID of the project (from list_projects)")
            },
        },
        async ({ ticketId, projectId }) => {
            const [card, lists] = await Promise.all([
                trelloRequest<TrelloCard>(`${TRELLO_API_BASE}/cards/${ticketId}?${auth.authParams}`),
                trelloRequest<TrelloList[]>(`${TRELLO_API_BASE}/boards/${projectId}/lists?${auth.authParams}`)
            ]);
            const list = lists.find(l => l.id === card.idList);
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        id: card.id,
                        name: card.name,
                        description: card.desc,
                        status: list?.name || card.idList,
                        statusId: card.idList,
                        url: card.url,
                        labels: card.labels.map(l => ({ name: l.name, color: l.color })),
                        due: card.due,
                        dueComplete: card.dueComplete,
                        closed: card.closed
                    }, null, 2)
                }]
            };
        }
    );

    // --- update_ticket ---
    mcpServer.registerTool(
        "update_ticket",
        {
            description: "Update an existing ticket",
            inputSchema: {
                ticketId: z.string().describe("ID of the ticket to update"),
                name: z.string().optional().describe("New title"),
                description: z.string().optional().describe("New description"),
                statusId: z.string().optional().describe("Move to this status column"),
                due: z.string().optional().describe("Due date or 'null' to remove"),
                dueComplete: z.boolean().optional().describe("Mark as complete"),
                labelIds: z.string().optional().describe("Comma-separated label IDs")
            },
        },
        async ({ ticketId, name, description, statusId, due, dueComplete, labelIds }) => {
            const updates: Record<string, string | boolean | null> = {};
            if (name) updates.name = name;
            if (description) updates.desc = description;
            if (statusId) updates.idList = statusId;
            if (due !== undefined) updates.due = due === "null" ? null : due;
            if (dueComplete !== undefined) updates.dueComplete = dueComplete;
            if (labelIds !== undefined) updates.idLabels = labelIds;

            const card = await trelloRequest<TrelloCard>(
                `${TRELLO_API_BASE}/cards/${ticketId}?${auth.authParams}`,
                {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(updates)
                }
            );
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        id: card.id,
                        name: card.name,
                        url: card.url,
                        message: "Ticket updated successfully"
                    }, null, 2)
                }]
            };
        }
    );

    // --- archive_ticket ---
    mcpServer.registerTool(
        "archive_ticket",
        {
            description: "Archive (close) a ticket",
            inputSchema: {
                ticketId: z.string().describe("ID of the ticket to archive")
            },
        },
        async ({ ticketId }) => {
            const card = await trelloRequest<TrelloCard>(
                `${TRELLO_API_BASE}/cards/${ticketId}?${auth.authParams}`,
                {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ closed: true })
                }
            );
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        id: card.id,
                        name: card.name,
                        message: "Ticket archived successfully"
                    }, null, 2)
                }]
            };
        }
    );

    // --- list_comments ---
    mcpServer.registerTool(
        "list_comments",
        {
            description: "Get comments on a ticket",
            inputSchema: {
                ticketId: z.string().describe("ID of the ticket")
            },
        },
        async ({ ticketId }) => {
            const comments = await trelloRequest<TrelloComment[]>(
                `${TRELLO_API_BASE}/cards/${ticketId}/actions?filter=commentCard&${auth.authParams}`
            );
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        comments: comments.map(c => ({
                            id: c.id,
                            text: c.data?.text || "",
                            date: c.date,
                            author: c.memberCreator?.fullName || c.memberCreator?.username || "Unknown"
                        })),
                        count: comments.length
                    }, null, 2)
                }]
            };
        }
    );

    // --- add_comment ---
    mcpServer.registerTool(
        "add_comment",
        {
            description: "Add a comment to a ticket",
            inputSchema: {
                ticketId: z.string().describe("ID of the ticket"),
                comment: z.string().describe("Comment text")
            },
        },
        async ({ ticketId, comment }) => {
            const newComment = await trelloRequest<TrelloComment>(
                `${TRELLO_API_BASE}/cards/${ticketId}/actions/comments?${auth.authParams}&text=${encodeURIComponent(comment)}`,
                { method: "POST" }
            );
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        id: newComment.id,
                        text: newComment.data?.text || comment,
                        message: "Comment added successfully"
                    }, null, 2)
                }]
            };
        }
    );

    // --- list_attachments ---
    mcpServer.registerTool(
        "list_attachments",
        {
            description: "Get attachments on a ticket",
            inputSchema: {
                ticketId: z.string().describe("ID of the ticket")
            },
        },
        async ({ ticketId }) => {
            const attachments = await trelloRequest<TrelloAttachment[]>(
                `${TRELLO_API_BASE}/cards/${ticketId}/attachments?${auth.authParams}`
            );
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        attachments: attachments.map(a => ({
                            id: a.id,
                            name: a.name,
                            url: a.url,
                            mimeType: a.mimeType,
                            bytes: a.bytes,
                            date: a.date
                        })),
                        count: attachments.length
                    }, null, 2)
                }]
            };
        }
    );

    // --- add_attachment (URL or file data) ---
    mcpServer.registerTool(
        "add_attachment",
        {
            description: "Add an attachment to a ticket. Provide either a URL or file data (base64-encoded).",
            inputSchema: {
                ticketId: z.string().describe("ID of the ticket"),
                // Option 1: URL attachment
                url: z.string().optional().describe("URL of the attachment (use this OR fileData)"),
                // Option 2: File data attachment (resolved from fileRef by MCP client)
                fileData: z.string().optional().describe("Base64-encoded file content"),
                fileName: z.string().optional().describe("Filename for uploaded file"),
                mimeType: z.string().optional().describe("MIME type of file"),
                // Shared
                name: z.string().optional().describe("Display name for the attachment")
            },
        },
        async ({ ticketId, url, fileData, fileName, mimeType, name }) => {
            let attachment: TrelloAttachment;

            if (fileData) {
                // Upload file via multipart/form-data
                const buffer = Buffer.from(fileData, "base64");
                const blob = new Blob([buffer], { type: mimeType || "application/octet-stream" });

                const formData = new FormData();
                formData.append("file", blob, fileName || name || "attachment");
                if (name) formData.append("name", name);

                const response = await fetch(
                    `${TRELLO_API_BASE}/cards/${ticketId}/attachments?${auth.authParams}`,
                    { method: "POST", body: formData }
                );

                if (!response.ok) {
                    throw new Error(`Trello API error: ${response.status} ${response.statusText}`);
                }
                attachment = await response.json() as TrelloAttachment;
            } else if (url) {
                // Existing URL attachment logic
                const params = new URLSearchParams({ url });
                if (name) params.append("name", name);

                attachment = await trelloRequest<TrelloAttachment>(
                    `${TRELLO_API_BASE}/cards/${ticketId}/attachments?${auth.authParams}&${params}`,
                    { method: "POST" }
                );
            } else {
                throw new Error("Either 'url' or 'fileData' must be provided");
            }

            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        id: attachment.id,
                        name: attachment.name,
                        url: attachment.url,
                        message: "Attachment added successfully"
                    }, null, 2)
                }]
            };
        }
    );

    // --- get_attachment ---
    mcpServer.registerTool(
        "get_attachment",
        {
            description: "Get details of an attachment",
            inputSchema: {
                ticketId: z.string().describe("ID of the ticket"),
                attachmentId: z.string().describe("ID of the attachment")
            },
        },
        async ({ ticketId, attachmentId }) => {
            const attachment = await trelloRequest<TrelloAttachment>(
                `${TRELLO_API_BASE}/cards/${ticketId}/attachments/${attachmentId}?${auth.authParams}`
            );
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        id: attachment.id,
                        name: attachment.name,
                        url: attachment.url,
                        mimeType: attachment.mimeType,
                        bytes: attachment.bytes,
                        date: attachment.date,
                        isUpload: attachment.isUpload,
                        previews: attachment.previews || []
                    }, null, 2)
                }]
            };
        }
    );
}

// =============================================================================
// HTTP Routes with Hono MCP Transport
// =============================================================================

export const tasksMcpRoutes = new Hono();

// Create transport
const transport = new StreamableHTTPTransport();

/**
 * MCP endpoint - handles all MCP communication
 */
tasksMcpRoutes.all("/", async (c) => {
    // Check if configured
    if (!auth) {
        return c.json({
            error: "Tasks MCP server not configured. Set TRELLO_API_KEY and TRELLO_TOKEN environment variables."
        }, 503);
    }

    // Connect server to transport if not already connected
    if (!mcpServer.isConnected()) {
        await mcpServer.connect(transport);
    }

    return transport.handleRequest(c);
});

/**
 * Health/info endpoint
 */
tasksMcpRoutes.get("/info", async (c) => {
    return c.json({
        name: "tasks",
        version: "1.0.0",
        description: "Task and ticket management",
        status: auth ? "ready" : "not_configured",
        configured: !!auth,
        tools: auth ? [
            "list_projects", "list_statuses", "list_labels", "list_tickets",
            "create_ticket", "get_ticket", "update_ticket", "archive_ticket",
            "list_comments", "add_comment",
            "list_attachments", "add_attachment", "get_attachment"
        ] : [],
        note: auth ? undefined : "Set TRELLO_API_KEY and TRELLO_TOKEN environment variables"
    });
});
