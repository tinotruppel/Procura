import { ChatMessage } from "../llm-types";
import { storage } from "./adapter";
import { STORAGE_KEYS } from "./keys";

// ============================================================================
// Chat Session Types
// ============================================================================

export interface ChatSession {
    id: string;
    title: string | null;
    messages: ChatMessage[];
    createdAt: number;
    updatedAt: number;
    systemPromptId?: string | null;
    pinned?: boolean;
}

// ============================================================================
// Chat Sessions (Multi-chat support)
// ============================================================================

function generateChatId(): string {
    return crypto.randomUUID();
}

export async function getChatSessions(): Promise<ChatSession[]> {
    return storage.getValueOrDefault<ChatSession[]>(STORAGE_KEYS.CHAT_SESSIONS, []);
}

export async function setChatSessions(sessions: ChatSession[]): Promise<void> {
    try {
        await storage.set({ [STORAGE_KEYS.CHAT_SESSIONS]: sessions });
    } catch (error) {
        // Check if this is a quota exceeded error
        if (error instanceof Error && error.message.includes("QUOTA_BYTES")) {
            console.warn("[Storage] Quota exceeded, auto-cleaning oldest chat sessions...");

            // Sort by updatedAt ascending (oldest first) and remove oldest non-pinned sessions
            const pinnedSessions = sessions.filter(s => s.pinned);
            const unpinnedSessions = sessions.filter(s => !s.pinned).sort((a, b) => a.updatedAt - b.updatedAt);

            // Try progressively deleting old unpinned sessions until storage succeeds
            for (let i = 1; i <= Math.min(5, unpinnedSessions.length); i++) {
                const reducedSessions = [...pinnedSessions, ...unpinnedSessions.slice(i)];
                console.log(`[Storage] Attempting to save after removing ${i} oldest session(s)...`);

                try {
                    await storage.set({ [STORAGE_KEYS.CHAT_SESSIONS]: reducedSessions });
                    console.log(`[Storage] Success! Removed ${i} old chat session(s) to free up space.`);
                    return;
                } catch (retryError) {
                    if (!(retryError instanceof Error && retryError.message.includes("QUOTA_BYTES"))) {
                        throw retryError;
                    }
                    // Continue trying with fewer sessions
                }
            }

            // If still failing, throw with helpful message
            throw new Error("Storage quota exceeded. Unable to save even after removing old chats. Please manually clear some data.");
        }
        throw error;
    }
}

export async function getCurrentChatId(): Promise<string | null> {
    return storage.getValueOrDefault<string | null>(STORAGE_KEYS.CURRENT_CHAT_ID, null);
}

export async function setCurrentChatId(chatId: string): Promise<void> {
    await storage.set({ [STORAGE_KEYS.CURRENT_CHAT_ID]: chatId });
}

export async function getCurrentChat(): Promise<ChatSession | null> {
    const chatId = await getCurrentChatId();
    if (!chatId) return null;
    const sessions = await getChatSessions();
    return sessions.find((s) => s.id === chatId) || null;
}

// Maximum number of chat sessions to keep (oldest by updatedAt are auto-deleted)
const MAX_CHAT_SESSIONS = 20;
const MAX_PINNED_CHATS = 5;

export async function saveCurrentChat(
    messages: ChatMessage[],
    title: string | null,
    systemPromptId?: string | null
): Promise<void> {
    let chatId = await getCurrentChatId();
    let sessions = await getChatSessions();
    const now = Date.now();

    if (!chatId) {
        // Create new session
        chatId = generateChatId();
        await setCurrentChatId(chatId);
        sessions.push({
            id: chatId,
            title,
            messages,
            createdAt: now,
            updatedAt: now,
            systemPromptId: systemPromptId ?? null,
        });
    } else {
        // Update existing session
        const idx = sessions.findIndex((s) => s.id === chatId);
        if (idx >= 0) {
            sessions[idx] = {
                ...sessions[idx],
                title,
                messages,
                updatedAt: now,
                systemPromptId: systemPromptId ?? sessions[idx].systemPromptId ?? null,
            };
        } else {
            sessions.push({
                id: chatId,
                title,
                messages,
                createdAt: now,
                updatedAt: now,
                systemPromptId: systemPromptId ?? null,
            });
        }
    }

    // Auto-cleanup: keep only MAX_CHAT_SESSIONS, delete least recently updated (excluding pinned)
    if (sessions.length > MAX_CHAT_SESSIONS) {
        const pinned = sessions.filter(s => s.pinned);
        const unpinned = sessions.filter(s => !s.pinned).sort((a, b) => b.updatedAt - a.updatedAt);
        const keptUnpinned = unpinned.slice(0, Math.max(0, MAX_CHAT_SESSIONS - pinned.length));
        const deletedCount = sessions.length - pinned.length - keptUnpinned.length;
        sessions = [...pinned, ...keptUnpinned];
        if (deletedCount > 0) {
            console.log(`[Storage] Auto-cleaned ${deletedCount} old chat session(s), keeping ${sessions.length} (${pinned.length} pinned)`);
        }
    }

    await setChatSessions(sessions);
}

export async function switchToChat(chatId: string): Promise<ChatSession | null> {
    const sessions = await getChatSessions();
    const session = sessions.find((s) => s.id === chatId);
    if (session) {
        await setCurrentChatId(chatId);
        return session;
    }
    return null;
}

export async function createNewChat(systemPromptId?: string | null): Promise<string> {
    const chatId = generateChatId();
    const sessions = await getChatSessions();
    const now = Date.now();
    sessions.push({
        id: chatId,
        title: null,
        messages: [],
        createdAt: now,
        updatedAt: now,
        systemPromptId: systemPromptId ?? null,
    });
    await setChatSessions(sessions);
    await setCurrentChatId(chatId);
    return chatId;
}

/**
 * Fork a conversation by creating a new chat with messages copied up to a specific index.
 * This allows users to "branch" from a point in the conversation where the context was still good.
 */
export async function forkConversation(
    sourceMessages: ChatMessage[],
    upToIndex: number,
    sourceTitle?: string | null,
    systemPromptId?: string | null
): Promise<string> {
    const chatId = generateChatId();
    const sessions = await getChatSessions();
    const now = Date.now();

    // Copy messages from 0 to upToIndex (inclusive), cleaning streaming-specific fields
    const forkedMessages: ChatMessage[] = sourceMessages.slice(0, upToIndex + 1).map((msg) => ({
        role: msg.role,
        content: msg.content,
        images: msg.images ? [...msg.images] : undefined,
        files: msg.files ? [...msg.files] : undefined,
        // Omit debugEvents and traceId as they're session-specific
    }));

    // Generate fork title
    const baseTitle = sourceTitle || "Untitled";
    const forkTitle = `Fork: ${baseTitle}`;

    sessions.push({
        id: chatId,
        title: forkTitle,
        messages: forkedMessages,
        createdAt: now,
        updatedAt: now,
        systemPromptId: systemPromptId ?? null,
    });

    await setChatSessions(sessions);
    await setCurrentChatId(chatId);
    return chatId;
}

/**
 * Update only the title of a specific chat session by ID.
 * Safe to call even if the chat is no longer the current one.
 */
export async function updateChatTitleById(chatId: string, title: string): Promise<void> {
    const sessions = await getChatSessions();
    const idx = sessions.findIndex(s => s.id === chatId);
    if (idx >= 0) {
        sessions[idx] = { ...sessions[idx], title, updatedAt: Date.now() };
        await setChatSessions(sessions);
    }
}

export async function deleteChat(chatId: string): Promise<void> {
    const sessions = await getChatSessions();
    const filtered = sessions.filter((s) => s.id !== chatId);
    await setChatSessions(filtered);

    const currentId = await getCurrentChatId();
    if (currentId === chatId) {
        // Switch to most recent or create new
        if (filtered.length > 0) {
            const sorted = [...filtered].sort((a, b) => b.updatedAt - a.updatedAt);
            await setCurrentChatId(sorted[0].id);
        } else {
            await createNewChat();
        }
    }
}

export async function getPinnedChatsCount(): Promise<number> {
    const sessions = await getChatSessions();
    return sessions.filter(s => s.pinned).length;
}

/**
 * Toggle pinned state for a chat session.
 * Returns the new pinned state, or throws if max pinned limit reached.
 */
export async function toggleChatPinned(chatId: string): Promise<boolean> {
    const sessions = await getChatSessions();
    const session = sessions.find(s => s.id === chatId);
    if (!session) {
        throw new Error("Chat session not found");
    }

    const newPinned = !session.pinned;

    // Check max pinned limit when pinning
    if (newPinned) {
        const currentPinnedCount = sessions.filter(s => s.pinned).length;
        if (currentPinnedCount >= MAX_PINNED_CHATS) {
            throw new Error(`Maximum ${MAX_PINNED_CHATS} pinned chats allowed`);
        }
    }

    session.pinned = newPinned;
    await setChatSessions(sessions);
    return newPinned;
}
