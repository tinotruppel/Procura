/**
 * Image Generation MCP Server
 * Implements the Model Context Protocol for image generation via Google Imagen API
 * 
 * Endpoint: /mcp/image-generation
 * Transport: Streamable HTTP via @hono/mcp
 */

import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { z } from "zod";
import { GoogleGenAI } from "@google/genai";
import { resolveSecret } from "../lib/vault-resolver";

// =============================================================================
// Types
// =============================================================================

interface ImageGenerationAuth {
    apiKey: string;
}

// =============================================================================
// Image Generation Helpers
// =============================================================================

async function generateImage(
    apiKey: string,
    prompt: string,
    aspectRatio: string,
    numberOfImages: number
): Promise<{ images: string[]; mimeType: string }> {
    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateImages({
        model: "imagen-4.0-generate-001",
        prompt,
        config: {
            numberOfImages,
            aspectRatio: aspectRatio as "1:1" | "16:9" | "9:16" | "4:3" | "3:4",
        },
    });

    if (!response.generatedImages || response.generatedImages.length === 0) {
        throw new Error("No images generated");
    }

    const images: string[] = [];
    for (const generatedImage of response.generatedImages) {
        if (generatedImage.image?.imageBytes) {
            images.push(generatedImage.image.imageBytes);
        }
    }

    return {
        images,
        mimeType: "image/png",
    };
}

// =============================================================================
// MCP Server Setup
// =============================================================================

// Request-scoped API key (set per-request in the route handler)
let currentRequestApiKey: string | undefined;

/**
 * Resolve auth from vault (per-request) or process.env (fallback).
 */
async function resolveAuth(): Promise<ImageGenerationAuth | null> {
    const apiKey = await resolveSecret("GEMINI_API_KEY", currentRequestApiKey);
    if (!apiKey) return null;
    return { apiKey };
}

// Create MCP server instance — tools are always registered
const mcpServer = new McpServer({
    name: "image-generation",
    version: "1.0.0",
});

// --- generate_image ---
mcpServer.registerTool(
    "generate_image",
    {
        description: "Generate an image from a text prompt using Google Imagen AI",
        inputSchema: {
            prompt: z.string().describe("Text description of the image to generate. Be detailed and specific for best results."),
            aspect_ratio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]).optional().describe("Aspect ratio of the generated image. Default: 1:1 (square)"),
            number_of_images: z.number().min(1).max(4).optional().describe("Number of images to generate (1-4). Default: 1"),
        },
    },
    async ({ prompt, aspect_ratio, number_of_images }) => {
        const auth = await resolveAuth();
        if (!auth) {
            return {
                content: [{ type: "text" as const, text: JSON.stringify({ error: "GEMINI_API_KEY not configured. Store it via vault or set as environment variable." }, null, 2) }],
                isError: true
            };
        }

        const aspectRatio = aspect_ratio || "1:1";
        const numImages = Math.min(4, Math.max(1, number_of_images || 1));

        const result = await generateImage(
            auth.apiKey,
            prompt,
            aspectRatio,
            numImages
        );

        if (result.images.length === 1) {
            return {
                content: [{
                    type: "image" as const,
                    data: result.images[0],
                    mimeType: result.mimeType,
                }]
            };
        }

        return {
            content: result.images.map((imageData, _index) => ({
                type: "image" as const,
                data: imageData,
                mimeType: result.mimeType,
            }))
        };
    }
);

// =============================================================================
// HTTP Routes with Hono MCP Transport
// =============================================================================

export const imageGenerationMcpRoutes = new Hono();

const transport = new StreamableHTTPTransport();

/**
 * MCP endpoint - handles all MCP communication
 */
imageGenerationMcpRoutes.all("/", async (c) => {
    // Set request-scoped API key for vault resolution
    currentRequestApiKey = c.req.header("X-API-Key") || undefined;

    try {
        if (!mcpServer.isConnected()) {
            await mcpServer.connect(transport);
        }

        return transport.handleRequest(c);
    } catch (e) {
        console.error("[image-generation-mcp] Error handling request:", e);
        return c.json({ error: "Internal server error" }, 500);
    }
});

/**
 * Health/info endpoint
 */
imageGenerationMcpRoutes.get("/info", async (c) => {
    currentRequestApiKey = c.req.header("X-API-Key") || undefined;
    const auth = await resolveAuth();
    return c.json({
        name: "image-generation",
        version: "1.0.0",
        status: auth ? "ready" : "not_configured",
        configured: !!auth,
        tools: ["generate_image"],
        model: "imagen-4.0-generate-001",
        note: auth ? undefined : "Store GEMINI_API_KEY in vault or set as environment variable"
    });
});
