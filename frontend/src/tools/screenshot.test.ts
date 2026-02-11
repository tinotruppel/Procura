/**
 * Tests for screenshot.ts (content script messaging implementation)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screenshotTool } from "./screenshot";

// Mock chrome API
const chromeMock = {
    tabs: {
        query: vi.fn(),
        sendMessage: vi.fn(),
    },
};

vi.stubGlobal("chrome", chromeMock);

describe("screenshotTool", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("metadata", () => {
        it("should have correct name", () => {
            expect(screenshotTool.name).toBe("screenshot");
        });

        it("should be enabled by default", () => {
            expect(screenshotTool.enabledByDefault).toBe(true);
        });

        it("should have empty default config (uses hardcoded JPEG 60%)", () => {
            expect(screenshotTool.defaultConfig).toEqual({});
        });

        it("should not require any parameters", () => {
            expect(screenshotTool.schema.parameters.required).toEqual([]);
        });

        it("should have description mentioning viewport", () => {
            expect(screenshotTool.description).toContain("viewport");
        });
    });

    describe("execute", () => {
        it("should fail when no active tab found", async () => {
            chromeMock.tabs.query.mockResolvedValue([]);

            const result = await screenshotTool.execute({}, {});

            expect(result.success).toBe(false);
            expect(result.error).toBe("No active tab found");
        });

        it("should fail when tab has no id", async () => {
            chromeMock.tabs.query.mockResolvedValue([{ url: "https://example.com" }]);

            const result = await screenshotTool.execute({}, {});

            expect(result.success).toBe(false);
            expect(result.error).toBe("No active tab found");
        });

        it("should capture viewport screenshot successfully", async () => {
            const mockTab = {
                id: 1,
                title: "Example Page",
                url: "https://example.com",
            };
            chromeMock.tabs.query.mockResolvedValue([mockTab]);
            chromeMock.tabs.sendMessage.mockResolvedValue({
                success: true,
                dataUrl: "data:image/jpeg;base64,abc123",
                width: 800,
                height: 1200,
                originalWidth: 1920,
                originalHeight: 2880,
                fullPage: false,
            });

            const result = await screenshotTool.execute({ reason: "Test screenshot" }, {});

            expect(result.success).toBe(true);
            expect(result.data?.imageRef).toMatch(/^file_[a-f0-9]{8}$/);
            expect(result.data?.imageDataUrl).toBe("data:image/jpeg;base64,abc123");
            expect(result.data?.format).toBe("jpeg");
            expect(result.data?.quality).toBe(92);
            expect(result.data?.width).toBe(800);
            expect(result.data?.height).toBe(1200);
            expect(result.data?.originalWidth).toBe(1920);
            expect(result.data?.originalHeight).toBe(2880);
            expect(result.data?.fullPage).toBe(false);
            expect(result.data?.tabTitle).toBe("Example Page");
            expect(result.data?.tabUrl).toBe("https://example.com");
        });

        it("should send CAPTURE_SCREENSHOT message to content script", async () => {
            const mockTab = { id: 1, title: "Test", url: "https://test.com" };
            chromeMock.tabs.query.mockResolvedValue([mockTab]);
            chromeMock.tabs.sendMessage.mockResolvedValue({
                success: true,
                dataUrl: "data:image/jpeg;base64,test",
                width: 800,
                height: 600,
            });

            await screenshotTool.execute({}, {});

            expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(1, {
                type: "CAPTURE_SCREENSHOT",
                fullPage: false,
            });
        });

        it("should handle content script errors", async () => {
            chromeMock.tabs.query.mockResolvedValue([{ id: 1, title: "Test" }]);
            chromeMock.tabs.sendMessage.mockResolvedValue({
                success: false,
                error: "html2canvas failed",
            });

            const result = await screenshotTool.execute({}, {});

            expect(result.success).toBe(false);
            expect(result.error).toBe("html2canvas failed");
        });

        it("should handle missing result from content script", async () => {
            chromeMock.tabs.query.mockResolvedValue([{ id: 1, title: "Test" }]);
            chromeMock.tabs.sendMessage.mockResolvedValue(undefined);

            const result = await screenshotTool.execute({}, {});

            expect(result.success).toBe(false);
            expect(result.error).toBe("Failed to capture screenshot");
        });

        it("should handle null result from content script", async () => {
            chromeMock.tabs.query.mockResolvedValue([{ id: 1, title: "Test" }]);
            chromeMock.tabs.sendMessage.mockResolvedValue(null);

            const result = await screenshotTool.execute({}, {});

            expect(result.success).toBe(false);
            expect(result.error).toBe("Failed to capture screenshot");
        });

        it("should handle connection errors for restricted pages", async () => {
            chromeMock.tabs.query.mockResolvedValue([{ id: 1, title: "Chrome Settings" }]);
            chromeMock.tabs.sendMessage.mockRejectedValue(
                new Error("Could not establish connection. Receiving end does not exist.")
            );

            const result = await screenshotTool.execute({}, {});

            expect(result.success).toBe(false);
            expect(result.error).toContain("restricted page");
        });

        it("should always return format as jpeg and quality as 92", async () => {
            chromeMock.tabs.query.mockResolvedValue([{ id: 1, title: "Test", url: "https://test.com" }]);
            chromeMock.tabs.sendMessage.mockResolvedValue({
                success: true,
                dataUrl: "data:image/jpeg;base64,test",
                width: 800,
                height: 600,
                originalWidth: 1600,
                originalHeight: 1200,
                fullPage: false,
            });

            const result = await screenshotTool.execute({}, {});

            expect(result.data?.format).toBe("jpeg");
            expect(result.data?.quality).toBe(92);
            expect(result.data?.fullPage).toBe(false);
        });

        it("should pass fullPage flag to content script", async () => {
            chromeMock.tabs.query.mockResolvedValue([{ id: 1, title: "Test", url: "https://test.com" }]);
            chromeMock.tabs.sendMessage.mockResolvedValue({
                success: true,
                dataUrl: "data:image/jpeg;base64,test",
                width: 800,
                height: 600,
                fullPage: true,
            });

            await screenshotTool.execute({ fullPage: true }, {});

            expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(1, {
                type: "CAPTURE_SCREENSHOT",
                fullPage: true,
            });
        });
    });
});
