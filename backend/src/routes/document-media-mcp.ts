/**
 * Document & Media MCP Server
 * Implements the Model Context Protocol for document OCR and audio transcription
 *
 * Endpoint: /mcp/document-media
 * Transport: Streamable HTTP via @hono/mcp
 *
 * Features:
 * - transcribe_audio: Convert speech to text from audio files
 * - analyze_document: OCR and analysis for PDFs and images
 *
 * Internally powered by Mistral AI (Voxtral, Pixtral, OCR)
 */

import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { z } from "zod";
import { resolveSecret } from "../lib/vault-resolver";

// =============================================================================
// Types
// =============================================================================

interface DocumentMediaAuth {
    apiKey: string;
}

interface TranscriptionResponse {
    text: string;
    language?: string;
    segments?: Array<{
        text: string;
        start: number;
        end: number;
    }>;
}

interface ChatCompletionResponse {
    choices: Array<{
        message: {
            content: string;
        };
    }>;
}

interface FileUploadResponse {
    id: string;
    filename: string;
}

interface SignedUrlResponse {
    url: string;
}

interface OcrResponse {
    pages: Array<{
        markdown?: string;
        text?: string;
    }>;
    text?: string;
}

// =============================================================================
// Constants
// =============================================================================

const MISTRAL_API_BASE = "https://api.mistral.ai/v1";

// =============================================================================
// Helpers
// =============================================================================

/**
 * Sanitize filename for API requests.
 * Replaces problematic characters (parentheses, brackets, etc.) that can cause
 * Content-Disposition header issues in multipart/form-data requests.
 */
function sanitizeFileName(fileName: string): string {
    // Extract extension
    const lastDot = fileName.lastIndexOf(".");
    const ext = lastDot > 0 ? fileName.slice(lastDot) : "";
    const baseName = lastDot > 0 ? fileName.slice(0, lastDot) : fileName;

    // Replace problematic characters with underscores
    // eslint-disable-next-line no-useless-escape -- \[ needed inside character class
    const sanitized = baseName.replace(/[()\[\]{}<>"'`;,&|\\]/g, "_");

    return sanitized + ext;
}

/**
 * Upload file to Mistral Files API
 */
async function uploadFile(
    apiKey: string,
    base64Data: string,
    mimeType: string,
    fileName: string,
    purpose: "ocr" | "batch" = "ocr"
): Promise<string> {
    // Convert base64 to binary
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mimeType });

    const formData = new FormData();
    formData.append("purpose", purpose);
    formData.append("file", blob, sanitizeFileName(fileName));

    const response = await fetch(`${MISTRAL_API_BASE}/files`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
        },
        body: formData,
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`File upload failed: ${response.status} ${errorText}`);
    }

    const result = await response.json() as FileUploadResponse;
    return result.id;
}

/**
 * Get signed URL for uploaded file
 */
async function getSignedUrl(apiKey: string, fileId: string): Promise<string> {
    const response = await fetch(`${MISTRAL_API_BASE}/files/${fileId}/url?expiry=24`, {
        method: "GET",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Accept": "application/json",
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get signed URL: ${response.status} ${errorText}`);
    }

    const result = await response.json() as SignedUrlResponse;
    return result.url;
}

/**
 * Perform OCR on document via signed URL
 */
async function performOcr(apiKey: string, signedUrl: string): Promise<string> {
    const response = await fetch(`${MISTRAL_API_BASE}/ocr`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: "mistral-ocr-latest",
            document: {
                type: "document_url",
                document_url: signedUrl,
            },
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OCR failed: ${response.status} ${errorText}`);
    }

    const result = await response.json() as OcrResponse;

    // Extract markdown from pages
    if (result.pages && result.pages.length > 0) {
        return result.pages
            .map(page => page.markdown || page.text || "")
            .filter(text => text.trim())
            .join("\n\n---\n\n");
    }

    return result.text || "";
}

/**
 * Analyze image using Pixtral
 */
async function analyzeImage(
    apiKey: string,
    dataUrl: string,
    question?: string
): Promise<string> {
    const messages = [
        {
            role: "user",
            content: [
                {
                    type: "image_url",
                    image_url: { url: dataUrl },
                },
                {
                    type: "text",
                    text: question || "Describe this image in detail. Extract all text you can see.",
                },
            ],
        },
    ];

    const response = await fetch(`${MISTRAL_API_BASE}/chat/completions`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: "pixtral-large-latest",
            messages,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Image analysis failed: ${response.status} ${errorText}`);
    }

    const result = await response.json() as ChatCompletionResponse;
    return result.choices?.[0]?.message?.content || "";
}

/**
 * Answer a question based on text
 */
async function answerQuestion(
    apiKey: string,
    ocrText: string,
    question: string
): Promise<string> {
    const messages = [
        {
            role: "user",
            content: `Based on the following document content, please answer this question: ${question}\n\n---\n\nDocument content:\n${ocrText}`,
        },
    ];

    const response = await fetch(`${MISTRAL_API_BASE}/chat/completions`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: "mistral-large-latest",
            messages,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Question answering failed: ${response.status} ${errorText}`);
    }

    const result = await response.json() as ChatCompletionResponse;
    return result.choices?.[0]?.message?.content || "";
}

// =============================================================================
// MCP Server Setup
// =============================================================================

// Request-scoped API key (set per-request in the route handler)
let currentRequestApiKey: string | undefined;

/**
 * Resolve auth from vault (per-request) or process.env (fallback).
 */
async function resolveAuth(): Promise<DocumentMediaAuth | null> {
    const apiKey = await resolveSecret("MISTRAL_API_KEY", currentRequestApiKey);
    if (!apiKey) return null;
    return { apiKey };
}

const mcpServer = new McpServer({
    name: "document-media",
    version: "1.0.0",
});

// --- transcribe_audio ---
mcpServer.registerTool(
        "transcribe_audio",
        {
            description: "Transcribe speech from audio files to text. Supports various audio formats (mp3, wav, m4a, webm, etc.)",
            inputSchema: {
                fileData: z.string().describe("Base64-encoded audio file data (without data URL prefix)"),
                fileName: z.string().describe("Original filename including extension"),
                mimeType: z.string().describe("MIME type of the audio file (e.g. audio/mp3, audio/wav)"),
                language: z.string().optional().describe("Language hint (e.g. 'en', 'de') - optional but improves accuracy"),
            },
        },
        async ({ fileData, fileName, mimeType, language }) => {
            const auth = await resolveAuth();
            if (!auth) {
                return {
                    content: [{ type: "text" as const, text: JSON.stringify({ error: "MISTRAL_API_KEY not configured. Store it via vault or set as environment variable." }, null, 2) }],
                    isError: true
                };
            }

            // Validate audio file type
            if (!mimeType.startsWith("audio/")) {
                return {
                    content: [{
                        type: "text" as const,
                        text: JSON.stringify({ error: `Expected audio file, got ${mimeType}` }, null, 2)
                    }],
                    isError: true
                };
            }

            // Convert base64 to binary
            const binaryString = atob(fileData);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            const blob = new Blob([bytes], { type: mimeType });

            // Create form data for transcription
            const formData = new FormData();
            formData.append("file", blob, sanitizeFileName(fileName));
            formData.append("model", "voxtral-mini-latest");
            if (language) {
                formData.append("language", language);
            }

            const response = await fetch(`${MISTRAL_API_BASE}/audio/transcriptions`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${auth.apiKey}`,
                },
                body: formData,
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Transcription failed: ${response.status} ${errorText}`);
            }

            const result = await response.json() as TranscriptionResponse;

            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        text: result.text,
                        language: result.language,
                        segments: result.segments,
                        fileName,
                    }, null, 2)
                }]
            };
        }
    );

// --- analyze_document ---
mcpServer.registerTool(
    "analyze_document",
    {
        description: "Extract and analyze content from PDFs and images using OCR. Can also answer questions about the document.",
        inputSchema: {
            fileData: z.string().describe("Base64-encoded file data (without data URL prefix)"),
            fileName: z.string().describe("Original filename including extension"),
            mimeType: z.string().describe("MIME type (e.g. application/pdf, image/png, image/jpeg)"),
            question: z.string().optional().describe("Question to answer about the document. If omitted, returns raw OCR text."),
        },
    },
    async ({ fileData, fileName, mimeType, question }) => {
        const auth = await resolveAuth();
        if (!auth) {
            return {
                content: [{ type: "text" as const, text: JSON.stringify({ error: "MISTRAL_API_KEY not configured. Store it via vault or set as environment variable." }, null, 2) }],
                isError: true
            };
        }

        const isImage = mimeType.startsWith("image/");
        const isPdf = mimeType === "application/pdf";

        if (!isImage && !isPdf) {
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        error: `File type not supported. Expected image/* or application/pdf, got ${mimeType}`
                    }, null, 2)
                }],
                isError: true
            };
        }

        // For images, use Pixtral directly with data URL
        if (isImage) {
            const dataUrl = `data:${mimeType};base64,${fileData}`;
            const answer = await analyzeImage(auth.apiKey, dataUrl, question);

            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        content: answer,
                        question: question || "(image description)",
                        fileName,
                    }, null, 2)
                }]
            };
        }

        // For PDFs, use OCR API (upload → signed URL → OCR)
        const fileId = await uploadFile(auth.apiKey, fileData, mimeType, fileName, "ocr");
        const signedUrl = await getSignedUrl(auth.apiKey, fileId);
        const ocrText = await performOcr(auth.apiKey, signedUrl);

        if (question) {
            const answer = await answerQuestion(auth.apiKey, ocrText, question);

            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        answer,
                        question,
                        ocrTextLength: ocrText.length,
                        fileName,
                    }, null, 2)
                }]
            };
        }

        return {
            content: [{
                type: "text" as const,
                text: JSON.stringify({
                    content: ocrText,
                    fileName,
                    message: "OCR extraction complete. The document content is in the 'content' field.",
                }, null, 2)
            }]
        };
    }
);

// =============================================================================
// HTTP Routes
// =============================================================================

export const documentMediaMcpRoutes = new Hono();

const transport = new StreamableHTTPTransport();

documentMediaMcpRoutes.all("/", async (c) => {
    currentRequestApiKey = c.req.header("X-API-Key") || undefined;

    try {
        if (!mcpServer.isConnected()) {
            await mcpServer.connect(transport);
        }

        return transport.handleRequest(c);
    } catch (e) {
        console.error("[document-media-mcp] Error handling request:", e);
        return c.json({ error: "Internal server error" }, 500);
    }
});

documentMediaMcpRoutes.get("/info", async (c) => {
    currentRequestApiKey = c.req.header("X-API-Key") || undefined;
    const auth = await resolveAuth();
    return c.json({
        name: "document-media",
        version: "1.0.0",
        description: "Document OCR and audio transcription",
        status: auth ? "ready" : "not_configured",
        configured: !!auth,
        tools: ["transcribe_audio", "analyze_document"],
        note: auth ? undefined : "Store MISTRAL_API_KEY in vault or set as environment variable"
    });
});
