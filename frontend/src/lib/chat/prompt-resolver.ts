import { fetchLangfusePrompt, replacePromptVariables } from "@/lib/langfuse";
import {
    getActiveSystemPrompt,
    getLangfuseConfig,
    getPromptVariables,
    getToolConfigs,
    SystemPrompt,
} from "@/lib/storage";
import { getMemoryEntries } from "@/lib/memory-store";
import { getTool } from "@/tools";

export interface ResolvedPrompt {
    systemPrompt?: string;
    systemPromptName?: string;
    systemPromptVersion?: number;
    systemPromptSource?: "local" | "langfuse";
    missingVariables: string[];
    promptIdUsed?: string | null;
    injectedMemoryCount?: number;
}

interface ResolvePromptInput {
    selectedPromptId?: string | null;
    systemPrompts: SystemPrompt[];
    promptIdOverride?: string;
}

/**
 * Check if memory tool is enabled and inject memories into prompt
 * Returns the injection text and count of memories
 */
async function getMemoryInjection(promptId: string): Promise<{ text: string; count: number }> {
    // Check if memory tool is enabled
    const memoryTool = getTool("memory");
    if (!memoryTool) return { text: "", count: 0 };

    const toolConfigs = await getToolConfigs();
    const memoryConfig = toolConfigs["memory"];
    const isEnabled = memoryConfig?.enabled ?? memoryTool.enabledByDefault;
    if (!isEnabled) return { text: "", count: 0 };

    // Get memories for this prompt
    const entries = await getMemoryEntries(promptId);
    if (entries.length === 0) return { text: "", count: 0 };

    // Sort by updatedAt ascending (oldest first, newest last = freshest in context)
    const sortedEntries = [...entries].sort((a, b) => a.updatedAt - b.updatedAt);

    // Build memory section
    let section = "\n\n## Your Stored Memories\n";
    section += "The following information was stored from previous conversations with this user:\n\n";
    for (const m of sortedEntries) {
        const date = new Date(m.updatedAt).toLocaleDateString();
        section += `- **${m.key}**: ${m.value} _(${date})_\n`;
    }

    return { text: section, count: entries.length };
}

export async function resolveSystemPrompt({
    selectedPromptId,
    systemPrompts,
    promptIdOverride,
}: ResolvePromptInput): Promise<ResolvedPrompt> {
    const promptIdUsed = promptIdOverride ?? selectedPromptId ?? null;
    if (!promptIdUsed) {
        return { missingVariables: [], promptIdUsed: null };
    }

    if (promptIdUsed.startsWith("langfuse_")) {
        const promptName = promptIdUsed.replace("langfuse_", "");
        try {
            const langfuseConfig = await getLangfuseConfig();
            const fetchedPrompt = await fetchLangfusePrompt(langfuseConfig, promptName);
            const promptVariables = await getPromptVariables();
            const { result, missing } = replacePromptVariables(fetchedPrompt.content, promptVariables);

            // Inject memories
            const { text: memoryText, count: memoryCount } = await getMemoryInjection(promptIdUsed);

            return {
                systemPrompt: result + memoryText,
                systemPromptName: fetchedPrompt.name,
                systemPromptVersion: fetchedPrompt.version,
                systemPromptSource: "langfuse",
                missingVariables: missing,
                promptIdUsed,
                injectedMemoryCount: memoryCount,
            };
        } catch (error) {
            console.error("Failed to fetch Langfuse prompt:", error);
            return { missingVariables: [], promptIdUsed };
        }
    }

    const systemPrompt = await getActiveSystemPrompt();
    let systemPromptName: string | undefined;
    if (systemPrompt) {
        const localPrompt = systemPrompts.find((prompt) => prompt.id === promptIdUsed);
        systemPromptName = localPrompt?.title;
    }

    // Inject memories
    const { text: memoryText, count: memoryCount } = await getMemoryInjection(promptIdUsed);

    return {
        systemPrompt: systemPrompt ? systemPrompt + memoryText : undefined,
        systemPromptName,
        systemPromptSource: systemPrompt ? "local" : undefined,
        missingVariables: [],
        promptIdUsed,
        injectedMemoryCount: memoryCount,
    };
}
