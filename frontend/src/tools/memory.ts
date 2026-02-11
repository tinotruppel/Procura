/**
 * Memory Tool
 * 
 * Allows AI agents to store and retrieve persistent memories across sessions.
 * Memories are organized by the current system prompt ID.
 */

import { Tool, SchemaType, ToolContext } from "./types";
import {
    getMemoryEntries,
    getMemoryEntry,
    setMemoryEntry,
    deleteMemoryEntry,
    clearAllMemory,
    getMemoryEntryCount,
} from "@/lib/memory-store";

export const memoryTool: Tool = {
    name: "memory",
    description: "Store and retrieve persistent memories across chat sessions. Use this to remember important information about the user, their preferences, or context that should persist. Memories are organized by your prompt/persona.",
    enabledByDefault: true,

    defaultConfig: {},

    // Custom action for clearing all memories - shown in tool settings
    customAction: {
        label: "Clear All",
        variant: "destructive",
        getDescription: async () => {
            const count = await getMemoryEntryCount();
            if (count === 0) {
                return "No memories stored";
            }
            const entriesLabel = count === 1 ? 'entry' : 'entries';
            return `${count} ${entriesLabel} stored`;
        },
        confirmMessage: async () => {
            const count = await getMemoryEntryCount();
            return `Are you sure you want to delete all ${count} memory entries? This cannot be undone.`;
        },
        action: async () => {
            try {
                await clearAllMemory();
                return { success: true, message: "All memories cleared" };
            } catch (error) {
                return {
                    success: false,
                    message: error instanceof Error ? error.message : "Failed to clear memories",
                };
            }
        },
    },

    schema: {
        name: "memory",
        description: "Manage persistent memories that survive across chat sessions",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                action: {
                    type: SchemaType.STRING,
                    description: "The action to perform: 'write' to store a memory, 'read' to retrieve a specific memory, 'delete' to remove a memory, 'list' to see all stored memories",
                },
                key: {
                    type: SchemaType.STRING,
                    description: "A unique identifier for the memory (e.g., 'user_name', 'favorite_color', 'project_context'). Required for write, read, and delete actions.",
                },
                value: {
                    type: SchemaType.STRING,
                    description: "The value to store. Required for write action.",
                },
            },
            required: ["action"],
        },
    },

    execute: async (args, _config, context?: ToolContext) => {
        try {
            const action = (args.action as string)?.toLowerCase();
            const key = args.key as string | undefined;
            const value = args.value as string | undefined;

            // Get the prompt ID from context, falling back to "default"
            const promptId = context?.promptId || "default";

            switch (action) {
                case "write": {
                    if (!key) {
                        return {
                            success: false,
                            error: "Missing required 'key' parameter for write action",
                        };
                    }
                    if (value === undefined) {
                        return {
                            success: false,
                            error: "Missing required 'value' parameter for write action",
                        };
                    }

                    await setMemoryEntry(promptId, key, value);
                    return {
                        success: true,
                        data: {
                            action: "write",
                            key,
                            message: `Memory '${key}' stored successfully`,
                        },
                    };
                }

                case "read": {
                    if (!key) {
                        return {
                            success: false,
                            error: "Missing required 'key' parameter for read action",
                        };
                    }

                    const entry = await getMemoryEntry(promptId, key);
                    if (!entry) {
                        return {
                            success: true,
                            data: {
                                action: "read",
                                key,
                                found: false,
                                message: `No memory found with key '${key}'`,
                            },
                        };
                    }

                    return {
                        success: true,
                        data: {
                            action: "read",
                            key,
                            found: true,
                            value: entry.value,
                            createdAt: new Date(entry.createdAt).toISOString(),
                            updatedAt: new Date(entry.updatedAt).toISOString(),
                        },
                    };
                }

                case "delete": {
                    if (!key) {
                        return {
                            success: false,
                            error: "Missing required 'key' parameter for delete action",
                        };
                    }

                    const deleted = await deleteMemoryEntry(promptId, key);
                    return {
                        success: true,
                        data: {
                            action: "delete",
                            key,
                            deleted,
                            message: deleted
                                ? `Memory '${key}' deleted successfully`
                                : `No memory found with key '${key}'`,
                        },
                    };
                }

                case "list": {
                    const entries = await getMemoryEntries(promptId);
                    // Sort by updatedAt ascending (oldest first, newest last = freshest in LLM context)
                    const sortedEntries = [...entries].sort((a, b) => a.updatedAt - b.updatedAt);
                    return {
                        success: true,
                        data: {
                            action: "list",
                            count: sortedEntries.length,
                            memories: sortedEntries.map(e => ({
                                key: e.key,
                                value: e.value.length > 100
                                    ? e.value.substring(0, 100) + "..."
                                    : e.value,
                                updatedAt: new Date(e.updatedAt).toISOString(),
                            })),
                        },
                    };
                }

                default:
                    return {
                        success: false,
                        error: `Unknown action '${action}'. Valid actions are: write, read, delete, list`,
                    };
            }
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : "Memory operation failed",
            };
        }
    },
};
