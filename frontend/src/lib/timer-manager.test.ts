import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    scheduleTimer,
    cancelTimer,
    getActiveTimers,
    cancelTimersForChat,
    onTimerFire,
} from "./timer-manager";

describe("timer-manager", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        // Cancel all timers from previous tests
        for (const t of getActiveTimers()) {
            cancelTimer(t.id);
        }
    });

    afterEach(() => {
        // Clean up all timers
        for (const t of getActiveTimers()) {
            cancelTimer(t.id);
        }
        vi.useRealTimers();
    });

    describe("scheduleTimer", () => {
        it("should return a unique timer ID", () => {
            const id = scheduleTimer("chat-1", 10, "hello");
            expect(id).toMatch(/^timer_\d+_[0-9a-f]{8}$/);
            cancelTimer(id);
        });

        it("should register the timer as active", () => {
            const id = scheduleTimer("chat-1", 60, "test msg");
            const active = getActiveTimers();
            expect(active).toHaveLength(1);
            expect(active[0].id).toBe(id);
            expect(active[0].chatId).toBe("chat-1");
            expect(active[0].message).toBe("test msg");
            cancelTimer(id);
        });

        it("should fire listener after the delay", () => {
            const listener = vi.fn();
            const unsub = onTimerFire(listener);

            scheduleTimer("chat-1", 5, "ping");
            expect(listener).not.toHaveBeenCalled();

            vi.advanceTimersByTime(5000);
            expect(listener).toHaveBeenCalledOnce();
            expect(listener).toHaveBeenCalledWith("chat-1", "ping");

            unsub();
        });

        it("should remove timer from active list after firing", () => {
            scheduleTimer("chat-1", 5, "ping");
            expect(getActiveTimers()).toHaveLength(1);

            vi.advanceTimersByTime(5000);
            expect(getActiveTimers()).toHaveLength(0);
        });

        it("should notify multiple listeners", () => {
            const listener1 = vi.fn();
            const listener2 = vi.fn();
            const unsub1 = onTimerFire(listener1);
            const unsub2 = onTimerFire(listener2);

            scheduleTimer("chat-1", 1, "multi");
            vi.advanceTimersByTime(1000);

            expect(listener1).toHaveBeenCalledOnce();
            expect(listener2).toHaveBeenCalledOnce();

            unsub1();
            unsub2();
        });

        it("should not crash if a listener throws", () => {
            const badListener = vi.fn(() => {
                throw new Error("boom");
            });
            const goodListener = vi.fn();
            const unsub1 = onTimerFire(badListener);
            const unsub2 = onTimerFire(goodListener);

            scheduleTimer("chat-1", 1, "err");
            vi.advanceTimersByTime(1000);

            expect(badListener).toHaveBeenCalledOnce();
            expect(goodListener).toHaveBeenCalledOnce();

            unsub1();
            unsub2();
        });
    });

    describe("cancelTimer", () => {
        it("should cancel a scheduled timer and return true", () => {
            const id = scheduleTimer("chat-1", 60, "will cancel");
            expect(cancelTimer(id)).toBe(true);
            expect(getActiveTimers()).toHaveLength(0);
        });

        it("should return false for unknown timer ID", () => {
            expect(cancelTimer("nonexistent")).toBe(false);
        });

        it("should prevent timer from firing", () => {
            const listener = vi.fn();
            const unsub = onTimerFire(listener);

            const id = scheduleTimer("chat-1", 5, "no fire");
            cancelTimer(id);
            vi.advanceTimersByTime(10_000);

            expect(listener).not.toHaveBeenCalled();
            unsub();
        });
    });

    describe("getActiveTimers", () => {
        it("should return empty array when no timers", () => {
            expect(getActiveTimers()).toEqual([]);
        });

        it("should filter by chatId when provided", () => {
            const id1 = scheduleTimer("chat-1", 60, "msg1");
            const id2 = scheduleTimer("chat-2", 60, "msg2");
            scheduleTimer("chat-1", 60, "msg3");

            const chat1Timers = getActiveTimers("chat-1");
            expect(chat1Timers).toHaveLength(2);

            const chat2Timers = getActiveTimers("chat-2");
            expect(chat2Timers).toHaveLength(1);
            expect(chat2Timers[0].id).toBe(id2);

            cancelTimer(id1);
            cancelTimer(id2);
            for (const t of getActiveTimers()) cancelTimer(t.id);
        });

        it("should return all timers when no chatId filter", () => {
            const id1 = scheduleTimer("a", 60, "m1");
            const id2 = scheduleTimer("b", 60, "m2");

            expect(getActiveTimers()).toHaveLength(2);

            cancelTimer(id1);
            cancelTimer(id2);
        });
    });

    describe("cancelTimersForChat", () => {
        it("should cancel all timers for a specific chat", () => {
            scheduleTimer("chat-1", 60, "a");
            scheduleTimer("chat-1", 60, "b");
            const keepId = scheduleTimer("chat-2", 60, "c");

            const cancelled = cancelTimersForChat("chat-1");
            expect(cancelled).toBe(2);
            expect(getActiveTimers()).toHaveLength(1);
            expect(getActiveTimers()[0].id).toBe(keepId);

            cancelTimer(keepId);
        });

        it("should return 0 if no timers for that chat", () => {
            expect(cancelTimersForChat("unknown")).toBe(0);
        });
    });

    describe("onTimerFire", () => {
        it("should return an unsubscribe function", () => {
            const listener = vi.fn();
            const unsub = onTimerFire(listener);

            unsub();

            scheduleTimer("chat-1", 1, "after unsub");
            vi.advanceTimersByTime(1000);

            expect(listener).not.toHaveBeenCalled();
        });
    });
});
