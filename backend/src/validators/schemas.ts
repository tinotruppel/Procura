/**
 * Validation Schemas
 * Zod schemas for input validation
 */

import { z } from "zod";

/**
 * userId: exactly 64 lowercase hex characters (SHA-256 hash)
 */
export const userIdSchema = z.string().regex(
    /^[a-f0-9]{64}$/,
    "userId must be a 64-character lowercase hex string (SHA-256 hash)"
);

/**
 * objectId: alphanumeric, hyphens, underscores, max 128 chars
 * Examples: "settings", "chat-550e8400-e29b-41d4-a716-446655440000"
 */
export const objectIdSchema = z.string().regex(
    /^[a-zA-Z0-9_-]{1,128}$/,
    "objectId must be 1-128 characters (alphanumeric, hyphens, underscores)"
);

/**
 * PUT request body for storing an object
 */
export const putObjectBodySchema = z.object({
    data: z.string().min(1, "data field is required"),
    lastModified: z.number().optional(),
});

/**
 * MCP proxy request body
 */
export const mcpProxyBodySchema = z.object({
    targetUrl: z.string().url("targetUrl must be a valid URL"),
    body: z.unknown(),
    headers: z.record(z.string()).optional(),
});

// Validation helper functions
export function validateUserId(userId: string): boolean {
    return userIdSchema.safeParse(userId).success;
}

export function validateObjectId(objectId: string): boolean {
    return objectIdSchema.safeParse(objectId).success;
}
