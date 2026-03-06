/**
 * Cron Routes
 * POST /cron/cleanup - Remove data for inactive keys
 */

import { Hono } from "hono";
import { getInactiveKeyIds, deleteUserData } from "../db/connection";
import { getConfig } from "../config";

export const cronRoutes = new Hono();

/**
 * POST /cron/cleanup
 * Deletes sync_objects, oauth_tokens, and vault_secrets for keys inactive
 * longer than CLEANUP_INACTIVE_DAYS (default 90).
 */
cronRoutes.post("/cleanup", async (c) => {
    const config = getConfig();
    const days = config.cleanupInactiveDays;
    const cutoffTimestamp = Date.now() - days * 24 * 60 * 60 * 1000;

    try {
        const inactiveKeyIds = await getInactiveKeyIds(cutoffTimestamp);

        const details: Array<{ keyId: string; syncDeleted: number; tokensDeleted: number; secretsDeleted: number }> = [];

        for (const keyId of inactiveKeyIds) {
            const result = await deleteUserData(keyId);
            details.push({ keyId, ...result });
        }

        console.log(
            `🧹 Cleanup: removed data for ${inactiveKeyIds.length} inactive key(s) (cutoff: ${days} days)`
        );

        return c.json({
            success: true,
            cutoffDays: days,
            keysCleanedUp: inactiveKeyIds.length,
            details,
        });
    } catch (error) {
        console.error("Cleanup error:", error);
        return c.json({ error: "Internal server error" }, 500);
    }
});
