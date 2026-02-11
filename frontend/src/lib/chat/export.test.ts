/**
 * Tests for chat export utilities
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    formatFileSize,
    getFileIcon,
    formatDate,
    messagesToMarkdown,
    downloadAsFile,
} from "./export";
import { ChatMessage } from "../llm-types";

describe("chat export utilities", () => {
    describe("formatFileSize", () => {
        it("should format bytes", () => {
            expect(formatFileSize(500)).toBe("500 B");
        });

        it("should format kilobytes", () => {
            expect(formatFileSize(1500)).toBe("1.5 KB");
        });

        it("should format megabytes", () => {
            expect(formatFileSize(1500000)).toBe("1.4 MB");
        });

        it("should handle zero", () => {
            expect(formatFileSize(0)).toBe("0 B");
        });

        it("should handle exact boundaries", () => {
            expect(formatFileSize(1024)).toBe("1.0 KB");
            expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
        });
    });

    describe("getFileIcon", () => {
        it("should return audio icon for audio files", () => {
            expect(getFileIcon("audio/mp3")).toBe("🎵");
            expect(getFileIcon("audio/wav")).toBe("🎵");
        });

        it("should return video icon for video files", () => {
            expect(getFileIcon("video/mp4")).toBe("🎬");
        });

        it("should return PDF icon", () => {
            expect(getFileIcon("application/pdf")).toBe("📄");
        });

        it("should return JSON icon", () => {
            expect(getFileIcon("application/json")).toBe("📋");
        });

        it("should return archive icon for compressed files", () => {
            expect(getFileIcon("application/zip")).toBe("📦");
            expect(getFileIcon("application/x-compressed")).toBe("📦");
        });

        it("should return text icon for text files", () => {
            expect(getFileIcon("text/plain")).toBe("📝");
            expect(getFileIcon("text/html")).toBe("📝");
        });

        it("should return default icon for unknown types", () => {
            expect(getFileIcon("application/octet-stream")).toBe("📎");
            expect(getFileIcon("unknown/type")).toBe("📎");
        });
    });

    describe("formatDate", () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it("should format recent timestamps as time only", () => {
            const now = new Date("2026-02-02T12:00:00");
            vi.setSystemTime(now);

            const oneHourAgo = now.getTime() - 3600000;
            const result = formatDate(oneHourAgo);

            // Should contain time format
            expect(result).toMatch(/\d{1,2}:\d{2}/);
        });

        it("should format week-old timestamps with weekday", () => {
            const now = new Date("2026-02-02T12:00:00");
            vi.setSystemTime(now);

            const threeDaysAgo = now.getTime() - 3 * 86400000;
            const result = formatDate(threeDaysAgo);

            // Should contain weekday abbreviation
            expect(result.length).toBeGreaterThan(5);
        });

        it("should format old timestamps with month and day", () => {
            const now = new Date("2026-02-02T12:00:00");
            vi.setSystemTime(now);

            const twoWeeksAgo = now.getTime() - 14 * 86400000;
            const result = formatDate(twoWeeksAgo);

            // Should contain month abbreviation
            expect(result).toMatch(/\w+/);
        });
    });

    describe("messagesToMarkdown", () => {
        it("should create markdown header with title and date", () => {
            const messages: ChatMessage[] = [];
            const result = messagesToMarkdown(messages, "Test Chat");

            expect(result).toContain("# Test Chat");
            expect(result).toContain("Exported:");
        });

        it("should format user messages", () => {
            const messages: ChatMessage[] = [
                { role: "user", content: "Hello world" },
            ];
            const result = messagesToMarkdown(messages, "Test");

            expect(result).toContain("## 👤 User");
            expect(result).toContain("Hello world");
        });

        it("should format assistant messages", () => {
            const messages: ChatMessage[] = [
                { role: "model", content: "Hi there!" },
            ];
            const result = messagesToMarkdown(messages, "Test");

            expect(result).toContain("## 🤖 Assistant");
            expect(result).toContain("Hi there!");
        });

        it("should include tool calls with arguments and results", () => {
            const messages: ChatMessage[] = [
                {
                    role: "model",
                    content: "Let me calculate that.",
                    toolCalls: [
                        {
                            name: "calculator",
                            args: { expression: "2+2" },
                            result: { success: true, data: 4 },
                        },
                    ],
                },
            ];
            const result = messagesToMarkdown(messages, "Test");

            expect(result).toContain("### 🔧 Tool: calculator");
            expect(result).toContain("**Arguments:**");
            expect(result).toContain('"expression": "2+2"');
            expect(result).toContain("**Result:** ✅");
            expect(result).toContain("4");
        });

        it("should handle failed tool calls", () => {
            const messages: ChatMessage[] = [
                {
                    role: "model",
                    content: "Trying...",
                    toolCalls: [
                        {
                            name: "http_request",
                            args: { url: "https://example.com" },
                            result: { success: false, error: "Network error" },
                        },
                    ],
                },
            ];
            const result = messagesToMarkdown(messages, "Test");

            expect(result).toContain("**Result:** ❌");
            expect(result).toContain("Network error");
        });

        it("should handle tool calls without results", () => {
            const messages: ChatMessage[] = [
                {
                    role: "model",
                    content: "Running...",
                    toolCalls: [
                        {
                            name: "screenshot",
                            args: {},
                        },
                    ],
                },
            ];
            const result = messagesToMarkdown(messages, "Test");

            expect(result).toContain("### 🔧 Tool: screenshot");
            expect(result).not.toContain("**Result:**");
        });
    });

    describe("downloadAsFile", () => {
        it("should create and trigger download", () => {
            const createObjectURL = vi.fn(() => "blob:test");
            const revokeObjectURL = vi.fn();
            const appendChild = vi.fn();
            const removeChild = vi.fn();
            const click = vi.fn();

            vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

            const mockElement = {
                href: "",
                download: "",
                click,
            };
            vi.spyOn(document, "createElement").mockReturnValue(mockElement as unknown as HTMLAnchorElement);
            vi.spyOn(document.body, "appendChild").mockImplementation(appendChild);
            vi.spyOn(document.body, "removeChild").mockImplementation(removeChild);

            downloadAsFile("test content", "test.md");

            expect(createObjectURL).toHaveBeenCalled();
            expect(mockElement.download).toBe("test.md");
            expect(click).toHaveBeenCalled();
            expect(revokeObjectURL).toHaveBeenCalled();
        });
    });
});
