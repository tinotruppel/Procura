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

function getDefaultAuth(): ImageGenerationAuth | null {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        return null;
    }

    return { apiKey };
}

// Create MCP server instance
const mcpServer = new McpServer({
    name: "image-generation",
    version: "1.0.0",
});

const auth = getDefaultAuth();

if (auth) {
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
            const aspectRatio = aspect_ratio || "1:1";
            const numImages = Math.min(4, Math.max(1, number_of_images || 1));

            const result = await generateImage(
                auth.apiKey,
                prompt,
                aspectRatio,
                numImages
            );

            if (result.images.length === 1) {
                // Single image - return as image content
                return {
                    content: [{
                        type: "image" as const,
                        data: result.images[0],
                        mimeType: result.mimeType,
                    }]
                };
            }

            // Multiple images - return all as separate image contents
            return {
                content: result.images.map((imageData, _index) => ({
                    type: "image" as const,
                    data: imageData,
                    mimeType: result.mimeType,
                }))
            };
        }
    );
}

// =============================================================================
// HTTP Routes with Hono MCP Transport
// =============================================================================

export const imageGenerationMcpRoutes = new Hono();

const transport = new StreamableHTTPTransport();

/**
 * MCP endpoint - handles all MCP communication
 */
imageGenerationMcpRoutes.all("/", async (c) => {
    if (!auth) {
        return c.json({
            error: "Image Generation MCP server not configured. Set GEMINI_API_KEY environment variable."
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
imageGenerationMcpRoutes.get("/info", async (c) => {
    return c.json({
        name: "image-generation",
        version: "1.0.0",
        status: auth ? "ready" : "not_configured",
        configured: !!auth,
        tools: auth ? ["generate_image"] : [],
        model: "imagen-4.0-generate-001",
        note: auth ? undefined : "Set GEMINI_API_KEY environment variable"
    });
});
