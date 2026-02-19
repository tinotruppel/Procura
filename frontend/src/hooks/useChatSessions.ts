import { useState, useEffect } from "react";
import { ChatMessage } from "@/lib/llm-types";
import {
    getChatSessions,
    getCurrentChat,
    saveCurrentChat,
    switchToChat,
    createNewChat,
    ChatSession,
    getSelectedSystemPromptId,
    setSelectedSystemPromptId,
    toggleChatPinned,
} from "@/lib/storage";
import { exportChatAsMarkdown } from "@/lib/chat/export";
import { clearAnnotationState } from "@/tools/web-interaction";

export function useChatSessions() {
    const [chatId, setChatId] = useState<string | null>(null);
    const [chatTitle, setChatTitle] = useState<string | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
    const [isPinned, setIsPinned] = useState(false);
    const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
    const [showHistory, setShowHistory] = useState(false);

    // Load chat sessions when history panel opens
    useEffect(() => {
        if (showHistory) {
            getChatSessions().then((sessions) => {
                setChatSessions([...sessions].sort((a, b) => b.updatedAt - a.updatedAt));
            });
        }
    }, [showHistory]);

    /** Load current chat from storage. Returns the initial prompt ID. */
    const initialize = async (): Promise<string | null> => {
        const currentChat = await getCurrentChat();
        const storedPromptId = await getSelectedSystemPromptId();
        if (currentChat) {
            setMessages(currentChat.messages);
            setChatTitle(currentChat.title);
            setChatId(currentChat.id);
            setIsPinned(currentChat.pinned ?? false);
            setSelectedPromptId(currentChat.systemPromptId ?? storedPromptId);
        } else {
            const newChatId = await createNewChat(storedPromptId);
            setChatId(newChatId);
            setSelectedPromptId(storedPromptId);
        }
        return storedPromptId;
    };

    /** Create a new chat, saving the current one first. */
    const startNewChat = async (): Promise<string> => {
        if (messages.length > 0) {
            await saveCurrentChat(messages, chatTitle, selectedPromptId);
        }
        const newId = await createNewChat(selectedPromptId);
        setChatId(newId);
        setMessages([]);
        setChatTitle(null);
        setIsPinned(false);
        clearAnnotationState();
        return newId;
    };

    /** Switch to an existing chat session. Returns the loaded session or null. */
    const selectChat = async (session: ChatSession): Promise<ChatSession | null> => {
        if (messages.length > 0) {
            await saveCurrentChat(messages, chatTitle, selectedPromptId);
        }
        clearAnnotationState();
        const selected = await switchToChat(session.id);
        if (selected) {
            setChatId(selected.id);
            setMessages(selected.messages);
            setChatTitle(selected.title);
            setIsPinned(selected.pinned ?? false);
            if (selected.systemPromptId !== undefined) {
                setSelectedPromptId(selected.systemPromptId);
            } else if (selected.messages.length === 0) {
                const storedPromptId = await getSelectedSystemPromptId();
                setSelectedPromptId(storedPromptId);
            } else {
                setSelectedPromptId(null);
            }
        }
        setShowHistory(false);
        return selected;
    };

    /** Switch to an existing chat session by ID. Used by timer cross-chat handler. */
    const selectChatById = async (targetChatId: string): Promise<ChatSession | null> => {
        if (messages.length > 0) {
            await saveCurrentChat(messages, chatTitle, selectedPromptId);
        }
        clearAnnotationState();
        const selected = await switchToChat(targetChatId);
        if (selected) {
            setChatId(selected.id);
            setMessages(selected.messages);
            setChatTitle(selected.title);
            setIsPinned(selected.pinned ?? false);
            if (selected.systemPromptId !== undefined) {
                setSelectedPromptId(selected.systemPromptId);
            } else if (selected.messages.length === 0) {
                const storedPromptId = await getSelectedSystemPromptId();
                setSelectedPromptId(storedPromptId);
            } else {
                setSelectedPromptId(null);
            }
        }
        setShowHistory(false);
        return selected;
    };

    const togglePin = async (setError: (err: string | null) => void) => {
        if (!chatId) return;
        try {
            const newPinned = await toggleChatPinned(chatId);
            setIsPinned(newPinned);
            const sessions = await getChatSessions();
            setChatSessions(sessions);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to toggle pin");
        }
    };

    const saveChat = async (msgs?: ChatMessage[], title?: string | null) => {
        await saveCurrentChat(
            msgs ?? messages,
            title !== undefined ? title : chatTitle,
            selectedPromptId,
        );
    };

    /** Update prompt ID and persist immediately to both global storage and the chat session. */
    const updatePromptId = async (newId: string | null) => {
        setSelectedPromptId(newId);
        await setSelectedSystemPromptId(newId);
        await saveCurrentChat(messages, chatTitle, newId);
    };

    const exportAsMarkdown = () => {
        exportChatAsMarkdown(messages, chatTitle || "Untitled Chat");
    };

    return {
        chatId, setChatId,
        chatTitle, setChatTitle,
        messages, setMessages,
        chatSessions,
        isPinned, setIsPinned,
        selectedPromptId, setSelectedPromptId,
        showHistory, setShowHistory,
        initialize,
        startNewChat,
        selectChat,
        selectChatById,
        togglePin,
        saveChat,
        updatePromptId,
        exportAsMarkdown,
    };
}
