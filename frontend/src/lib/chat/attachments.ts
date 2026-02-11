import { addFile } from "@/lib/file-store";
import type { AttachedFile, ChatMessage } from "@/lib/llm-types";

export interface PreparedMessagesResult {
    displayMessage: ChatMessage;
    llmMessage: ChatMessage;
    registeredFiles: AttachedFile[];
    imageIds: string[];
    llmContent: string;
}

interface PrepareMessagesInput {
    input: string;
    pendingImages: string[];
    pendingFiles: AttachedFile[];
}

export function prepareMessagesWithAttachments({
    input,
    pendingImages,
    pendingFiles,
}: PrepareMessagesInput): PreparedMessagesResult {
    const displayContent = input.trim();
    let llmContent = input.trim();

    let imageIds: string[] = [];
    if (pendingImages.length > 0) {
        imageIds = pendingImages.map((img, idx) => addFile(img, `image_${idx + 1}.png`));
        const imageLabels = imageIds.map((id, idx) => `[Image ${idx + 1}: ${id}]`).join(" ");
        llmContent = llmContent + "\n\n" + imageLabels;
    }

    const registeredFiles: AttachedFile[] = [];
    if (pendingFiles.length > 0) {
        for (const file of pendingFiles) {
            const fileId = addFile(file.dataUrl, file.fileName);
            registeredFiles.push({ ...file, id: fileId });
        }
        const fileLabels = registeredFiles
            .map((file, idx) => `[File ${idx + 1}: ${file.id} (${file.fileName}, ${file.mimeType})]`)
            .join(" ");
        llmContent = llmContent + (llmContent ? "\n\n" : "") + fileLabels;
    }

    const displayMessage: ChatMessage = {
        role: "user",
        content: displayContent,
        images: pendingImages.length > 0 ? pendingImages : undefined,
        files: registeredFiles.length > 0 ? registeredFiles : undefined,
    };

    const llmMessage: ChatMessage = {
        role: "user",
        content: llmContent,
        images: pendingImages.length > 0 ? pendingImages : undefined,
        files: registeredFiles.length > 0 ? registeredFiles : undefined,
    };

    return {
        displayMessage,
        llmMessage,
        registeredFiles,
        imageIds,
        llmContent,
    };
}
