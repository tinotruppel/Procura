import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import { cronRoutes } from "./cron";

// Mock the DB functions
vi.mock("../db/connection", () => ({
    getInactiveUserIds: vi.fn(),
    deleteUserData: vi.fn(),
}));

import { getInactiveUserIds, deleteUserData } from "../db/connection";

const mockedGetInactive = vi.mocked(getInactiveUserIds);
const mockedDeleteUser = vi.mocked(deleteUserData);

const app = new Hono();
app.route("/cron", cronRoutes);

describe("Cron Cleanup Route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedGetInactive.mockResolvedValue([]);
        mockedDeleteUser.mockResolvedValue({ syncDeleted: 0, tokensDeleted: 0 });
    });

    it("should return 0 users when none are inactive", async () => {
        const res = await app.request("/cron/cleanup", { method: "POST" });
        expect(res.status).toBe(200);

        const body = await res.json() as { success: boolean; usersCleanedUp: number };
        expect(body.success).toBe(true);
        expect(body.usersCleanedUp).toBe(0);
        expect(mockedGetInactive).toHaveBeenCalledOnce();
        expect(mockedDeleteUser).not.toHaveBeenCalled();
    });

    it("should clean up inactive users and return details", async () => {
        mockedGetInactive.mockResolvedValue(["user-a", "user-b"]);
        mockedDeleteUser
            .mockResolvedValueOnce({ syncDeleted: 3, tokensDeleted: 1 })
            .mockResolvedValueOnce({ syncDeleted: 1, tokensDeleted: 0 });

        const res = await app.request("/cron/cleanup", { method: "POST" });
        expect(res.status).toBe(200);

        const body = await res.json() as {
            success: boolean;
            usersCleanedUp: number;
            cutoffDays: number;
            details: Array<{ userId: string; syncDeleted: number; tokensDeleted: number }>;
        };

        expect(body.success).toBe(true);
        expect(body.usersCleanedUp).toBe(2);
        expect(body.cutoffDays).toBe(90);
        expect(body.details).toEqual([
            { userId: "user-a", syncDeleted: 3, tokensDeleted: 1 },
            { userId: "user-b", syncDeleted: 1, tokensDeleted: 0 },
        ]);
    });

    it("should pass correct cutoff timestamp to getInactiveUserIds", async () => {
        const before = Date.now() - 90 * 24 * 60 * 60 * 1000;

        await app.request("/cron/cleanup", { method: "POST" });

        const after = Date.now() - 90 * 24 * 60 * 60 * 1000;
        const calledWith = mockedGetInactive.mock.calls[0]?.[0] as number;

        expect(calledWith).toBeGreaterThanOrEqual(before);
        expect(calledWith).toBeLessThanOrEqual(after);
    });

    it("should include cutoffDays in response", async () => {
        const res = await app.request("/cron/cleanup", { method: "POST" });
        const body = await res.json() as { cutoffDays: number };

        expect(body.cutoffDays).toBe(90);
    });

    it("should return 500 on database error", async () => {
        mockedGetInactive.mockRejectedValueOnce(new Error("DB connection failed"));

        const res = await app.request("/cron/cleanup", { method: "POST" });
        expect(res.status).toBe(500);

        const body = await res.json() as { error: string };
        expect(body.error).toBe("Internal server error");
    });

    it("should return 500 when deleteUserData fails", async () => {
        mockedGetInactive.mockResolvedValue(["user-fail"]);
        mockedDeleteUser.mockRejectedValueOnce(new Error("Delete failed"));

        const res = await app.request("/cron/cleanup", { method: "POST" });
        expect(res.status).toBe(500);
    });

    it("should only respond to POST requests", async () => {
        const get = await app.request("/cron/cleanup", { method: "GET" });
        expect(get.status).toBe(404);

        const put = await app.request("/cron/cleanup", { method: "PUT" });
        expect(put.status).toBe(404);
    });
});
