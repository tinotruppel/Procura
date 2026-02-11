import { describe, it, expect, beforeEach, vi } from "vitest";

type FileStoreModule = typeof import("./file-store");
let addFile: FileStoreModule["addFile"];
let getFile: FileStoreModule["getFile"];
let isImageMimeType: FileStoreModule["isImageMimeType"];

describe("FileStore", () => {
    beforeEach(async () => {
        vi.resetModules();
        const module = await import("./file-store");
        addFile = module.addFile;
        getFile = module.getFile;
        isImageMimeType = module.isImageMimeType;
    });

    describe("addFile", () => {
        it("should add a file and return a file_ prefixed ID", () => {
            const dataUrl = "data:application/pdf;base64,JVBERi0xLjQ=";
            const id = addFile(dataUrl, "document.pdf");

            expect(id).toMatch(/^file_[a-f0-9]{8}$/);
        });

        it("should return the same ID for the same file", () => {
            const dataUrl = "data:application/pdf;base64,JVBERi0xLjQ=";
            const id1 = addFile(dataUrl, "document.pdf");
            const id2 = addFile(dataUrl, "document.pdf");

            expect(id1).toBe(id2);
        });

        it("should return different IDs for different files", () => {
            const dataUrl1 = "data:application/pdf;base64,file1content";
            const dataUrl2 = "data:application/pdf;base64,file2content";
            const id1 = addFile(dataUrl1, "doc1.pdf");
            const id2 = addFile(dataUrl2, "doc2.pdf");

            expect(id1).not.toBe(id2);
        });
    });

    describe("getFile", () => {
        it("should retrieve a stored file with all metadata", () => {
            const dataUrl = "data:application/pdf;base64,SGVsbG9Xb3JsZA==";
            const fileName = "test.pdf";
            const id = addFile(dataUrl, fileName);

            const file = getFile(id);

            expect(file).toBeDefined();
            expect(file?.dataUrl).toBe(dataUrl);
            expect(file?.fileName).toBe(fileName);
            expect(file?.mimeType).toBe("application/pdf");
            expect(file?.fileSize).toBeGreaterThan(0);
        });

        it("should return undefined for non-existent ID", () => {
            const result = getFile("file_nonexistent");

            expect(result).toBeUndefined();
        });
    });

    // Utility functions
    describe("Utility functions", () => {
        describe("isImageMimeType", () => {
            it("should return true for image MIME types", () => {
                expect(isImageMimeType("image/png")).toBe(true);
                expect(isImageMimeType("image/jpeg")).toBe(true);
                expect(isImageMimeType("image/gif")).toBe(true);
                expect(isImageMimeType("image/webp")).toBe(true);
            });

            it("should return false for non-image MIME types", () => {
                expect(isImageMimeType("application/pdf")).toBe(false);
                expect(isImageMimeType("text/plain")).toBe(false);
                expect(isImageMimeType("audio/mpeg")).toBe(false);
            });
        });
    });
});
