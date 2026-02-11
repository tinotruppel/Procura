import { useEffect } from "react";
import { AttachedFile } from "@/lib/llm-types";

const DRAFT_STORAGE_KEY = "procura_chat_draft";

interface ChatDraft {
    input: string;
    pendingImages: string[];
    pendingFiles: AttachedFile[];
}

/**
 * Persists chat draft (input text + attachments) to sessionStorage.
 * Restores on mount, auto-saves on change.
 */
export function useChatDraft(
    input: string,
    pendingImages: string[],
    pendingFiles: AttachedFile[],
    setInput: (v: string) => void,
    setPendingImages: (v: string[]) => void,
    setPendingFiles: (v: AttachedFile[]) => void,
): { clearDraft: () => void } {
    // Restore draft on mount
    useEffect(() => {
        try {
            const saved = sessionStorage.getItem(DRAFT_STORAGE_KEY);
            if (saved) {
                const draft: ChatDraft = JSON.parse(saved);
                if (draft.input) setInput(draft.input);
                if (draft.pendingImages?.length) setPendingImages(draft.pendingImages);
                if (draft.pendingFiles?.length) setPendingFiles(draft.pendingFiles);
                sessionStorage.removeItem(DRAFT_STORAGE_KEY);
            }
        } catch {
            // Ignore parse errors
        }
    }, []);

    // Auto-save draft whenever input or files change
    useEffect(() => {
        const hasDraft = input.trim() || pendingImages.length > 0 || pendingFiles.length > 0;
        if (hasDraft) {
            const draft: ChatDraft = { input, pendingImages, pendingFiles };
            sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
        } else {
            sessionStorage.removeItem(DRAFT_STORAGE_KEY);
        }
    }, [input, pendingImages, pendingFiles]);

    const clearDraft = () => {
        sessionStorage.removeItem(DRAFT_STORAGE_KEY);
    };

    return { clearDraft };
}
