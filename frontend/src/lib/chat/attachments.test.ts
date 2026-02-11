import { describe, it, expect, vi, beforeEach } from "vitest";
import { prepareMessagesWithAttachments } from "./attachments";
import { addFile } from "@/lib/file-store";

vi.mock("@/lib/file-store", () => ({
    addFile: vi.fn(),
}));

describe("prepareMessagesWithAttachments", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should attach image and file labels to LLM content", () => {
        let counter = 0;
        (addFile as ReturnType<typeof vi.fn>).mockImplementation(() => `file_${++counter}`);

        const result = prepareMessagesWithAttachments({
            input: "Hello",
            pendingImages: ["data:image/png;base64,aaa"],
            pendingFiles: [
                {
                    id: "",
                    fileName: "doc.pdf",
                    mimeType: "application/pdf",
                    fileSize: 123,
                    dataUrl: "data:application/pdf;base64,bbb",
                },
            ],
        });

        expect(result.llmContent).toContain("[Image 1: file_1]");
        expect(result.llmContent).toContain("[File 1: file_2 (doc.pdf, application/pdf)]");
        expect(result.displayMessage.content).toBe("Hello");
        expect(result.displayMessage.files?.[0].id).toBe("file_2");
    });

    it("should handle text-only messages without attachments", () => {
        const result = prepareMessagesWithAttachments({
            input: "Just text",
            pendingImages: [],
            pendingFiles: [],
        });

        expect(result.llmContent).toBe("Just text");
        expect(result.displayMessage.files).toBeUndefined();
        expect(result.displayMessage.images).toBeUndefined();
    });
});
