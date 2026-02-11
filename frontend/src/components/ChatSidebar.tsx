import { Button } from "@/components/ui/button";
import { ChatSession } from "@/lib/storage";
import { formatDate } from "@/lib/chat/export";
import { X, Pin } from "lucide-react";

interface ChatSidebarProps {
    showHistory: boolean;
    chatSessions: ChatSession[];
    currentChatId: string | null;
    onSelectChat: (session: ChatSession) => void;
    onClose: () => void;
}

export function ChatSidebar({ showHistory, chatSessions, currentChatId, onSelectChat, onClose }: ChatSidebarProps) {
    if (!showHistory) return null;

    return (
        <div className="absolute top-16 left-0 right-0 z-50 mx-4 bg-background border rounded-lg shadow-lg max-h-80 overflow-y-auto">
            <div className="p-2">
                <div className="flex items-center justify-between mb-2 px-2">
                    <span className="text-sm font-medium text-muted-foreground">Chat History</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
                        <X className="h-4 w-4" />
                    </Button>
                </div>
                {chatSessions.length === 0 ? (
                    <p className="text-sm text-muted-foreground px-2 py-4 text-center">No chat history</p>
                ) : (
                    [...chatSessions]
                        .sort((a, b) => {
                            // Pinned chats first
                            if (a.pinned && !b.pinned) return -1;
                            if (!a.pinned && b.pinned) return 1;
                            // Then by updatedAt descending
                            return b.updatedAt - a.updatedAt;
                        })
                        .map((session) => (
                            <button
                                key={session.id}
                                onClick={() => onSelectChat(session)}
                                className={`w-full text-left px-3 py-2 rounded-md hover:bg-muted text-sm transition-colors ${session.id === currentChatId ? 'bg-muted' : ''}`}
                            >
                                <div className="flex justify-between items-start gap-2">
                                    <span className="truncate flex-1 flex items-center gap-1.5">
                                        {session.pinned && <Pin className="h-3 w-3 flex-shrink-0 text-muted-foreground" />}
                                        {session.title || "New Chat"}
                                    </span>
                                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                                        {formatDate(session.updatedAt)}
                                    </span>
                                </div>
                            </button>
                        ))
                )}
            </div>
        </div>
    );
}
