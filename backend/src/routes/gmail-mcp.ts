/**
 * Gmail MCP Server
 * Implements the Model Context Protocol for Gmail operations
 *
 * Endpoint: /mcp/gmail
 * Transport: Streamable HTTP via @hono/mcp
 */

import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { z } from "zod";
import { AsyncLocalStorage } from "async_hooks";
import {
    getAccessTokenForSession,
    createAuthHeaders,
    isGoogleConfigured,
    isValidSession,
} from "../lib/google-auth";

// =============================================================================
// Session context
// =============================================================================

const sessionStore = new AsyncLocalStorage<string>();

async function getToken(): Promise<string> {
    const session = sessionStore.getStore();
    if (!session) throw new Error("No Google session. Please connect your Google account.");
    return getAccessTokenForSession(session);
}

// =============================================================================
// Helpers
// =============================================================================

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

function buildRawEmail(options: {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    bcc?: string;
    inReplyTo?: string;
    references?: string;
    threadId?: string;
}): string {
    const lines: string[] = [
        `To: ${options.to}`,
        `Subject: ${options.subject}`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=UTF-8",
    ];
    if (options.cc) lines.push(`Cc: ${options.cc}`);
    if (options.bcc) lines.push(`Bcc: ${options.bcc}`);
    if (options.inReplyTo) {
        lines.push(`In-Reply-To: ${options.inReplyTo}`);
        lines.push(`References: ${options.references || options.inReplyTo}`);
    }
    lines.push("", options.body);
    // base64url encode the raw MIME message
    return Buffer.from(lines.join("\r\n")).toString("base64url");
}

interface GmailHeader {
    name: string;
    value: string;
}

function getHeader(headers: GmailHeader[], name: string): string {
    return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || "";
}

function extractBody(payload: Record<string, unknown>): string {
    // Simple text/plain body
    const body = payload.body as { data?: string; size?: number } | undefined;
    if (body?.data) return Buffer.from(body.data, "base64url").toString("utf-8");

    // Multipart — find text/plain part
    const parts = (payload.parts || []) as Array<Record<string, unknown>>;
    for (const part of parts) {
        const mimeType = part.mimeType as string;
        if (mimeType === "text/plain") {
            const partBody = part.body as { data?: string } | undefined;
            if (partBody?.data) return Buffer.from(partBody.data, "base64url").toString("utf-8");
        }
        // Nested multipart
        if (mimeType?.startsWith("multipart/")) {
            const nested = extractBody(part);
            if (nested) return nested;
        }
    }
    return "";
}

// =============================================================================
// MCP Server
// =============================================================================

const mcpServer = new McpServer({ name: "gmail", version: "1.0.0" });
const configured = isGoogleConfigured();

if (configured) {
    mcpServer.registerTool("search_emails", {
        description: "Search emails using Gmail query syntax (e.g. 'from:user@example.com', 'is:unread', 'subject:invoice')",
        inputSchema: {
            query: z.string().describe("Gmail search query"),
            limit: z.number().optional().describe("Max results (default: 10, max: 50)"),
        },
    }, async ({ query, limit: rawLimit }) => {
        const token = await getToken();
        const headers = createAuthHeaders(token);
        const limit = Math.min(rawLimit || 10, 50);

        const params = new URLSearchParams({ q: query, maxResults: limit.toString() });
        const listRes = await fetch(`${GMAIL_API}/messages?${params}`, { headers });
        if (!listRes.ok) { const e = await listRes.text(); throw new Error(`Failed to search: ${listRes.status} ${e}`); }
        const listData = (await listRes.json()) as { messages?: Array<{ id: string; threadId: string }>; resultSizeEstimate?: number };

        if (!listData.messages?.length) {
            return { content: [{ type: "text" as const, text: JSON.stringify({ messages: [], count: 0 }, null, 2) }] };
        }

        // Fetch metadata for each message
        const summaries = await Promise.all(listData.messages.map(async (msg) => {
            const msgRes = await fetch(`${GMAIL_API}/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`, { headers });
            if (!msgRes.ok) return { id: msg.id, threadId: msg.threadId };
            const msgData = (await msgRes.json()) as { payload?: { headers?: GmailHeader[] }; snippet?: string; labelIds?: string[] };
            const hdrs = msgData.payload?.headers || [];
            return {
                id: msg.id,
                threadId: msg.threadId,
                from: getHeader(hdrs, "From"),
                to: getHeader(hdrs, "To"),
                subject: getHeader(hdrs, "Subject"),
                date: getHeader(hdrs, "Date"),
                snippet: msgData.snippet,
                labels: msgData.labelIds,
            };
        }));

        return { content: [{ type: "text" as const, text: JSON.stringify({ messages: summaries, count: summaries.length, totalEstimate: listData.resultSizeEstimate }, null, 2) }] };
    });

    mcpServer.registerTool("get_email", {
        description: "Get full email content by message ID",
        inputSchema: { messageId: z.string().describe("Message ID") },
    }, async ({ messageId }) => {
        const token = await getToken();
        const headers = createAuthHeaders(token);

        const res = await fetch(`${GMAIL_API}/messages/${messageId}?format=full`, { headers });
        if (!res.ok) { const e = await res.text(); throw new Error(`Failed to get email: ${res.status} ${e}`); }
        const msg = (await res.json()) as { payload?: Record<string, unknown> & { headers?: GmailHeader[] }; snippet?: string; labelIds?: string[]; threadId?: string };
        const hdrs = msg.payload?.headers || [];

        return {
            content: [{
                type: "text" as const,
                text: JSON.stringify({
                    id: messageId,
                    threadId: msg.threadId,
                    from: getHeader(hdrs, "From"),
                    to: getHeader(hdrs, "To"),
                    cc: getHeader(hdrs, "Cc"),
                    subject: getHeader(hdrs, "Subject"),
                    date: getHeader(hdrs, "Date"),
                    messageId: getHeader(hdrs, "Message-ID"),
                    body: extractBody(msg.payload || {}),
                    labels: msg.labelIds,
                }, null, 2),
            }],
        };
    });

    mcpServer.registerTool("send_email", {
        description: "Send a new email",
        inputSchema: {
            to: z.string().describe("Recipient email address(es), comma-separated"),
            subject: z.string().describe("Email subject"),
            body: z.string().describe("Email body (plain text)"),
            cc: z.string().optional().describe("CC recipients, comma-separated"),
            bcc: z.string().optional().describe("BCC recipients, comma-separated"),
        },
    }, async ({ to, subject, body, cc, bcc }) => {
        const token = await getToken();
        const headers = createAuthHeaders(token);
        const raw = buildRawEmail({ to, subject, body, cc, bcc });

        const res = await fetch(`${GMAIL_API}/messages/send`, {
            method: "POST", headers,
            body: JSON.stringify({ raw }),
        });
        if (!res.ok) { const e = await res.text(); throw new Error(`Failed to send: ${res.status} ${e}`); }
        const sent = (await res.json()) as { id: string; threadId: string; labelIds?: string[] };

        return { content: [{ type: "text" as const, text: JSON.stringify({ id: sent.id, threadId: sent.threadId, message: `Email sent to ${to}` }, null, 2) }] };
    });

    mcpServer.registerTool("reply_to_email", {
        description: "Reply to an existing email thread",
        inputSchema: {
            messageId: z.string().describe("Message ID to reply to"),
            body: z.string().describe("Reply body (plain text)"),
            replyAll: z.boolean().optional().describe("Reply to all recipients (default: false)"),
        },
    }, async ({ messageId, body, replyAll }) => {
        const token = await getToken();
        const headers = createAuthHeaders(token);

        // Fetch the original message to get headers
        const origRes = await fetch(`${GMAIL_API}/messages/${messageId}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Message-ID`, { headers });
        if (!origRes.ok) throw new Error(`Failed to get original message: ${origRes.status}`);
        const orig = (await origRes.json()) as { payload?: { headers?: GmailHeader[] }; threadId?: string };
        const origHeaders = orig.payload?.headers || [];

        const from = getHeader(origHeaders, "From");
        const to = replyAll ? [from, getHeader(origHeaders, "To"), getHeader(origHeaders, "Cc")].filter(Boolean).join(", ") : from;
        const subject = getHeader(origHeaders, "Subject").startsWith("Re:") ? getHeader(origHeaders, "Subject") : `Re: ${getHeader(origHeaders, "Subject")}`;
        const inReplyTo = getHeader(origHeaders, "Message-ID");

        const raw = buildRawEmail({ to, subject, body, inReplyTo });
        const res = await fetch(`${GMAIL_API}/messages/send`, {
            method: "POST", headers,
            body: JSON.stringify({ raw, threadId: orig.threadId }),
        });
        if (!res.ok) { const e = await res.text(); throw new Error(`Failed to reply: ${res.status} ${e}`); }
        const sent = (await res.json()) as { id: string; threadId: string };

        return { content: [{ type: "text" as const, text: JSON.stringify({ id: sent.id, threadId: sent.threadId, message: `Reply sent to ${to}` }, null, 2) }] };
    });

    mcpServer.registerTool("list_labels", {
        description: "List all Gmail labels",
        inputSchema: {},
    }, async () => {
        const token = await getToken();
        const headers = createAuthHeaders(token);

        const res = await fetch(`${GMAIL_API}/labels`, { headers });
        if (!res.ok) { const e = await res.text(); throw new Error(`Failed to list labels: ${res.status} ${e}`); }
        const data = (await res.json()) as { labels?: Array<{ id: string; name: string; type: string }> };

        return { content: [{ type: "text" as const, text: JSON.stringify({ labels: data.labels || [], count: (data.labels || []).length }, null, 2) }] };
    });

    mcpServer.registerTool("modify_labels", {
        description: "Add or remove labels on a message (e.g. archive by removing INBOX, star by adding STARRED)",
        inputSchema: {
            messageId: z.string().describe("Message ID"),
            addLabelIds: z.array(z.string()).optional().describe("Label IDs to add"),
            removeLabelIds: z.array(z.string()).optional().describe("Label IDs to remove"),
        },
    }, async ({ messageId, addLabelIds, removeLabelIds }) => {
        const token = await getToken();
        const headers = createAuthHeaders(token);

        const res = await fetch(`${GMAIL_API}/messages/${messageId}/modify`, {
            method: "POST", headers,
            body: JSON.stringify({ addLabelIds: addLabelIds || [], removeLabelIds: removeLabelIds || [] }),
        });
        if (!res.ok) { const e = await res.text(); throw new Error(`Failed to modify labels: ${res.status} ${e}`); }
        const msg = (await res.json()) as { id: string; labelIds?: string[] };

        return { content: [{ type: "text" as const, text: JSON.stringify({ id: msg.id, labels: msg.labelIds, message: "Labels updated" }, null, 2) }] };
    });
}

// =============================================================================
// HTTP Routes
// =============================================================================

export const gmailMcpRoutes = new Hono();
const transport = new StreamableHTTPTransport();

gmailMcpRoutes.all("/", async (c) => {
    if (!configured) return c.json({ error: "Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET." }, 503);

    const authHeader = c.req.header("Authorization") || "";
    const sessionToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

    if (!sessionToken || !(await isValidSession(sessionToken))) {
        c.header("WWW-Authenticate", 'Bearer scope="google"');
        return c.json({ error: "Google authentication required" }, 401);
    }

    if (!mcpServer.isConnected()) await mcpServer.connect(transport);
    return sessionStore.run(sessionToken, () => transport.handleRequest(c));
});

gmailMcpRoutes.get("/info", async (c) => {
    return c.json({
        name: "gmail", version: "1.0.0",
        status: configured ? "ready" : "not_configured", configured,
        tools: configured ? ["search_emails", "get_email", "send_email", "reply_to_email", "list_labels", "modify_labels"] : [],
    });
});
