import { Tool, SchemaType } from "./types";
import { getLangfuseConfig } from "@/lib/storage";
import { fetchLangfusePrompt, updateLangfusePrompt } from "@/lib/langfuse";

export const langfusePromptTool: Tool = {
    name: "langfuse_prompt_editor",
    description: "Read or update your own system prompt. Use 'get' to see the exact text of your current instructions, or 'update' to overwrite them with new text. Changes take effect on the next conversation. Only works when your system prompt is managed remotely.",
    enabledByDefault: true,

    defaultConfig: {},

    schema: {
        name: "langfuse_prompt_editor",
        description: "Read or update your own system prompt. Use 'get' to retrieve your current instructions, or 'update' to overwrite them.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                action: {
                    type: SchemaType.STRING,
                    description: "The action to perform: 'get' to read your current system prompt, 'update' to overwrite it with new text.",
                    format: "enum",
                    enum: ["get", "update"],
                },
                prompt_text: {
                    type: SchemaType.STRING,
                    description: "The new system prompt text (required for 'update'). This will completely replace your current instructions.",
                },
            },
            required: ["action"],
        },
    },

    execute: async (args, _config, context) => {
        try {
            const config = await getLangfuseConfig();

            if (!config.enabled || !config.publicKey || !config.secretKey) {
                return {
                    success: false,
                    error: "Langfuse integration is not configured or enabled in settings.",
                };
            }

            // Resolve prompt name from context
            const promptId = context?.promptId;
            if (!promptId || !promptId.startsWith("langfuse_")) {
                return {
                    success: false,
                    error: "Your current system prompt is not managed remotely (Langfuse). This tool can only read/update remote prompts.",
                };
            }
            const promptName = promptId.replace("langfuse_", "");

            const action = args.action as "get" | "update";

            if (action === "get") {
                const promptData = await fetchLangfusePrompt(config, promptName, "production");
                return {
                    success: true,
                    data: {
                        name: promptData.name,
                        version: promptData.version,
                        content: promptData.content,
                        message: `This is your current system prompt (version ${promptData.version}).`,
                    },
                };
            }

            if (action === "update") {
                const prompt_text = args.prompt_text as string;

                if (!prompt_text) {
                    return {
                        success: false,
                        error: "The 'prompt_text' parameter is required for the 'update' action.",
                    };
                }

                // Fetch current prompt to detect its type and tags
                let promptType: "chat" | "text" = "chat";
                let existingTags: string[] = [];
                try {
                    const baseHost = config.host.endsWith("/") ? config.host.slice(0, -1) : config.host;
                    const authHeader = `Basic ${btoa(`${config.publicKey}:${config.secretKey}`)}`;
                    const raw = await fetch(
                        `${baseHost}/api/public/v2/prompts/${encodeURIComponent(promptName)}?label=production`,
                        { headers: { "Authorization": authHeader } }
                    );
                    if (raw.ok) {
                        const data = await raw.json();
                        promptType = data.type === "text" ? "text" : "chat";
                        existingTags = Array.isArray(data.tags) ? data.tags : [];
                    }
                } catch {
                    // default to chat, no tags
                }

                // Format prompt payload based on type
                let parsedPrompt: string | Array<{ role: string; content: string }>;
                if (promptType === "chat") {
                    // Chat prompts require a messages array
                    try {
                        const maybeJson = JSON.parse(prompt_text);
                        if (Array.isArray(maybeJson)) {
                            parsedPrompt = maybeJson;
                        } else {
                            parsedPrompt = [{ role: "system", content: prompt_text }];
                        }
                    } catch {
                        parsedPrompt = [{ role: "system", content: prompt_text }];
                    }
                } else {
                    parsedPrompt = prompt_text;
                }

                const result = await updateLangfusePrompt(config, promptName, parsedPrompt, promptType, existingTags);

                if (!result.success) {
                    return {
                        success: false,
                        error: result.error || "Failed to update system prompt.",
                    };
                }

                return {
                    success: true,
                    data: {
                        name: promptName,
                        version: result.version,
                        message: `Your system prompt has been updated (new version ${result.version}). The change will take effect on the next conversation.`,
                    },
                };
            }

            return {
                success: false,
                error: `Unknown action: ${action}`,
            };

        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : "Failed to execute prompt editor tool",
            };
        }
    },
};
