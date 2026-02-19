import { useState, useEffect, useCallback } from "react";
import { DebugEvent } from "@/lib/llm-types";
import {
    getSystemPrompts,
    getLangfuseConfig,
    LangfuseConfig,
    SystemPrompt,
} from "@/lib/storage";
import { fetchLangfusePromptList, sendLangfuseBatch, LangfuseSpanInput } from "@/lib/langfuse";

function matchesTags(promptTags: string[] | undefined, filterTags: string[]): boolean {
    return promptTags?.some(t => filterTags.includes(t)) ?? false;
}

export interface SendTraceParams {
    traceId: string;
    generationId: string;
    chatId: string | null;
    responseText: string;
    model: string;
    startTime: Date;
    debugEvents?: DebugEvent[];
    systemPromptName?: string;
    systemPromptVersion?: number;
    systemPromptSource?: string;
    traceName: string;
    traceInput: unknown;
    traceMetadata?: Record<string, unknown>;
    generationInput: unknown;
    generationMetadata?: Record<string, unknown>;
    includeToolSpans?: boolean;
}

export function useLangfuseTracing(messagesLength: number) {
    const [langfuseConfig, setLangfuseConfig] = useState<LangfuseConfig | undefined>(undefined);
    const [remotePrompts, setRemotePrompts] = useState<{ name: string }[]>([]);
    const [systemPrompts, setSystemPrompts] = useState<SystemPrompt[]>([]);

    useEffect(() => {
        async function loadPrompts() {
            const prompts = await getSystemPrompts();
            setSystemPrompts(prompts);

            try {
                const config = await getLangfuseConfig();
                setLangfuseConfig(config);
                if (config.enabled && config.publicKey && config.secretKey) {
                    const remote = await fetchLangfusePromptList(config);
                    const tags = config.tags?.filter(t => t.length > 0) ?? [];
                    const filtered = tags.length > 0
                        ? remote.filter(p => matchesTags(p.tags, tags))
                        : remote;
                    setRemotePrompts(filtered.map(p => ({ name: p.name })));
                } else {
                    setRemotePrompts([]);
                }
            } catch (err) {
                console.error("Failed to load Langfuse prompts:", err);
                setRemotePrompts([]);
            }
        }
        if (messagesLength === 0) { loadPrompts(); }
    }, [messagesLength]);

    const sendTrace = useCallback(async (params: SendTraceParams) => {
        try {
            const config = await getLangfuseConfig();
            if (!config.enabled) return;

            const llmEvents = params.debugEvents?.filter(e => e.type === "llm") || [];
            const totalUsage = llmEvents.reduce((acc, e) => {
                if (e.type === "llm") {
                    return {
                        input: (acc.input || 0) + (e.info.inputTokens || 0),
                        output: (acc.output || 0) + (e.info.outputTokens || 0),
                        total: (acc.total || 0) + (e.info.totalTokens || 0),
                    };
                }
                return acc;
            }, { input: 0, output: 0, total: 0 });

            let spans: LangfuseSpanInput[] | undefined;
            if (params.includeToolSpans) {
                const toolEvents = params.debugEvents?.filter(e => e.type === "tool") || [];
                const built = toolEvents.filter(e => e.type === "tool").map(event => {
                    const toolEvent = event as DebugEvent & { type: "tool" };
                    return {
                        id: toolEvent.info.observationId || crypto.randomUUID(),
                        traceId: params.traceId,
                        name: `tool:${toolEvent.info.name}`,
                        input: toolEvent.info.args,
                        output: toolEvent.info.result,
                        metadata: { toolName: toolEvent.info.name, success: toolEvent.info.result?.success },
                        level: toolEvent.info.result?.success === false ? "ERROR" as const : "DEFAULT" as const,
                    };
                });
                if (built.length > 0) spans = built;
            }

            await sendLangfuseBatch(config, {
                trace: {
                    id: params.traceId,
                    name: params.traceName,
                    sessionId: params.chatId || undefined,
                    input: params.traceInput,
                    output: params.responseText,
                    metadata: params.traceMetadata,
                },
                generation: {
                    id: params.generationId,
                    traceId: params.traceId,
                    name: "llm-generation",
                    model: params.model,
                    input: params.generationInput,
                    output: params.responseText,
                    startTime: params.startTime,
                    endTime: new Date(),
                    usage: totalUsage.total > 0 ? totalUsage : undefined,
                    promptName: params.systemPromptSource === "langfuse" ? params.systemPromptName : undefined,
                    promptVersion: params.systemPromptSource === "langfuse" ? params.systemPromptVersion : undefined,
                    metadata: params.generationMetadata,
                },
                spans,
            });
        } catch (err) {
            console.error("[Langfuse] Failed to send trace:", err);
        }
    }, []);

    return { langfuseConfig, remotePrompts, systemPrompts, sendTrace };
}
