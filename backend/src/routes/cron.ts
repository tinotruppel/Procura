/**
 * Cron Routes
 * POST /cron/cleanup - Remove data for inactive users
 */

import { Hono } from "hono";
import { getInactiveUserIds, deleteUserData } from "../db/connection";
import { getConfig } from "../config";

export const cronRoutes = new Hono();

/**
 * POST /cron/cleanup
 * Deletes sync_objects and oauth_tokens for users inactive longer than
 * CLEANUP_INACTIVE_DAYS (default 90).
 */
cronRoutes.post("/cleanup", async (c) => {
    const config = getConfig();
    const days = config.cleanupInactiveDays;
    const cutoffTimestamp = Date.now() - days * 24 * 60 * 60 * 1000;

    try {
        const inactiveUserIds = await getInactiveUserIds(cutoffTimestamp);

        const details: Array<{ userId: string; syncDeleted: number; tokensDeleted: number }> = [];

        for (const userId of inactiveUserIds) {
            const result = await deleteUserData(userId);
            details.push({ userId, ...result });
        }

        console.log(
            `🧹 Cleanup: removed data for ${inactiveUserIds.length} inactive user(s) (cutoff: ${days} days)`
        );

        return c.json({
            success: true,
            cutoffDays: days,
            usersCleanedUp: inactiveUserIds.length,
            details,
        });
    } catch (error) {
        console.error("Cleanup error:", error);
        return c.json({ error: "Internal server error" }, 500);
    }
});
