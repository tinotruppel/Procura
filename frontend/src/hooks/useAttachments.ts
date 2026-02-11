import { useState, useRef } from "react";
import { AttachedFile } from "@/lib/llm-types";
import { isImageMimeType } from "@/lib/file-store";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB limit

export interface UseAttachmentsReturn {
    pendingImages: string[];
    pendingFiles: AttachedFile[];
    isDragging: boolean;
    fileInputRef: React.RefObject<HTMLInputElement | null>;
    setPendingImages: React.Dispatch<React.SetStateAction<string[]>>;
    setPendingFiles: React.Dispatch<React.SetStateAction<AttachedFile[]>>;
    handlePaste: (e: React.ClipboardEvent) => void;
    handleDrop: (e: React.DragEvent) => void;
    handleDragOver: (e: React.DragEvent) => void;
    handleDragLeave: (e: React.DragEvent) => void;
    handleDropWithReset: (e: React.DragEvent) => void;
    removeImage: (index: number) => void;
    removeFile: (index: number) => void;
    handleFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

function processFile(
    file: File,
    setPendingImages: React.Dispatch<React.SetStateAction<string[]>>,
    setPendingFiles: React.Dispatch<React.SetStateAction<AttachedFile[]>>,
) {
    const reader = new FileReader();
    reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        if (!dataUrl) return;

        if (isImageMimeType(file.type)) {
            setPendingImages((prev) => [...prev, dataUrl]);
        } else {
            const attachedFile: AttachedFile = {
                id: '',
                fileName: file.name,
                mimeType: file.type || 'application/octet-stream',
                fileSize: file.size,
                dataUrl,
            };
            setPendingFiles((prev) => [...prev, attachedFile]);
        }
    };
    reader.readAsDataURL(file);
}

export function useAttachments(
    setError: (err: string | null) => void
): UseAttachmentsReturn {
    const [pendingImages, setPendingImages] = useState<string[]>([]);
    const [pendingFiles, setPendingFiles] = useState<AttachedFile[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handlePaste = (e: React.ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        for (const item of Array.from(items)) {
            const file = item.getAsFile();
            if (!file) continue;

            if (file.size > MAX_FILE_SIZE) {
                setError(`File "${file.name}" is too large. Maximum size is 5MB.`);
                continue;
            }

            e.preventDefault();
            processFile(file, setPendingImages, setPendingFiles);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        const files = e.dataTransfer?.files;
        if (!files) return;

        for (const file of Array.from(files)) {
            if (file.size > MAX_FILE_SIZE) {
                setError(`File "${file.name}" is too large. Maximum size is 5MB.`);
                continue;
            }

            processFile(file, setPendingImages, setPendingFiles);
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setIsDragging(false);
        }
    };

    const handleDropWithReset = (e: React.DragEvent) => {
        setIsDragging(false);
        handleDrop(e);
    };

    const removeImage = (index: number) => {
        setPendingImages((prev) => prev.filter((_, i) => i !== index));
    };

    const removeFile = (index: number) => {
        setPendingFiles((prev) => prev.filter((_, i) => i !== index));
    };

    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files) return;

        for (const file of Array.from(files)) {
            if (file.size > MAX_FILE_SIZE) {
                setError(`File "${file.name}" is too large. Maximum size is 5MB.`);
                continue;
            }

            processFile(file, setPendingImages, setPendingFiles);
        }
        e.target.value = '';
    };

    return {
        pendingImages,
        pendingFiles,
        isDragging,
        fileInputRef,
        setPendingImages,
        setPendingFiles,
        handlePaste,
        handleDrop,
        handleDragOver,
        handleDragLeave,
        handleDropWithReset,
        removeImage,
        removeFile,
        handleFileInput,
    };
}
