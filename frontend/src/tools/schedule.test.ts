import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { scheduleTool, cancelScheduleTool } from "./schedule";
import * as timerManager from "@/lib/timer-manager";

// Mock timer-manager to avoid real setTimeout interactions
vi.mock("@/lib/timer-manager", () => ({
    scheduleTimer: vi.fn(() => "timer_mock_123"),
    getActiveTimers: vi.fn(() => [{ id: "timer_mock_123", chatId: "chat-1", message: "test", fireAt: Date.now() + 5000 }]),
    cancelTimer: vi.fn(() => true),
}));

describe("schedule tool", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("scheduleTool", () => {
        it("should have correct metadata", () => {
            expect(scheduleTool.name).toBe("schedule");
            expect(scheduleTool.enabledByDefault).toBe(true);
            expect(scheduleTool.schema.parameters.required).toContain("delaySeconds");
            expect(scheduleTool.schema.parameters.required).toContain("message");
        });

        it("should schedule a timer successfully", async () => {
            const result = await scheduleTool.execute(
                { delaySeconds: 300, message: "check back" },
                {},
                { chatId: "chat-1" }
            );

            expect(result.success).toBe(true);
            expect(result.data).toBeDefined();
            expect(result.data.timerId).toBe("timer_mock_123");
            expect(result.data.message).toBe("check back");
            expect(result.data.activeTimersInChat).toBe(1);
            expect(timerManager.scheduleTimer).toHaveBeenCalledWith("chat-1", 300, "check back");
        });

        it("should trim the message", async () => {
            const result = await scheduleTool.execute(
                { delaySeconds: 10, message: "  spaced  " },
                {},
                { chatId: "chat-1" }
            );

            expect(result.success).toBe(true);
            expect(timerManager.scheduleTimer).toHaveBeenCalledWith("chat-1", 10, "spaced");
        });

        it("should reject delaySeconds < 1", async () => {
            const result = await scheduleTool.execute(
                { delaySeconds: 0, message: "too fast" },
                {},
                { chatId: "chat-1" }
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("delaySeconds");
        });

        it("should reject delaySeconds > 3600", async () => {
            const result = await scheduleTool.execute(
                { delaySeconds: 7200, message: "too slow" },
                {},
                { chatId: "chat-1" }
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("3600");
        });

        it("should reject non-number delaySeconds", async () => {
            const result = await scheduleTool.execute(
                { delaySeconds: "five", message: "bad type" },
                {},
                { chatId: "chat-1" }
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("delaySeconds");
        });

        it("should reject empty message", async () => {
            const result = await scheduleTool.execute(
                { delaySeconds: 10, message: "   " },
                {},
                { chatId: "chat-1" }
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("message");
        });

        it("should reject non-string message", async () => {
            const result = await scheduleTool.execute(
                { delaySeconds: 10, message: 42 },
                {},
                { chatId: "chat-1" }
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("message");
        });

        it("should fail without chatId in context", async () => {
            const result = await scheduleTool.execute(
                { delaySeconds: 10, message: "no context" },
                {},
                { promptId: "p1" }
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("chat context");
        });

        it("should fail without context at all", async () => {
            const result = await scheduleTool.execute(
                { delaySeconds: 10, message: "no context" },
                {}
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("chat context");
        });

        it("should handle execution errors gracefully", async () => {
            vi.mocked(timerManager.scheduleTimer).mockImplementationOnce(() => {
                throw new Error("internal failure");
            });

            const result = await scheduleTool.execute(
                { delaySeconds: 10, message: "will fail" },
                {},
                { chatId: "chat-1" }
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe("internal failure");
        });
    });

    describe("cancelScheduleTool", () => {
        it("should have correct metadata", () => {
            expect(cancelScheduleTool.name).toBe("cancel_schedule");
            expect(cancelScheduleTool.enabledByDefault).toBe(true);
            expect(cancelScheduleTool.schema.parameters.required).toContain("timerId");
        });

        it("should cancel a timer successfully", async () => {
            const result = await cancelScheduleTool.execute(
                { timerId: "timer_mock_123" },
                {}
            );

            expect(result.success).toBe(true);
            expect(result.data.cancelled).toBe(true);
            expect(result.data.message).toContain("cancelled successfully");
            expect(timerManager.cancelTimer).toHaveBeenCalledWith("timer_mock_123");
        });

        it("should handle timer not found", async () => {
            vi.mocked(timerManager.cancelTimer).mockReturnValueOnce(false);

            const result = await cancelScheduleTool.execute(
                { timerId: "nonexistent" },
                {}
            );

            expect(result.success).toBe(true);
            expect(result.data.cancelled).toBe(false);
            expect(result.data.message).toContain("not found");
        });

        it("should reject empty timerId", async () => {
            const result = await cancelScheduleTool.execute(
                { timerId: "   " },
                {}
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("timerId");
        });

        it("should reject non-string timerId", async () => {
            const result = await cancelScheduleTool.execute(
                { timerId: 123 },
                {}
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("timerId");
        });

        it("should trim timerId", async () => {
            await cancelScheduleTool.execute(
                { timerId: "  timer_mock_123  " },
                {}
            );

            expect(timerManager.cancelTimer).toHaveBeenCalledWith("timer_mock_123");
        });

        it("should handle execution errors gracefully", async () => {
            vi.mocked(timerManager.cancelTimer).mockImplementationOnce(() => {
                throw new Error("cancel failed");
            });

            const result = await cancelScheduleTool.execute(
                { timerId: "timer_mock_123" },
                {}
            );

            expect(result.success).toBe(false);
            expect(result.error).toBe("cancel failed");
        });
    });
});
