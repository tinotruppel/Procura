/**
 * Langfuse Prompt Management Client
 * Fetches prompts from Langfuse via REST API
 */

import { LangfuseConfig, PromptVariable } from "./storage";

/**
 * Replaces {{variableName}} placeholders in prompt content with values from variables array.
 * Returns the substituted content and a list of any missing variable names.
 */
export function replacePromptVariables(
    content: string,
    variables: PromptVariable[]
): { result: string; missing: string[] } {
    const variableMap = new Map(variables.map(v => [v.key, v.value]));
    const missing: string[] = [];

    // Match {{variableName}} pattern
    const result = content.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
        const value = variableMap.get(varName);
        if (value !== undefined) {
            return value;
        }
        // Track missing variable (avoid duplicates)
        if (!missing.includes(varName)) {
            missing.push(varName);
        }
        return match; // Keep original placeholder if no value found
    });

    return { result, missing };
}

/**
 * Helper to check if Langfuse config is valid and enabled.
 * Eliminates duplicated validation across functions.
 */
function isConfigValid(config: LangfuseConfig): boolean {
    return !!(config.enabled && config.publicKey && config.secretKey);
}

interface LangfusePromptListItem {
    name: string;
    versions: number[];
    labels: string[];
    tags: string[];
}

interface LangfusePromptListResponse {
    data: LangfusePromptListItem[];
    meta: {
        page: number;
        limit: number;
        totalItems: number;
        totalPages: number;
    };
}

interface LangfusePromptResponse {
    name: string;
    version: number;
    prompt: string | Array<{ role: string; content: string }>; // text prompts = string, chat prompts = array
    type: "text" | "chat";
    labels: string[];
    tags: string[];
}

/**
 * Create Basic Auth header from Langfuse credentials
 */
function createAuthHeader(config: LangfuseConfig): string {
    const credentials = btoa(`${config.publicKey}:${config.secretKey}`);
    return `Basic ${credentials}`;
}

/**
 * Get the base URL for Langfuse API
 */
function getApiUrl(config: LangfuseConfig): string {
    const host = config.host || "https://cloud.langfuse.com";
    return `${host.replace(/\/$/, "")}/api/public/v2`;
}

/**
 * Fetch all prompts from Langfuse (names only, for dropdown)
 */
export async function fetchLangfusePromptList(config: LangfuseConfig): Promise<LangfusePromptListItem[]> {
    if (!isConfigValid(config)) {
        return [];
    }

    const url = `${getApiUrl(config)}/prompts?limit=100`;

    const response = await fetch(url, {
        method: "GET",
        headers: {
            "Authorization": createAuthHeader(config),
            "Content-Type": "application/json",
        },
    });

    if (!response.ok) {
        if (response.status === 401) {
            throw new Error("Langfuse authentication failed. Check your API keys.");
        }
        throw new Error(`Langfuse API error: ${response.status}`);
    }

    const data: LangfusePromptListResponse = await response.json();
    return data.data;
}

/**
 * Fetch a single prompt's content by name
 * By default fetches the "production" labeled version
 */
/**
 * Result of fetching a prompt with full metadata for linking
 */
interface FetchedPrompt {
    content: string;
    name: string;
    version: number;
}

/**
 * Fetch a single prompt with full metadata (content + version) for linking in traces
 * By default fetches the "production" labeled version
 */
export async function fetchLangfusePrompt(
    config: LangfuseConfig,
    promptName: string,
    label: string = "production"
): Promise<FetchedPrompt> {
    if (!isConfigValid(config)) {
        throw new Error("Langfuse is not configured");
    }

    const url = `${getApiUrl(config)}/prompts/${encodeURIComponent(promptName)}?label=${encodeURIComponent(label)}`;

    const response = await fetch(url, {
        method: "GET",
        headers: {
            "Authorization": createAuthHeader(config),
            "Content-Type": "application/json",
        },
    });

    if (!response.ok) {
        if (response.status === 401) {
            throw new Error("Langfuse authentication failed. Check your API keys.");
        }
        if (response.status === 404) {
            throw new Error(`Prompt "${promptName}" not found in Langfuse`);
        }
        throw new Error(`Langfuse API error: ${response.status}`);
    }

    const data: LangfusePromptResponse = await response.json();

    // Extract content based on prompt type
    let content: string;
    if (data.type === "chat") {
        try {
            let messages: Array<{ role: string; content: string }>;
            if (Array.isArray(data.prompt)) {
                messages = data.prompt;
            } else if (typeof data.prompt === "string") {
                messages = JSON.parse(data.prompt);
            } else {
                content = String(data.prompt);
                return { content, name: data.name, version: data.version };
            }

            const systemMsg = messages.find(m => m.role === "system");
            content = systemMsg?.content || messages[0]?.content || String(data.prompt);
        } catch {
            content = typeof data.prompt === "string" ? data.prompt : JSON.stringify(data.prompt);
        }
    } else {
        content = typeof data.prompt === "string" ? data.prompt : JSON.stringify(data.prompt);
    }

    return {
        content,
        name: data.name,
        version: data.version,
    };
}

/**
 * Test Langfuse connection with given config
 */
export async function testLangfuseConnection(config: LangfuseConfig): Promise<{ success: boolean; error?: string; promptCount?: number }> {
    try {
        const prompts = await fetchLangfusePromptList(config);
        return {
            success: true,
            promptCount: prompts.length,
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : "Connection failed",
        };
    }
}

// ============================================================================
// Tracing / Observability
// ============================================================================

interface LangfuseTraceInput {
    id: string;
    name: string;
    sessionId?: string;
    input?: unknown;
    output?: unknown;
    userId?: string;
    metadata?: Record<string, unknown>;
}

interface LangfuseGenerationInput {
    id: string;
    traceId: string;
    name: string;
    model: string;
    input?: unknown;
    output?: string;
    startTime: Date;
    endTime?: Date;
    usage?: {
        input?: number;
        output?: number;
        total?: number;
    };
    promptName?: string;
    promptVersion?: number;
    metadata?: Record<string, unknown>;
}

interface IngestionEvent {
    id: string;
    type: string;
    timestamp: string;
    body: unknown;
}

/**
 * Send batch of events to Langfuse ingestion API
 */
async function sendLangfuseEvents(config: LangfuseConfig, events: IngestionEvent[]): Promise<void> {
    if (!isConfigValid(config)) {
        return;
    }

    const host = config.host || "https://cloud.langfuse.com";
    const url = `${host.replace(/\/$/, "")}/api/public/ingestion`;

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Authorization": createAuthHeader(config),
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ batch: events }),
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        console.error("[Langfuse] Ingestion failed:", response.status, errorText);
    }
}

/**
 * Create a trace in Langfuse
 */
export interface LangfuseSpanInput {
    id: string;
    traceId: string;
    name: string;
    input?: unknown;
    output?: unknown;
    startTime?: Date;
    endTime?: Date;
    metadata?: Record<string, unknown>;
    level?: "DEBUG" | "DEFAULT" | "WARNING" | "ERROR";
}

/**
 * Create a span (e.g., tool call) in Langfuse, linked to a trace
 */
interface LangfuseBatchInput {
    trace: LangfuseTraceInput;
    generation?: LangfuseGenerationInput;
    spans?: LangfuseSpanInput[];
}

/**
 * Send a complete batch (trace + generation + spans) in a single API call
 * This ensures all events are processed together for proper aggregation
 */
export async function sendLangfuseBatch(config: LangfuseConfig, batch: LangfuseBatchInput): Promise<void> {
    if (!isConfigValid(config)) {
        return;
    }

    const events: IngestionEvent[] = [];
    const timestamp = new Date().toISOString();

    // Add trace event
    events.push({
        id: crypto.randomUUID(),
        type: "trace-create",
        timestamp,
        body: {
            id: batch.trace.id,
            name: batch.trace.name,
            sessionId: batch.trace.sessionId,
            input: batch.trace.input,
            output: batch.trace.output,
            userId: batch.trace.userId,
            metadata: batch.trace.metadata,
        },
    });

    // Add generation event if provided
    if (batch.generation) {
        const genBody: Record<string, unknown> = {
            id: batch.generation.id,
            traceId: batch.generation.traceId,
            name: batch.generation.name,
            type: "GENERATION", // Required to identify this as a generation observation
            model: batch.generation.model,
            input: batch.generation.input,
            output: batch.generation.output,
            startTime: batch.generation.startTime.toISOString(),
            endTime: batch.generation.endTime?.toISOString(),
            usage: batch.generation.usage,
            metadata: batch.generation.metadata,
        };

        // Link to Langfuse prompt if provided (version must be a number)
        if (batch.generation.promptName) {
            genBody.promptName = batch.generation.promptName;
            if (typeof batch.generation.promptVersion === "number") {
                genBody.promptVersion = batch.generation.promptVersion;
            }
        }

        events.push({
            id: crypto.randomUUID(),
            type: "generation-create",
            timestamp,
            body: genBody,
        });
    }

    // Add span events if provided
    if (batch.spans) {
        for (const span of batch.spans) {
            events.push({
                id: crypto.randomUUID(),
                type: "span-create",
                timestamp,
                body: {
                    id: span.id,
                    traceId: span.traceId,
                    name: span.name,
                    input: span.input,
                    output: span.output,
                    startTime: span.startTime?.toISOString(),
                    endTime: span.endTime?.toISOString(),
                    metadata: span.metadata,
                    level: span.level || "DEFAULT",
                },
            });
        }
    }

    await sendLangfuseEvents(config, events);
}

/**
 * Send a user feedback score to Langfuse for a specific trace
 * Used for thumbs up/down feedback in the UI
 */
interface LangfuseScoreInput {
    traceId: string;
    name: string; // e.g., "user-feedback"
    value: number; // 1 for thumbs up, 0 for thumbs down
    comment?: string; // Optional text feedback
}

export async function sendLangfuseScore(
    config: LangfuseConfig,
    score: LangfuseScoreInput
): Promise<void> {
    if (!isConfigValid(config)) {
        return;
    }

    const host = config.host || "https://cloud.langfuse.com";
    const credentials = btoa(`${config.publicKey}:${config.secretKey}`);

    const body: Record<string, unknown> = {
        traceId: score.traceId,
        name: score.name,
        value: score.value,
    };

    if (score.comment) {
        body.comment = score.comment;
    }

    try {
        const response = await fetch(`${host}/api/public/scores`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Basic ${credentials}`,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            console.error("Failed to send Langfuse score:", response.status);
        }
    } catch (err) {
        console.error("Error sending Langfuse score:", err);
    }
}
