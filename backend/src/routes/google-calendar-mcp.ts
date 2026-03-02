/**
 * Google Calendar MCP Server
 * Implements the Model Context Protocol for Google Calendar operations
 *
 * Endpoint: /mcp/google-calendar
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
    buildGoogleWwwAuthenticate,
    buildGoogleResourceMetadata,
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

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

interface CalendarEvent {
    id: string;
    summary?: string;
    description?: string;
    location?: string;
    start?: { dateTime?: string; date?: string; timeZone?: string };
    end?: { dateTime?: string; date?: string; timeZone?: string };
    attendees?: Array<{ email: string; responseStatus?: string }>;
    htmlLink?: string;
    status?: string;
    created?: string;
    updated?: string;
    organizer?: { email?: string };
}

function summarizeEvent(event: CalendarEvent) {
    return {
        id: event.id,
        summary: event.summary,
        start: event.start?.dateTime || event.start?.date,
        end: event.end?.dateTime || event.end?.date,
        location: event.location || undefined,
        status: event.status,
        attendees: event.attendees?.length || 0,
        url: event.htmlLink,
    };
}

// =============================================================================
// MCP Server
// =============================================================================

const mcpServer = new McpServer({ name: "google-calendar", version: "1.0.0" });
const configured = isGoogleConfigured();

if (configured) {
    mcpServer.registerTool("list_calendars", {
        description: "List all calendars accessible to the user",
        inputSchema: {},
    }, async () => {
        const token = await getToken();
        const headers = createAuthHeaders(token);

        const res = await fetch(`${CALENDAR_API}/users/me/calendarList`, { headers });
        if (!res.ok) { const e = await res.text(); throw new Error(`Failed to list calendars: ${res.status} ${e}`); }
        const data = (await res.json()) as { items?: Array<{ id: string; summary: string; primary?: boolean; timeZone?: string; accessRole?: string }> };
        const calendars = (data.items || []).map(c => ({
            id: c.id, name: c.summary, primary: c.primary || false, timeZone: c.timeZone, accessRole: c.accessRole,
        }));

        return { content: [{ type: "text" as const, text: JSON.stringify({ calendars, count: calendars.length }, null, 2) }] };
    });

    mcpServer.registerTool("list_events", {
        description: "List events from a calendar within a time range",
        inputSchema: {
            calendarId: z.string().optional().describe("Calendar ID (default: 'primary')"),
            timeMin: z.string().optional().describe("Start of time range (ISO 8601, e.g. '2025-01-01T00:00:00Z'). Defaults to now."),
            timeMax: z.string().optional().describe("End of time range (ISO 8601). Defaults to 7 days from now."),
            query: z.string().optional().describe("Free text search query"),
            limit: z.number().optional().describe("Max results (default: 20, max: 100)"),
        },
    }, async ({ calendarId, timeMin, timeMax, query, limit: rawLimit }) => {
        const token = await getToken();
        const headers = createAuthHeaders(token);
        const cal = encodeURIComponent(calendarId || "primary");
        const limit = Math.min(rawLimit || 20, 100);

        const now = new Date();
        const defaultMax = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        const params = new URLSearchParams({
            timeMin: timeMin || now.toISOString(),
            timeMax: timeMax || defaultMax.toISOString(),
            maxResults: limit.toString(),
            singleEvents: "true",
            orderBy: "startTime",
        });
        if (query) params.set("q", query);

        const res = await fetch(`${CALENDAR_API}/calendars/${cal}/events?${params}`, { headers });
        if (!res.ok) { const e = await res.text(); throw new Error(`Failed to list events: ${res.status} ${e}`); }
        const data = (await res.json()) as { items?: CalendarEvent[]; timeZone?: string };
        const events = (data.items || []).map(summarizeEvent);

        return { content: [{ type: "text" as const, text: JSON.stringify({ events, count: events.length, timeZone: data.timeZone }, null, 2) }] };
    });

    mcpServer.registerTool("get_event", {
        description: "Get details of a single calendar event",
        inputSchema: {
            calendarId: z.string().optional().describe("Calendar ID (default: 'primary')"),
            eventId: z.string().describe("Event ID"),
        },
    }, async ({ calendarId, eventId }) => {
        const token = await getToken();
        const headers = createAuthHeaders(token);
        const cal = encodeURIComponent(calendarId || "primary");

        const res = await fetch(`${CALENDAR_API}/calendars/${cal}/events/${encodeURIComponent(eventId)}`, { headers });
        if (!res.ok) { const e = await res.text(); throw new Error(`Failed to get event: ${res.status} ${e}`); }
        const event = (await res.json()) as CalendarEvent;

        return {
            content: [{
                type: "text" as const,
                text: JSON.stringify({
                    id: event.id,
                    summary: event.summary,
                    description: event.description,
                    location: event.location,
                    start: event.start,
                    end: event.end,
                    attendees: event.attendees,
                    organizer: event.organizer,
                    status: event.status,
                    url: event.htmlLink,
                    created: event.created,
                    updated: event.updated,
                }, null, 2),
            }],
        };
    });

    mcpServer.registerTool("create_event", {
        description: "Create a new calendar event",
        inputSchema: {
            summary: z.string().describe("Event title"),
            start: z.string().describe("Start time (ISO 8601, e.g. '2025-03-01T10:00:00+01:00')"),
            end: z.string().describe("End time (ISO 8601)"),
            calendarId: z.string().optional().describe("Calendar ID (default: 'primary')"),
            description: z.string().optional().describe("Event description"),
            location: z.string().optional().describe("Event location"),
            attendees: z.array(z.string()).optional().describe("Attendee email addresses"),
            timeZone: z.string().optional().describe("Time zone (e.g. 'Europe/Berlin')"),
        },
    }, async ({ summary, start, end, calendarId, description, location, attendees, timeZone }) => {
        const token = await getToken();
        const headers = createAuthHeaders(token);
        const cal = encodeURIComponent(calendarId || "primary");

        const isAllDay = !start.includes("T");
        const eventBody: Record<string, unknown> = {
            summary,
            start: isAllDay ? { date: start } : { dateTime: start, timeZone },
            end: isAllDay ? { date: end } : { dateTime: end, timeZone },
        };
        if (description) eventBody.description = description;
        if (location) eventBody.location = location;
        if (attendees?.length) eventBody.attendees = attendees.map(email => ({ email }));

        const res = await fetch(`${CALENDAR_API}/calendars/${cal}/events`, {
            method: "POST", headers,
            body: JSON.stringify(eventBody),
        });
        if (!res.ok) { const e = await res.text(); throw new Error(`Failed to create event: ${res.status} ${e}`); }
        const event = (await res.json()) as CalendarEvent;

        return { content: [{ type: "text" as const, text: JSON.stringify({ id: event.id, summary: event.summary, url: event.htmlLink, message: `Event "${summary}" created` }, null, 2) }] };
    });

    mcpServer.registerTool("update_event", {
        description: "Update an existing calendar event (only specified fields are changed)",
        inputSchema: {
            eventId: z.string().describe("Event ID"),
            calendarId: z.string().optional().describe("Calendar ID (default: 'primary')"),
            summary: z.string().optional().describe("New event title"),
            start: z.string().optional().describe("New start time (ISO 8601)"),
            end: z.string().optional().describe("New end time (ISO 8601)"),
            description: z.string().optional().describe("New description"),
            location: z.string().optional().describe("New location"),
            attendees: z.array(z.string()).optional().describe("New attendee emails (replaces existing)"),
            timeZone: z.string().optional().describe("Time zone"),
        },
    }, async ({ eventId, calendarId, summary, start, end, description, location, attendees, timeZone }) => {
        const token = await getToken();
        const headers = createAuthHeaders(token);
        const cal = encodeURIComponent(calendarId || "primary");

        const patch: Record<string, unknown> = {};
        if (summary !== undefined) patch.summary = summary;
        if (description !== undefined) patch.description = description;
        if (location !== undefined) patch.location = location;
        if (start) {
            const isAllDay = !start.includes("T");
            patch.start = isAllDay ? { date: start } : { dateTime: start, timeZone };
        }
        if (end) {
            const isAllDay = !end.includes("T");
            patch.end = isAllDay ? { date: end } : { dateTime: end, timeZone };
        }
        if (attendees) patch.attendees = attendees.map(email => ({ email }));

        const res = await fetch(`${CALENDAR_API}/calendars/${cal}/events/${encodeURIComponent(eventId)}`, {
            method: "PATCH", headers,
            body: JSON.stringify(patch),
        });
        if (!res.ok) { const e = await res.text(); throw new Error(`Failed to update event: ${res.status} ${e}`); }
        const event = (await res.json()) as CalendarEvent;

        return { content: [{ type: "text" as const, text: JSON.stringify({ id: event.id, summary: event.summary, url: event.htmlLink, message: "Event updated" }, null, 2) }] };
    });

    mcpServer.registerTool("delete_event", {
        description: "Delete a calendar event",
        inputSchema: {
            eventId: z.string().describe("Event ID"),
            calendarId: z.string().optional().describe("Calendar ID (default: 'primary')"),
        },
    }, async ({ eventId, calendarId }) => {
        const token = await getToken();
        const headers = createAuthHeaders(token);
        const cal = encodeURIComponent(calendarId || "primary");

        const res = await fetch(`${CALENDAR_API}/calendars/${cal}/events/${encodeURIComponent(eventId)}`, {
            method: "DELETE", headers,
        });
        if (!res.ok) { const e = await res.text(); throw new Error(`Failed to delete event: ${res.status} ${e}`); }

        return { content: [{ type: "text" as const, text: JSON.stringify({ eventId, message: "Event deleted" }, null, 2) }] };
    });
}

// =============================================================================
// HTTP Routes
// =============================================================================

export const googleCalendarMcpRoutes = new Hono();
const transport = new StreamableHTTPTransport();

googleCalendarMcpRoutes.all("/", async (c) => {
    if (!configured) return c.json({ error: "Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET." }, 503);

    const authHeader = c.req.header("Authorization") || "";
    const sessionToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

    if (!sessionToken || !(await isValidSession(sessionToken))) {
        c.header("WWW-Authenticate", buildGoogleWwwAuthenticate(c, "/mcp/google-calendar"));
        return c.json({ error: "Google authentication required" }, 401);
    }

    if (!mcpServer.isConnected()) await mcpServer.connect(transport);
    return sessionStore.run(sessionToken, () => transport.handleRequest(c));
});

googleCalendarMcpRoutes.get("/.well-known/oauth-protected-resource", (c) => {
    return c.json(buildGoogleResourceMetadata(c, "/mcp/google-calendar"));
});

googleCalendarMcpRoutes.get("/info", async (c) => {
    return c.json({
        name: "google-calendar", version: "1.0.0",
        status: configured ? "ready" : "not_configured", configured,
        tools: configured ? ["list_calendars", "list_events", "get_event", "create_event", "update_event", "delete_event"] : [],
    });
});
