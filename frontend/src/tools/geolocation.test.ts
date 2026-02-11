/**
 * Tests for geolocation.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { geolocationTool } from "./geolocation";

// Mock chrome API
const chromeMock = {
    tabs: {
        query: vi.fn(),
    },
    scripting: {
        executeScript: vi.fn(),
    },
};

vi.stubGlobal("chrome", chromeMock);

describe("geolocationTool", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("metadata", () => {
        it("should have correct name", () => {
            expect(geolocationTool.name).toBe("geolocation");
        });

        it("should be enabled by default", () => {
            expect(geolocationTool.enabledByDefault).toBe(true);
        });

        it("should have empty default config", () => {
            expect(geolocationTool.defaultConfig).toEqual({});
        });

        it("should not require any parameters", () => {
            expect(geolocationTool.schema.parameters.required).toEqual([]);
        });
    });

    describe("execute", () => {
        it("should fail when no active tab found", async () => {
            chromeMock.tabs.query.mockResolvedValue([]);

            const result = await geolocationTool.execute({}, {});

            expect(result.success).toBe(false);
            expect(result.error).toBe("No active tab found");
        });

        it("should fail on chrome:// pages", async () => {
            chromeMock.tabs.query.mockResolvedValue([{
                id: 1,
                url: "chrome://extensions"
            }]);

            const result = await geolocationTool.execute({}, {});

            expect(result.success).toBe(false);
            expect(result.error).toContain("not possible on this page");
        });

        it("should fail on chrome-extension:// pages", async () => {
            chromeMock.tabs.query.mockResolvedValue([{
                id: 1,
                url: "chrome-extension://abc123/popup.html"
            }]);

            const result = await geolocationTool.execute({}, {});

            expect(result.success).toBe(false);
            expect(result.error).toContain("not possible on this page");
        });

        it("should return location data on success", async () => {
            const mockPosition = {
                latitude: 52.52,
                longitude: 13.405,
                accuracy: 10,
                altitude: 100,
                heading: 90,
                speed: 5,
                timestamp: 1704067200000,
            };

            chromeMock.tabs.query.mockResolvedValue([{
                id: 1,
                url: "https://example.com"
            }]);
            chromeMock.scripting.executeScript.mockResolvedValue([{
                result: mockPosition
            }]);

            const result = await geolocationTool.execute({}, {});

            expect(result.success).toBe(true);
            expect(result.data).toEqual({
                latitude: 52.52,
                longitude: 13.405,
                accuracy: "10 m",
                altitude: "100 m",
                heading: 90,
                speed: "18.0 km/h", // 5 m/s * 3.6
                timestamp: expect.any(String),
            });
        });

        it("should handle null altitude and speed", async () => {
            const mockPosition = {
                latitude: 40.71,
                longitude: -74.01,
                accuracy: 50,
                altitude: null,
                heading: null,
                speed: null,
                timestamp: 1704067200000,
            };

            chromeMock.tabs.query.mockResolvedValue([{
                id: 1,
                url: "https://example.com"
            }]);
            chromeMock.scripting.executeScript.mockResolvedValue([{
                result: mockPosition
            }]);

            const result = await geolocationTool.execute({}, {});

            expect(result.success).toBe(true);
            expect(result.data?.altitude).toBeNull();
            expect(result.data?.speed).toBeNull();
        });

        it("should handle script execution errors", async () => {
            chromeMock.tabs.query.mockResolvedValue([{
                id: 1,
                url: "https://example.com"
            }]);
            chromeMock.scripting.executeScript.mockResolvedValue([{
                error: { message: "Permission denied" }
            }]);

            const result = await geolocationTool.execute({}, {});

            expect(result.success).toBe(false);
            expect(result.error).toBe("Permission denied");
        });

        it("should handle empty script results", async () => {
            chromeMock.tabs.query.mockResolvedValue([{
                id: 1,
                url: "https://example.com"
            }]);
            chromeMock.scripting.executeScript.mockResolvedValue([]);

            const result = await geolocationTool.execute({}, {});

            expect(result.success).toBe(false);
            expect(result.error).toContain("Could not execute location script");
        });

        it("should handle missing result data", async () => {
            chromeMock.tabs.query.mockResolvedValue([{
                id: 1,
                url: "https://example.com"
            }]);
            chromeMock.scripting.executeScript.mockResolvedValue([{
                result: null
            }]);

            const result = await geolocationTool.execute({}, {});

            expect(result.success).toBe(false);
            expect(result.error).toContain("No location data");
        });

        it("should handle error in location data response", async () => {
            chromeMock.tabs.query.mockResolvedValue([{
                id: 1,
                url: "https://example.com"
            }]);
            chromeMock.scripting.executeScript.mockResolvedValue([{
                result: { error: "User denied geolocation" }
            }]);

            const result = await geolocationTool.execute({}, {});

            expect(result.success).toBe(false);
            expect(result.error).toBe("User denied geolocation");
        });

        it("should handle invalid location data (missing coordinates)", async () => {
            chromeMock.tabs.query.mockResolvedValue([{
                id: 1,
                url: "https://example.com"
            }]);
            chromeMock.scripting.executeScript.mockResolvedValue([{
                result: { accuracy: 10 } // missing latitude/longitude
            }]);

            const result = await geolocationTool.execute({}, {});

            expect(result.success).toBe(false);
            expect(result.error).toContain("Invalid location data");
        });
    });
});
