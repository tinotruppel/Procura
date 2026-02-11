/**
 * Sync Routes
 * GET /sync/:userId - List all objects
 * GET /sync/:userId/:objectId - Get single object
 * PUT /sync/:userId/:objectId - Store object
 */

import { Hono } from "hono";
import { userIdSchema, objectIdSchema, putObjectBodySchema } from "../validators/schemas";
import { listObjects, getObject, upsertObject } from "../db/connection";
import { getConfig } from "../config";

export const syncRoutes = new Hono();

// Validate userId parameter
syncRoutes.use("/:userId/*", async (c, next) => {
    const userId = c.req.param("userId");
    const result = userIdSchema.safeParse(userId);

    if (!result.success) {
        return c.json(
            { error: "Invalid userId format. Expected 64-char hex string." },
            400
        );
    }

    await next();
});

// Validate objectId parameter if present
syncRoutes.use("/:userId/:objectId", async (c, next) => {
    const objectId = c.req.param("objectId");
    const result = objectIdSchema.safeParse(objectId);

    if (!result.success) {
        return c.json(
            { error: "Invalid objectId format. Use alphanumeric, hyphens, underscores (max 128 chars)." },
            400
        );
    }

    await next();
});

/**
 * GET /sync/:userId - List all objects with timestamps
 */
syncRoutes.get("/:userId", async (c) => {
    const userId = c.req.param("userId");

    try {
        const objects = await listObjects(userId);

        return c.json({
            success: true,
            objects: objects.map(row => ({
                objectId: row.object_id,
                lastModified: Number(row.last_modified),
                sizeBytes: Number(row.size_bytes),
            })),
        });
    } catch (error) {
        console.error("Error listing objects:", error);
        return c.json({ error: "Internal server error" }, 500);
    }
});

/**
 * GET /sync/:userId/:objectId - Get single object
 */
syncRoutes.get("/:userId/:objectId", async (c) => {
    const userId = c.req.param("userId");
    const objectId = c.req.param("objectId");

    try {
        const row = await getObject(userId, objectId);

        if (!row) {
            return c.json({ error: "Object not found" }, 404);
        }

        return c.json({
            success: true,
            objectId,
            data: row.encrypted_blob.toString("base64"),
            lastModified: Number(row.last_modified),
        });
    } catch (error) {
        console.error("Error getting object:", error);
        return c.json({ error: "Internal server error" }, 500);
    }
});

/**
 * PUT /sync/:userId/:objectId - Store object
 */
syncRoutes.put("/:userId/:objectId", async (c) => {
    const userId = c.req.param("userId");
    const objectId = c.req.param("objectId");
    const config = getConfig();

    try {
        const body = await c.req.json();
        const parseResult = putObjectBodySchema.safeParse(body);

        if (!parseResult.success) {
            return c.json(
                { error: parseResult.error.errors[0]?.message || "Invalid request body" },
                400
            );
        }

        const { data, lastModified } = parseResult.data;

        // Decode base64 data
        let encryptedBlob: Buffer;
        try {
            encryptedBlob = Buffer.from(data, "base64");
        } catch {
            return c.json({ error: "Invalid base64 data" }, 400);
        }

        // Check size limit
        if (encryptedBlob.length > config.maxBlobSize) {
            const maxMB = (config.maxBlobSize / 1024 / 1024).toFixed(0);
            return c.json(
                { error: `Data exceeds maximum size of ${maxMB}MB` },
                413
            );
        }

        // Get timestamp (milliseconds) or use current time
        const timestamp = lastModified ?? Date.now();

        // Upsert the object
        await upsertObject(userId, objectId, encryptedBlob, timestamp);

        return c.json({
            success: true,
            objectId,
            lastModified: timestamp,
        });
    } catch (error) {
        console.error("Error storing object:", error);
        return c.json({ error: "Internal server error" }, 500);
    }
});
