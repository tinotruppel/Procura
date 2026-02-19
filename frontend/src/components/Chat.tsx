import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { MessageList } from "@/components/MessageList";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ChatSidebar } from "@/components/ChatSidebar";
import { ChatInput } from "@/components/ChatInput";
import { useAttachments } from "@/hooks/useAttachments";
import { useChatDraft } from "@/hooks/useChatDraft";
import { useChatSessions } from "@/hooks/useChatSessions";
import { useLangfuseTracing } from "@/hooks/useLangfuseTracing";
import { ChatMessage, DebugEvent, LLMProvider } from "@/lib/llm-types";
import {
    getProvider,
    getApiKeyForProvider,
    getModelForProvider,
    getDebugMode,
    createNewChat,
    forkConversation,
    getCustomBaseUrl,
    updateChatTitleById,
} from "@/lib/storage";
import { initializeMcpServers } from "@/lib/mcp-client";
import { prepareMessagesWithAttachments } from "@/lib/chat/attachments";
import { resolveSystemPrompt } from "@/lib/chat/prompt-resolver";
import { executeLlmChatTurn } from "@/lib/chat/llm-flow";
import { exportChatAsMarkdown } from "@/lib/chat/export";
import { setToolContext } from "@/lib/tool-context";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Settings, History, Plus, Globe, Lock, LockOpen, ChevronDown, Edit2, FileDown, Pin, PinOff, X } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isVaultUnlocked, lockVault, restoreVaultFromSession } from "@/lib/vault";
import { onTimerFire } from "@/lib/timer-manager";


interface ChatProps {
    onOpenSettings: () => void;
    onLogout?: () => void;
    deepLinkParams?: {
        promptId: string | null;
        agentMsg: string | null;
    } | null;
}

export function Chat({ onOpenSettings, deepLinkParams, onLogout }: ChatProps) {
    // --- UI-only state ---
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [debugMode, setDebugMode] = useState(false);
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [editingTitleValue, setEditingTitleValue] = useState("");
    const [pendingIntervention, setPendingIntervention] = useState<string | null>(null);
    const [vaultUnlocked, setVaultUnlocked] = useState(isVaultUnlocked());

    // --- Refs ---
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const titleInputRef = useRef<HTMLInputElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const isAbortedRef = useRef(false);
    const requestGenRef = useRef(0);
    const handleSendRef = useRef<((overrideInput?: string, options?: { isScheduled?: boolean }) => Promise<void>) | null>(null);
    const triggerLLMContinuationRef = useRef<(() => Promise<void>) | null>(null);

    // --- Extracted hooks ---
    const sessions = useChatSessions();
    const attachments = useAttachments(setError);
    const tracing = useLangfuseTracing(sessions.messages.length);

    useChatDraft(
        input,
        attachments.pendingImages,
        attachments.pendingFiles,
        setInput,
        attachments.setPendingImages,
        attachments.setPendingFiles,
    );

    // --- Stream lifecycle ---
    const stopCurrentStream = useCallback(() => {
        isAbortedRef.current = true;
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        setIsLoading(false);
        setPendingIntervention(null);
    }, []);

    // --- Effects ---

    // Initialize on mount: vault, MCP, chat, debug mode
    useEffect(() => {
        async function loadData() {
            await restoreVaultFromSession();
            setVaultUnlocked(isVaultUnlocked());
            const initPromise = initializeMcpServers();
            await sessions.initialize();
            const currentDebugMode = await getDebugMode();
            setDebugMode(currentDebugMode);
            await initPromise;
        }
        loadData();
    }, []);

    // Subscribe to scheduled timer events
    const switchAndSendRef = useRef<((chatId: string, msg: string) => Promise<void>) | null>(null);

    useEffect(() => {
        const unsubscribe = onTimerFire(async (timerChatId: string, scheduledMessage: string) => {
            console.log(`[Chat] Timer fired for chat ${timerChatId}: ${scheduledMessage}`);
            if (timerChatId === sessions.chatId) {
                setTimeout(async () => {
                    if (handleSendRef.current) {
                        await handleSendRef.current(scheduledMessage, { isScheduled: true });
                    }
                }, 100);
            } else {
                console.log(`[Chat] Timer fired for different chat, switching from ${sessions.chatId} to ${timerChatId}`);
                if (switchAndSendRef.current) {
                    await switchAndSendRef.current(timerChatId, scheduledMessage);
                }
            }
        });
        return () => unsubscribe();
    }, [sessions.chatId]);

    // Handle deep links (extension via storage, PWA via props)
    const handleDeepLink = useCallback(async () => {
        let promptId: string | null = null;
        let agentMsg: string | null = null;

        if (typeof chrome !== "undefined" && chrome.storage?.local) {
            try {
                const result = await chrome.storage.local.get("pendingDeepLink");
                const deepLink = result.pendingDeepLink;
                if (deepLink) {
                    console.log("[Chat] Processing extension deep link:", deepLink);
                    await chrome.storage.local.remove("pendingDeepLink");
                    if (deepLink.timestamp && Date.now() - deepLink.timestamp > 30000) {
                        console.log("[Chat] Ignoring stale deep link");
                        return;
                    }
                    promptId = deepLink.promptId;
                    agentMsg = deepLink.agentMsg;
                }
            } catch (err) {
                console.error("[Chat] Failed to read extension storage:", err);
            }
        }

        if (!promptId && !agentMsg && deepLinkParams) {
            console.log("[Chat] Processing PWA deep link:", deepLinkParams);
            promptId = deepLinkParams.promptId;
            agentMsg = deepLinkParams.agentMsg;
        }

        if (!promptId && !agentMsg) return;

        let resolvedPromptId: string | null = null;
        if (promptId) {
            resolvedPromptId = promptId.startsWith("langfuse_") ? promptId : `langfuse_${promptId}`;
        }

        const newId = await createNewChat(resolvedPromptId);
        sessions.setChatId(newId);
        sessions.setChatTitle(null);
        attachments.setPendingImages([]);
        attachments.setPendingFiles([]);
        setError(null);

        if (resolvedPromptId) {
            await sessions.updatePromptId(resolvedPromptId);
        }

        if (agentMsg) {
            const agentMessage: ChatMessage = { role: "model", content: agentMsg };
            sessions.setMessages([agentMessage]);
            console.log("[Chat] Waiting for MCP initialization before triggering LLM...");
            await initializeMcpServers();
            console.log("[Chat] MCP initialization complete, triggering LLM...");
            setTimeout(() => { triggerLLMContinuation(resolvedPromptId ?? undefined); }, 100);
        } else {
            sessions.setMessages([]);
        }
    }, [deepLinkParams]);

    useEffect(() => { handleDeepLink(); }, [handleDeepLink]);

    useEffect(() => {
        if (typeof chrome === "undefined" || !chrome.storage?.onChanged) return;
        const listener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
            if (area !== "local") return;
            if (changes.pendingDeepLink?.newValue) { handleDeepLink(); }
        };
        chrome.storage.onChanged.addListener(listener);
        return () => { chrome.storage.onChanged.removeListener(listener); };
    }, [handleDeepLink]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [sessions.messages]);

    // --- Shared LLM callback builders ---

    const makeDebugHandler = (generationId: string, provider: string, customBaseUrl: string | undefined, systemPromptName: string | undefined, systemPromptSource: "local" | "langfuse" | undefined, injectedMemoryCount: number | undefined, missingVariables?: string[]) =>
        (event: DebugEvent) => {
            if (isAbortedRef.current) return;
            if (event.type === "llm") {
                event.info.observationId = generationId;
                event.info.provider = provider;
                if (provider === "custom" && customBaseUrl) event.info.baseUrl = customBaseUrl;
                if (systemPromptName) { event.info.systemPromptName = systemPromptName; event.info.systemPromptSource = systemPromptSource; }
                if (injectedMemoryCount && injectedMemoryCount > 0) event.info.injectedMemoryCount = injectedMemoryCount;
                if (missingVariables && missingVariables.length > 0) event.info.missingVariables = missingVariables;
            }
            if (event.type === "tool") event.info.observationId = crypto.randomUUID();
            sessions.setMessages(prev => {
                const updated = [...prev];
                const lastMsg = updated[updated.length - 1];
                if (lastMsg?.role === "model") lastMsg.debugEvents = [...(lastMsg.debugEvents || []), event];
                return updated;
            });
        };

    const makeTextChunkHandler = () => (chunk: string) => {
        if (isAbortedRef.current) return;
        sessions.setMessages(prev => {
            const updated = [...prev];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg?.role === "model") lastMsg.content = (lastMsg.content || "") + chunk;
            return updated;
        });
    };

    // --- LLM Orchestration ---

    const handleSend = async (overrideInput?: string, options?: { isScheduled?: boolean }) => {
        const effectiveInput = overrideInput ?? input;
        if (!effectiveInput.trim() && attachments.pendingImages.length === 0 && attachments.pendingFiles.length === 0) return;

        if (isLoading) {
            setPendingIntervention(effectiveInput.trim());
            if (!overrideInput) setInput("");
            return;
        }

        const thisGen = ++requestGenRef.current;

        const provider = await getProvider();
        const apiKey = await getApiKeyForProvider(provider);
        if (!apiKey) { setError("Please configure your API Key in the settings first."); return; }

        const model = await getModelForProvider(provider);
        const customBaseUrl = await getCustomBaseUrl();
        const { systemPrompt, systemPromptName, systemPromptVersion, systemPromptSource, missingVariables, injectedMemoryCount } =
            await resolveSystemPrompt({ selectedPromptId: sessions.selectedPromptId, systemPrompts: tracing.systemPrompts });
        const currentDebugMode = await getDebugMode();
        setDebugMode(currentDebugMode);

        const { displayMessage, llmMessage, registeredFiles, imageIds, llmContent } =
            prepareMessagesWithAttachments({ input: effectiveInput, pendingImages: attachments.pendingImages, pendingFiles: attachments.pendingFiles });

        // Scheduled messages display as assistant but send as user to the LLM
        if (options?.isScheduled) {
            displayMessage.role = "model";
            displayMessage.content = `⏰ ${displayMessage.content}`;
            displayMessage.timestamp = Date.now();
        }

        if (injectedMemoryCount && injectedMemoryCount > 0) console.log(`[Chat] Injected ${injectedMemoryCount} memories into system prompt`);
        if (imageIds.length > 0) console.log("[Chat] Registered images:", imageIds);
        if (registeredFiles.length > 0) console.log("[Chat] Registered files:", registeredFiles.map((file) => file.id));

        const newDisplayMessages = [...sessions.messages, displayMessage];
        const newLlmMessages = [...sessions.messages, llmMessage];

        sessions.setMessages(newDisplayMessages);
        if (!overrideInput) setInput("");
        attachments.setPendingImages([]);
        attachments.setPendingFiles([]);
        setError(null);
        setIsLoading(true);
        abortControllerRef.current = new AbortController();
        isAbortedRef.current = false;

        const traceId = crypto.randomUUID();
        const generationId = crypto.randomUUID();
        const traceStartTime = new Date();

        try {
            const pendingMessage: ChatMessage = { role: "model", content: "", debugEvents: [], traceId };
            sessions.setMessages([...newDisplayMessages, pendingMessage]);

            setToolContext({ promptId: sessions.selectedPromptId || undefined, chatId: sessions.chatId || undefined });

            const response = await executeLlmChatTurn({
                provider, apiKey, model,
                messages: newLlmMessages,
                systemPrompt: systemPrompt || undefined,
                onDebugEvent: makeDebugHandler(generationId, provider, customBaseUrl || undefined, systemPromptName, systemPromptSource, injectedMemoryCount, missingVariables),
                onTextChunk: makeTextChunkHandler(),
                signal: abortControllerRef.current?.signal,
                customBaseUrl: customBaseUrl || undefined,
            });

            const assistantMessage: ChatMessage = {
                role: "model", content: response.text,
                toolCalls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
                llmDebug: response.debug, debugEvents: response.debugEvents,
                traceId, timestamp: Date.now(),
            };
            const finalMessages = [...newDisplayMessages, assistantMessage];
            sessions.setMessages(finalMessages);
            await sessions.saveChat(finalMessages);

            await tracing.sendTrace({
                traceId, generationId, chatId: sessions.chatId, responseText: response.text, model, startTime: traceStartTime,
                debugEvents: response.debugEvents, systemPromptName, systemPromptVersion, systemPromptSource,
                traceName: "chat-turn",
                traceInput: displayMessage.content,
                traceMetadata: { provider, model, hasImages: attachments.pendingImages.length > 0 },
                generationInput: systemPrompt ? { system: systemPrompt, user: llmContent } : llmContent,
                generationMetadata: { provider, llmCallCount: response.debugEvents?.filter(e => e.type === "llm").length || 0 },
                includeToolSpans: true,
            });

            if (finalMessages.length === 2 && !sessions.chatTitle) {
                generateChatTitle(provider, apiKey, model, finalMessages, customBaseUrl);
            }

            if (pendingIntervention) {
                const intervention = pendingIntervention;
                setPendingIntervention(null);
                setTimeout(() => { handleSend(intervention); }, 0);
            }
        } catch (err) {
            if (isAbortedRef.current) return;
            if (requestGenRef.current !== thisGen) return;
            setError(err instanceof Error ? err.message : "An error occurred");
            setPendingIntervention(null);
        } finally {
            if (requestGenRef.current === thisGen) {
                setIsLoading(false);
                abortControllerRef.current = null;
            }
            textareaRef.current?.focus();
        }
    };

    handleSendRef.current = handleSend;

    const switchAndSend = async (targetChatId: string, message: string) => {
        stopCurrentStream();
        await sessions.selectChatById(targetChatId);
        setTimeout(async () => {
            if (handleSendRef.current) {
                await handleSendRef.current(message, { isScheduled: true });
            }
        }, 100);
    };
    switchAndSendRef.current = switchAndSend;

    const handleStop = () => {
        stopCurrentStream();
    };

    const generateChatTitle = async (provider: string, apiKey: string, model: string, msgs: ChatMessage[], customBaseUrl?: string) => {
        const targetChatId = sessions.chatId; // capture at call time
        try {
            const titlePrompt = "Based on this conversation, provide a very short title (max 5 words) for this chat. Return ONLY the title, no quotes or explanation.";
            const titleMessages: ChatMessage[] = [...msgs, { role: "user" as const, content: titlePrompt }];
            const titleResponse = await executeLlmChatTurn({ provider: provider as LLMProvider, apiKey, model, messages: titleMessages, systemPrompt: undefined, customBaseUrl });
            const title = titleResponse.text.trim().substring(0, 50);
            if (targetChatId) {
                await updateChatTitleById(targetChatId, title);
            }
            // Only update React state if we're still on the same chat
            if (sessions.chatId === targetChatId) {
                sessions.setChatTitle(title);
            }
        } catch (e) {
            console.error("Failed to generate chat title:", e);
        }
    };

    const triggerLLMContinuation = async (promptIdOverride?: string) => {
        const thisGen = ++requestGenRef.current;

        const provider = await getProvider();
        const apiKey = await getApiKeyForProvider(provider);
        if (!apiKey) { setError("Please configure your API Key in the settings first."); return; }

        const model = await getModelForProvider(provider);
        const customBaseUrl = await getCustomBaseUrl();
        const currentDebugMode = await getDebugMode();
        setDebugMode(currentDebugMode);

        const { systemPrompt, systemPromptName, systemPromptVersion, systemPromptSource, injectedMemoryCount } =
            await resolveSystemPrompt({ selectedPromptId: sessions.selectedPromptId, systemPrompts: tracing.systemPrompts, promptIdOverride });

        if (injectedMemoryCount && injectedMemoryCount > 0) console.log(`[Chat] Injected ${injectedMemoryCount} memories into system prompt`);

        setIsLoading(true);
        abortControllerRef.current = new AbortController();
        isAbortedRef.current = false;

        const traceId = crypto.randomUUID();
        const generationId = crypto.randomUUID();
        const traceStartTime = new Date();

        try {
            const pendingMessage: ChatMessage = { role: "model", content: "", debugEvents: [], traceId };
            sessions.setMessages(prev => [...prev, pendingMessage]);

            const currentMessages = await new Promise<ChatMessage[]>(resolve => {
                sessions.setMessages(prev => { resolve(prev.slice(0, -1)); return prev; });
            });

            setToolContext({ promptId: sessions.selectedPromptId || undefined, chatId: sessions.chatId || undefined });

            const response = await executeLlmChatTurn({
                provider, apiKey, model, messages: currentMessages, systemPrompt,
                onDebugEvent: makeDebugHandler(generationId, provider, customBaseUrl || undefined, systemPromptName, systemPromptSource, injectedMemoryCount),
                onTextChunk: makeTextChunkHandler(),
                signal: abortControllerRef.current?.signal, customBaseUrl,
            });

            const assistantMessage: ChatMessage = {
                role: "model", content: response.text,
                toolCalls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
                llmDebug: response.debug, debugEvents: response.debugEvents,
                traceId, timestamp: Date.now(),
            };

            sessions.setMessages(prev => {
                const withoutPending = prev.slice(0, -1);
                const finalMessages = [...withoutPending, assistantMessage];
                sessions.saveChat(finalMessages);
                return finalMessages;
            });

            await tracing.sendTrace({
                traceId, generationId, chatId: sessions.chatId, responseText: response.text, model, startTime: traceStartTime,
                debugEvents: response.debugEvents, systemPromptName, systemPromptVersion, systemPromptSource,
                traceName: "deep-link-continuation",
                traceInput: "Deep link trigger",
                traceMetadata: { provider, model, deepLink: true },
                generationInput: systemPrompt ? { system: systemPrompt, context: "Continuation from agent message" } : "Continuation",
            });
        } catch (err) {
            if (!isAbortedRef.current && requestGenRef.current === thisGen) {
                setError(err instanceof Error ? err.message : "An error occurred");
            }
        } finally {
            if (requestGenRef.current === thisGen) {
                setIsLoading(false);
                abortControllerRef.current = null;
            }
        }
    };

    triggerLLMContinuationRef.current = triggerLLMContinuation;

    // --- Session handlers ---

    const handleNewChat = async () => {
        stopCurrentStream();
        await sessions.startNewChat();
        attachments.setPendingImages([]);
        attachments.setPendingFiles([]);
        setError(null);
        setTimeout(() => textareaRef.current?.focus(), 0);
    };

    const handleSelectChat = async (session: Parameters<typeof sessions.selectChat>[0]) => {
        stopCurrentStream();
        await sessions.selectChat(session);
        const currentDebugMode = await getDebugMode();
        setDebugMode(currentDebugMode);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
    };

    const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInput(e.target.value);
        e.target.style.height = "auto";
        const lineHeight = 24;
        const maxHeight = lineHeight * 3;
        e.target.style.height = Math.min(e.target.scrollHeight, maxHeight) + "px";
    };

    // --- Render ---

    return (
        <div
            className="flex flex-col h-full relative"
            onDrop={attachments.handleDropWithReset}
            onDragOver={attachments.handleDragOver}
            onDragLeave={attachments.handleDragLeave}
        >
            {/* Drop Zone Overlay */}
            {attachments.isDragging && (
                <div className="absolute inset-0 z-50 bg-primary/10 border-2 border-dashed border-primary rounded-lg pointer-events-none" />
            )}

            {/* Header */}
            <div className="flex-shrink-0 flex items-center justify-between p-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                    <img src="/icons/icon-48.png" alt="Procura" className="w-8 h-8 rounded-lg flex-shrink-0" />
                    {isEditingTitle ? (
                        <input
                            ref={titleInputRef}
                            type="text"
                            value={editingTitleValue}
                            onChange={(e) => setEditingTitleValue(e.target.value)}
                            onBlur={async () => {
                                const newTitle = editingTitleValue.trim();
                                if (newTitle && newTitle !== sessions.chatTitle) { sessions.setChatTitle(newTitle); await sessions.saveChat(undefined, newTitle); }
                                setIsEditingTitle(false);
                            }}
                            onKeyDown={async (e) => {
                                if (e.key === "Enter") { e.preventDefault(); const newTitle = editingTitleValue.trim(); if (newTitle && newTitle !== sessions.chatTitle) { sessions.setChatTitle(newTitle); await sessions.saveChat(undefined, newTitle); } setIsEditingTitle(false); }
                                else if (e.key === "Escape") setIsEditingTitle(false);
                            }}
                            className="text-lg font-semibold bg-transparent border-b border-primary outline-none px-1 min-w-0 flex-1"
                            autoFocus
                        />
                    ) : (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button className="flex items-center gap-1 text-lg font-semibold truncate hover:text-primary/80 transition-colors focus:outline-none">
                                    <span className="truncate">{sessions.chatTitle || "Procura"}</span>
                                    <ChevronDown className="h-4 w-4 flex-shrink-0 opacity-60" />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                                <DropdownMenuItem onClick={() => { setEditingTitleValue(sessions.chatTitle || "New Chat"); setIsEditingTitle(true); setTimeout(() => titleInputRef.current?.select(), 0); }}>
                                    <Edit2 className="h-4 w-4 mr-2" />Rename
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => sessions.togglePin(setError)}>
                                    {sessions.isPinned ? <PinOff className="h-4 w-4 mr-2" /> : <Pin className="h-4 w-4 mr-2" />}
                                    {sessions.isPinned ? "Unpin" : "Pin"}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={sessions.exportAsMarkdown}>
                                    <FileDown className="h-4 w-4 mr-2" />Export as Markdown
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={() => sessions.setShowHistory(!sessions.showHistory)} title="Chat History"><History className="h-5 w-5" /></Button>
                    <Button variant="ghost" size="icon" onClick={handleNewChat} title="New Chat"><Plus className="h-5 w-5" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => { if (vaultUnlocked) { lockVault(); setVaultUnlocked(false); onLogout?.(); } }} title={vaultUnlocked ? "Lock vault" : "Vault locked"} disabled={!vaultUnlocked}>
                        {vaultUnlocked ? <LockOpen className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={onOpenSettings} title="Settings"><Settings className="h-5 w-5" /></Button>
                </div>
            </div>

            {/* History Sidebar */}
            <ChatSidebar
                showHistory={sessions.showHistory}
                chatSessions={sessions.chatSessions}
                currentChatId={sessions.chatId}
                onSelectChat={handleSelectChat}
                onClose={() => sessions.setShowHistory(false)}
            />

            {/* Messages or Empty State */}
            {sessions.messages.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-4">
                    <div className="text-center space-y-4">
                        <div className="text-4xl mb-2">💬</div>
                        <p>Start a chat</p>
                        {(tracing.systemPrompts.length >= 1 || tracing.remotePrompts.length >= 1) && (
                            <div className="mt-4">
                                <Select
                                    value={sessions.selectedPromptId || "_none_"}
                                    onValueChange={async (value) => { const newId = value === "_none_" ? null : value; await sessions.updatePromptId(newId); }}
                                >
                                    <SelectTrigger className="w-[220px] mx-auto text-xs"><SelectValue placeholder="Select a prompt..." /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="_none_" className="text-xs">(No system prompt)</SelectItem>
                                        {tracing.systemPrompts.length > 0 && (<><div className="my-1 h-px bg-border" /><div className="px-2 py-1 text-xs text-muted-foreground font-medium">Local</div></>)}
                                        {tracing.systemPrompts.map((prompt) => (<SelectItem key={prompt.id} value={prompt.id} className="text-xs">{prompt.title}</SelectItem>))}
                                        {tracing.remotePrompts.length > 0 && (
                                            <><div className="my-1 h-px bg-border" /><div className="px-2 py-1 text-xs text-muted-foreground font-medium">Remote (Langfuse)</div>
                                                {tracing.remotePrompts.map((prompt) => (
                                                    <SelectItem key={`langfuse_${prompt.name}`} value={`langfuse_${prompt.name}`} className="text-xs">
                                                        <span className="flex items-center gap-1"><Globe className="h-3 w-3 text-muted-foreground" />{prompt.name}</span>
                                                    </SelectItem>
                                                ))}</>
                                        )}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                <ErrorBoundary onExportChat={() => exportChatAsMarkdown(sessions.messages, sessions.chatTitle || "Untitled Chat")} onNewThread={async () => { await createNewChat(); window.location.reload(); }}>
                    <MessageList messages={sessions.messages} scrollRef={messagesEndRef} debugMode={debugMode} langfuseConfig={tracing.langfuseConfig} isStreaming={isLoading}
                        onFork={async (messageIndex: number) => {
                            try { await forkConversation(sessions.messages, messageIndex, sessions.chatTitle, sessions.selectedPromptId); window.location.reload(); }
                            catch (err) { console.error("[Chat] Fork failed:", err); setError("Failed to fork conversation"); }
                        }}
                    />
                </ErrorBoundary>
            )}

            {/* Error */}
            {error && (
                <div className="mx-4 mb-2 p-3 bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm rounded-lg relative">
                    {error}
                    <button onClick={() => setError(null)} className="absolute top-2 right-2 p-0.5 hover:bg-red-200 dark:hover:bg-red-800/50 rounded" title="Dismiss"><X className="h-4 w-4" /></button>
                </div>
            )}

            {/* Input */}
            <ChatInput
                input={input}
                isLoading={isLoading}
                pendingImages={attachments.pendingImages}
                pendingFiles={attachments.pendingFiles}
                pendingIntervention={pendingIntervention}
                textareaRef={textareaRef}
                fileInputRef={attachments.fileInputRef}
                onInputChange={handleTextareaChange}
                onKeyDown={handleKeyDown}
                onPaste={attachments.handlePaste}
                onSend={() => handleSend()}
                onStop={handleStop}
                onFileInput={attachments.handleFileInput}
                onRemoveImage={attachments.removeImage}
                onRemoveFile={attachments.removeFile}
            />
        </div>
    );
}
