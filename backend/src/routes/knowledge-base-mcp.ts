/**
 * Knowledge Base MCP Server
 * Implements the Model Context Protocol for semantic search and document archival
 *
 * Endpoint: /mcp/knowledge-base
 * Transport: Streamable HTTP via @hono/mcp
 *
 * Features:
 * - list_collections: List all knowledge collections
 * - search: Semantic search with auto-generated embeddings
 * - retrieve: Get documents by ID
 * - archive: Chunk and store documents with embeddings
 *
 * Per-request Qdrant API key:
 * - External API keys can be mapped to different Qdrant API keys via QDRANT_KEY_MAPPINGS
 * - If no mapping exists for the external key, falls back to QDRANT_API_KEY env default
 */

import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { z } from "zod";
import { AsyncLocalStorage } from "async_hooks";
import { getConfig } from "../config";
import { resolveSecret } from "../lib/vault-resolver";

// =============================================================================
// Types
// =============================================================================

interface QdrantPoint {
    id: string | number;
    version?: number;
    score?: number;
    payload: Record<string, unknown>;
    vector?: number[];
}

interface QdrantCollection {
    name: string;
}

interface DocumentChunk {
    text: string;
    index: number;
}

// =============================================================================
// Per-request Qdrant API key (resolved from API key mapping)
// =============================================================================

const qdrantKeyStore = new AsyncLocalStorage<string | undefined>();

/**
 * Get the Qdrant API key for the current request.
 * Checks the per-request store first (from API key mapping), falls back to env default.
 */
function getQdrantApiKey(): string | undefined {
    return qdrantKeyStore.getStore() ?? process.env.QDRANT_API_KEY;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Generate a deterministic UUID from a string
 */
function stringToUuid(input: string): string {
    let hash1 = 0;
    let hash2 = 0;
    for (let i = 0; i < input.length; i++) {
        const char = input.charCodeAt(i);
        hash1 = ((hash1 << 5) - hash1 + char) | 0;
        hash2 = ((hash2 << 7) - hash2 + char) | 0;
    }

    const h1 = Math.abs(hash1).toString(16).padStart(8, '0');
    const h2 = Math.abs(hash2).toString(16).padStart(8, '0');
    const combined = (h1 + h2).padEnd(32, '0').slice(0, 32);

    return `${combined.slice(0, 8)}-${combined.slice(8, 12)}-4${combined.slice(13, 16)}-${combined.slice(16, 20)}-${combined.slice(20, 32)}`;
}

/**
 * Split text into overlapping chunks for embedding
 */
function chunkText(text: string, chunkSize: number = 800, overlap: number = 100): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const cleanText = text.trim();

    if (cleanText.length <= chunkSize) {
        return [{ text: cleanText, index: 0 }];
    }

    let startIndex = 0;
    let chunkIndex = 0;

    while (startIndex < cleanText.length) {
        let endIndex = startIndex + chunkSize;

        if (endIndex < cleanText.length) {
            const searchStart = Math.max(startIndex + chunkSize - 200, startIndex);
            const searchText = cleanText.slice(searchStart, endIndex);

            const paragraphBreak = searchText.lastIndexOf("\n\n");
            if (paragraphBreak > 0) {
                endIndex = searchStart + paragraphBreak + 2;
            } else {
                const sentenceBreak = searchText.search(/[.!?]\s+(?=[A-Z])/);
                if (sentenceBreak > 0) {
                    endIndex = searchStart + sentenceBreak + 2;
                }
            }
        }

        const chunkContent = cleanText.slice(startIndex, endIndex).trim();
        if (chunkContent.length > 0) {
            chunks.push({ text: chunkContent, index: chunkIndex++ });
        }

        startIndex = endIndex - overlap;
        if (startIndex >= cleanText.length) break;
    }

    return chunks;
}

/**
 * Generate embedding using OpenAI API
 */
async function generateEmbedding(text: string, apiKey: string, model: string): Promise<number[]> {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            input: text,
            model: model,
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI embedding failed: ${response.status} ${error}`);
    }

    const data = await response.json() as { data: Array<{ embedding: number[] }> };
    return data.data[0].embedding;
}

/**
 * Make a Qdrant API request
 */
async function qdrantRequest<T>(
    url: string,
    path: string,
    method: string,
    apiKey?: string,
    body?: unknown
): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) {
        headers["api-key"] = apiKey;
    }

    const response = await fetch(`${url}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Qdrant API error: ${response.status} ${error}`);
    }

    return response.json() as Promise<T>;
}

// =============================================================================
// MCP Server Setup
// =============================================================================

interface BaseAuth {
    url: string;
    embeddingApiKey: string;
    embeddingModel: string;
}

// Request-scoped API key (set per-request in the route handler)
let currentRequestApiKey: string | undefined;

async function resolveBaseAuth(): Promise<BaseAuth | null> {
    const url = await resolveSecret("QDRANT_URL", currentRequestApiKey);
    const embeddingApiKey = await resolveSecret("OPENAI_API_KEY", currentRequestApiKey);
    const embeddingModel = (await resolveSecret("QDRANT_EMBEDDING_MODEL", currentRequestApiKey)) || "text-embedding-3-small";
    if (!url || !embeddingApiKey) return null;
    return { url: url.replace(/\/$/, ""), embeddingApiKey, embeddingModel };
}

const mcpServer = new McpServer({
    name: "knowledge-base",
    version: "1.0.0",
});

// --- list_collections ---
mcpServer.registerTool(
    "list_collections",
    {
        description: "List all collections in the knowledge base",
    },
    async () => {
        const baseAuth = await resolveBaseAuth();
        if (!baseAuth) {
            return {
                content: [{ type: "text" as const, text: JSON.stringify({ error: "QDRANT_URL and OPENAI_API_KEY not configured. Store them via vault or set as environment variables." }, null, 2) }],
                isError: true
            };
        }
        const data = await qdrantRequest<{ result: { collections: QdrantCollection[] } }>(
            baseAuth.url, "/collections", "GET", getQdrantApiKey()
        );

        const collections = data.result?.collections || [];
        return {
            content: [{
                type: "text" as const,
                text: JSON.stringify({
                    collections: collections.map(c => c.name),
                    count: collections.length,
                }, null, 2)
            }]
        };
    }
);

// --- search_points ---
mcpServer.registerTool(
    "search",
    {
        description: "Semantic search in a knowledge collection. Auto-generates embeddings from query text.",
            inputSchema: {
                collection: z.string().describe("Name of the collection to search"),
                query: z.string().describe("Search text (will be converted to embedding)"),
                limit: z.number().optional().describe("Maximum number of results (default: 10)"),
                filterJson: z.string().optional().describe("Qdrant filter as JSON string, e.g. '{\"must\":[{\"key\":\"type\",\"match\":{\"value\":\"article\"}}]}'"),
            },
        },
        async ({ collection, query, limit = 10, filterJson }) => {
            const baseAuth = await resolveBaseAuth();
            if (!baseAuth) {
                return {
                    content: [{ type: "text" as const, text: JSON.stringify({ error: "QDRANT_URL and OPENAI_API_KEY not configured." }, null, 2) }],
                    isError: true
                };
            }

            // Parse filter if provided
            let filter: Record<string, unknown> | undefined;
            if (filterJson) {
                try {
                    filter = JSON.parse(filterJson);
                } catch {
                    return {
                        content: [{
                            type: "text" as const,
                            text: JSON.stringify({ error: "Invalid filterJson: must be valid JSON" }, null, 2)
                        }],
                        isError: true
                    };
                }
            }

            const embedding = await generateEmbedding(query, baseAuth.embeddingApiKey, baseAuth.embeddingModel);

            const queryBody: Record<string, unknown> = {
                query: embedding,
                limit,
                with_payload: true,
            };
            if (filter) {
                queryBody.filter = filter;
            }

            const data = await qdrantRequest<{ result: { points: QdrantPoint[] } }>(
                baseAuth.url, `/collections/${collection}/points/query`, "POST", getQdrantApiKey(), queryBody
            );

            const points = data.result?.points || [];
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        points: points.map(p => ({
                            id: p.id,
                            score: p.score,
                            payload: p.payload,
                        })),
                        count: points.length,
                        collection,
                        query,
                    }, null, 2)
                }]
            };
        }
    );

    // --- retrieve_points ---
    mcpServer.registerTool(
        "retrieve",
        {
            description: "Retrieve specific documents by their IDs",
            inputSchema: {
                collection: z.string().describe("Name of the collection"),
                ids: z.array(z.string()).describe("Array of point IDs to retrieve"),
            },
        },
        async ({ collection, ids }) => {
            const baseAuth = await resolveBaseAuth();
            if (!baseAuth) {
                return {
                    content: [{ type: "text" as const, text: JSON.stringify({ error: "QDRANT_URL and OPENAI_API_KEY not configured." }, null, 2) }],
                    isError: true
                };
            }
            const data = await qdrantRequest<{ result: QdrantPoint[] }>(
                baseAuth.url, `/collections/${collection}/points`, "POST", getQdrantApiKey(),
                { ids, with_payload: true }
            );

            const points = data.result || [];
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        points: points.map(p => ({
                            id: p.id,
                            payload: p.payload,
                        })),
                        count: points.length,
                        collection,
                    }, null, 2)
                }]
            };
        }
    );

    // --- archive_document ---
    mcpServer.registerTool(
        "archive",
        {
            description: "Archive a document by chunking it and storing with embeddings. Use content from parse_file or document-media server.",
            inputSchema: {
                collection: z.string().describe("Name of the collection to store in"),
                content: z.string().describe("Text content to archive"),
                documentId: z.string().describe("Unique document identifier (e.g. filename)"),
                replaceExisting: z.boolean().optional().describe("If true, replace existing document chunks (default: false)"),
                metadataJson: z.string().optional().describe("Additional metadata as JSON string"),
            },
        },
        async ({ collection, content, documentId, replaceExisting = false, metadataJson }) => {
            const baseAuth = await resolveBaseAuth();
            if (!baseAuth) {
                return {
                    content: [{ type: "text" as const, text: JSON.stringify({ error: "QDRANT_URL and OPENAI_API_KEY not configured." }, null, 2) }],
                    isError: true
                };
            }

            // Parse metadata
            let userMetadata: Record<string, unknown> = {};
            if (metadataJson) {
                try {
                    userMetadata = JSON.parse(metadataJson);
                } catch {
                    return {
                        content: [{
                            type: "text" as const,
                            text: JSON.stringify({ error: "Invalid metadataJson: must be valid JSON" }, null, 2)
                        }],
                        isError: true
                    };
                }
            }

            const qdrantApiKey = getQdrantApiKey();

            // Check if collection exists
            try {
                await qdrantRequest(baseAuth.url, `/collections/${collection}`, "GET", qdrantApiKey);
            } catch {
                return {
                    content: [{
                        type: "text" as const,
                        text: JSON.stringify({
                            error: `Collection '${collection}' does not exist. Create it first in Qdrant.`
                        }, null, 2)
                    }],
                    isError: true
                };
            }

            // Check for existing document
            const existingCheck = await qdrantRequest<{ result: { points: QdrantPoint[] } }>(
                baseAuth.url, `/collections/${collection}/points/scroll`, "POST", qdrantApiKey,
                {
                    filter: { must: [{ key: "documentId", match: { value: documentId } }] },
                    limit: 1,
                    with_payload: false,
                }
            );

            const existingPoints = existingCheck.result?.points || [];
            if (existingPoints.length > 0) {
                if (!replaceExisting) {
                    return {
                        content: [{
                            type: "text" as const,
                            text: JSON.stringify({
                                error: `Document '${documentId}' already exists. Set replaceExisting: true to replace.`
                            }, null, 2)
                        }],
                        isError: true
                    };
                }

                // Delete existing chunks
                await qdrantRequest(
                    baseAuth.url, `/collections/${collection}/points/delete`, "POST", qdrantApiKey,
                    { filter: { must: [{ key: "documentId", match: { value: documentId } }] } }
                );
            }

            // Chunk the content
            const chunks = chunkText(content, 800, 100);

            // Generate embeddings and create points
            const points: Array<{ id: string; vector: number[]; payload: Record<string, unknown> }> = [];
            const archivedAt = new Date().toISOString();

            for (const chunk of chunks) {
                const embedding = await generateEmbedding(chunk.text, baseAuth.embeddingApiKey, baseAuth.embeddingModel);
                const pointId = stringToUuid(`${documentId}_chunk_${chunk.index}`);

                points.push({
                    id: pointId,
                    vector: embedding,
                    payload: {
                        documentId,
                        chunkIndex: chunk.index,
                        totalChunks: chunks.length,
                        archivedAt,
                        text: chunk.text,
                        ...userMetadata,
                    },
                });
            }

            // Upsert points
            await qdrantRequest(
                baseAuth.url, `/collections/${collection}/points`, "PUT", qdrantApiKey,
                { points }
            );

            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        message: `Successfully archived document '${documentId}' to collection '${collection}'`,
                        documentId,
                        collection,
                        chunksCreated: points.length,
                        archivedAt,
                    }, null, 2)
                }]
            };
        }
    );

// =============================================================================
// HTTP Routes
// =============================================================================

export const knowledgeBaseMcpRoutes = new Hono();

const transport = new StreamableHTTPTransport();

knowledgeBaseMcpRoutes.all("/", async (c) => {
    currentRequestApiKey = c.req.header("X-API-Key") || undefined;

    try {
        if (!mcpServer.isConnected()) {
            await mcpServer.connect(transport);
        }

        // Resolve per-request Qdrant API key from mapping
        const externalKey = c.req.header("X-API-Key") || "";
        const config = getConfig();
        const mappedQdrantKey = externalKey ? config.qdrantKeyMappings.get(externalKey) : undefined;

        return qdrantKeyStore.run(mappedQdrantKey, () => transport.handleRequest(c));
    } catch (e) {
        console.error("[knowledge-base-mcp] Error handling request:", e);
        return c.json({ error: "Internal server error" }, 500);
    }
});

knowledgeBaseMcpRoutes.get("/info", async (c) => {
    currentRequestApiKey = c.req.header("X-API-Key") || undefined;
    const baseAuth = await resolveBaseAuth();
    return c.json({
        name: "knowledge-base",
        version: "1.0.0",
        description: "Semantic search and document archival",
        status: baseAuth ? "ready" : "not_configured",
        configured: !!baseAuth,
        tools: ["list_collections", "search", "retrieve", "archive"],
        embeddingModel: baseAuth?.embeddingModel,
        note: baseAuth ? undefined : "Store QDRANT_URL and OPENAI_API_KEY in vault or set as environment variables"
    });
});
