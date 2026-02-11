import { Tool, SchemaType, ToolContext } from "./types";
import { scheduleTimer, getActiveTimers, cancelTimer } from "@/lib/timer-manager";

export const scheduleTool: Tool = {
    name: "schedule",
    description: `Schedule a message to be sent to yourself after a delay. Use this when you need to:
- Retry an operation after a temporary failure
- Set a reminder for yourself
- Wait for an external process to complete
- Check back on something later

The message you provide will be injected into the conversation as if the user sent it, triggering a new response from you.

Note: Timers are lost if the extension is closed. Maximum delay is 1 hour.`,
    enabledByDefault: true,

    defaultConfig: {},

    schema: {
        name: "schedule",
        description: "Schedule a message to be sent to yourself after a delay",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                delaySeconds: {
                    type: SchemaType.NUMBER,
                    description: "Delay in seconds before the message is sent (1-3600, max 1 hour)",
                },
                message: {
                    type: SchemaType.STRING,
                    description: "The message to be sent. This will appear as a user message and trigger a new response from you.",
                },
            },
            required: ["delaySeconds", "message"],
        },
    },

    execute: async (args, _config, context?: ToolContext) => {
        try {
            const { delaySeconds, message } = args as { delaySeconds: number; message: string };

            // Validate delay
            if (typeof delaySeconds !== "number" || delaySeconds < 1 || delaySeconds > 3600) {
                return {
                    success: false,
                    error: "delaySeconds must be a number between 1 and 3600 (1 hour max)",
                };
            }

            // Validate message
            if (typeof message !== "string" || message.trim().length === 0) {
                return {
                    success: false,
                    error: "message must be a non-empty string",
                };
            }

            // Get chat ID from context
            const chatId = context?.chatId;
            if (!chatId) {
                return {
                    success: false,
                    error: "No active chat context. Cannot schedule timer.",
                };
            }

            // Schedule the timer
            const timerId = scheduleTimer(chatId, delaySeconds, message.trim());

            // Get active timers for this chat
            const activeTimers = getActiveTimers(chatId);

            return {
                success: true,
                data: {
                    timerId,
                    scheduledFor: new Date(Date.now() + delaySeconds * 1000).toISOString(),
                    message: message.trim(),
                    activeTimersInChat: activeTimers.length,
                    note: "Timer will fire even if you switch to a different conversation. Lost if extension is closed.",
                },
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : "Failed to schedule timer",
            };
        }
    },
};

export const cancelScheduleTool: Tool = {
    name: "cancel_schedule",
    description: "Cancel a previously scheduled timer by its ID.",
    enabledByDefault: true,

    defaultConfig: {},

    schema: {
        name: "cancel_schedule",
        description: "Cancel a scheduled timer",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                timerId: {
                    type: SchemaType.STRING,
                    description: "The timer ID returned when the timer was scheduled",
                },
            },
            required: ["timerId"],
        },
    },

    execute: async (args) => {
        try {
            const { timerId } = args as { timerId: string };

            if (typeof timerId !== "string" || timerId.trim().length === 0) {
                return {
                    success: false,
                    error: "timerId must be a non-empty string",
                };
            }

            const cancelled = cancelTimer(timerId.trim());

            return {
                success: true,
                data: {
                    cancelled,
                    timerId: timerId.trim(),
                    message: cancelled ? "Timer cancelled successfully" : "Timer not found (may have already fired)",
                },
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : "Failed to cancel timer",
            };
        }
    },
};
