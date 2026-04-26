import { useState, useEffect, useRef } from "react";

const CHANNEL_NAME = "procura-active-chat";
const INSTANCE_ID = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

interface ChatPresenceMessage {
    type: "announce" | "query";
    chatId: string;
    instanceId: string;
}

/**
 * Detects when the same chat is opened in another browser instance (tab/window).
 * Uses BroadcastChannel for cross-tab communication — no storage writes needed.
 */
export function useDuplicateChatWarning(chatId: string | null): boolean {
    const [isDuplicate, setIsDuplicate] = useState(false);
    const channelRef = useRef<BroadcastChannel | null>(null);

    useEffect(() => {
        if (!chatId) {
            setIsDuplicate(false);
            return;
        }

        const channel = new BroadcastChannel(CHANNEL_NAME);
        channelRef.current = channel;

        const handleMessage = (event: MessageEvent<ChatPresenceMessage>) => {
            const { type, chatId: remoteChatId, instanceId } = event.data;
            if (instanceId === INSTANCE_ID) return; // ignore own messages

            if (remoteChatId === chatId) {
                setIsDuplicate(true);
                // Reply so the other instance also sees the conflict
                if (type === "query") {
                    channel.postMessage({ type: "announce", chatId, instanceId: INSTANCE_ID });
                }
            }
        };

        channel.addEventListener("message", handleMessage);

        // Query other instances on mount / chatId change
        channel.postMessage({ type: "query", chatId, instanceId: INSTANCE_ID });

        return () => {
            channel.removeEventListener("message", handleMessage);
            channel.close();
            channelRef.current = null;
            setIsDuplicate(false);
        };
    }, [chatId]);

    return isDuplicate;
}
