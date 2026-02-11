/**
 * Timer Manager - Global singleton for managing scheduled timers across conversations
 * 
 * Timers survive conversation switches but are lost when the extension is closed.
 */

type TimerCallback = (chatId: string, message: string) => void;

interface ScheduledTimer {
    id: string;
    chatId: string;
    message: string;
    timerId: ReturnType<typeof setTimeout>;
    scheduledAt: number;
    fireAt: number;
}

// Global state - survives conversation switches
const activeTimers: Map<string, ScheduledTimer> = new Map();
const listeners: Set<TimerCallback> = new Set();

/**
 * Generate a unique timer ID
 */
function generateTimerId(): string {
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `timer_${Date.now()}_${hex}`;
}

/**
 * Subscribe to timer events
 */
export function onTimerFire(callback: TimerCallback): () => void {
    listeners.add(callback);
    return () => listeners.delete(callback);
}

/**
 * Schedule a message to be sent after a delay
 */
export function scheduleTimer(chatId: string, delaySeconds: number, message: string): string {
    const id = generateTimerId();
    const now = Date.now();

    const timerId = setTimeout(() => {
        // Remove from active timers
        activeTimers.delete(id);

        // Notify all listeners
        for (const listener of listeners) {
            try {
                listener(chatId, message);
            } catch (error) {
                console.error("[TimerManager] Listener error:", error);
            }
        }
    }, delaySeconds * 1000);

    const timer: ScheduledTimer = {
        id,
        chatId,
        message,
        timerId,
        scheduledAt: now,
        fireAt: now + delaySeconds * 1000,
    };

    activeTimers.set(id, timer);
    console.log(`[TimerManager] Scheduled timer ${id} for chat ${chatId} in ${delaySeconds}s`);

    return id;
}

/**
 * Cancel a scheduled timer
 */
export function cancelTimer(timerId: string): boolean {
    const timer = activeTimers.get(timerId);
    if (timer) {
        clearTimeout(timer.timerId);
        activeTimers.delete(timerId);
        console.log(`[TimerManager] Cancelled timer ${timerId}`);
        return true;
    }
    return false;
}

/**
 * Get all active timers (optionally filtered by chatId)
 */
export function getActiveTimers(chatId?: string): Array<{ id: string; chatId: string; message: string; fireAt: number }> {
    const timers = Array.from(activeTimers.values());
    const filtered = chatId ? timers.filter(t => t.chatId === chatId) : timers;
    return filtered.map(t => ({
        id: t.id,
        chatId: t.chatId,
        message: t.message,
        fireAt: t.fireAt,
    }));
}

/**
 * Cancel all timers for a specific chat
 */
export function cancelTimersForChat(chatId: string): number {
    let count = 0;
    for (const [id, timer] of activeTimers.entries()) {
        if (timer.chatId === chatId) {
            clearTimeout(timer.timerId);
            activeTimers.delete(id);
            count++;
        }
    }
    if (count > 0) {
        console.log(`[TimerManager] Cancelled ${count} timers for chat ${chatId}`);
    }
    return count;
}
