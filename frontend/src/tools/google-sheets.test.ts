import { describe, it, expect, vi, beforeEach } from "vitest";

let googleSheetsTool: typeof import("./google-sheets").googleSheetsTool;
const getData = (result: { data?: unknown }) => result.data as any;

// Mock @/platform to always return extension mode for these tests
vi.mock("@/platform", () => ({
    isExtension: vi.fn(() => true),
    isWeb: vi.fn(() => false),
}));

// Mock chrome.identity API for launchWebAuthFlow
const mockLaunchWebAuthFlow = vi.fn();
const mockGetRedirectURL = vi.fn(() => "https://abcdefgh.chromiumapp.org/");
vi.stubGlobal("chrome", {
    identity: {
        launchWebAuthFlow: mockLaunchWebAuthFlow,
        getRedirectURL: mockGetRedirectURL,
    },
});

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("googleSheetsTool", () => {
    const mockConfig = {
        clientId: "test-client-id.apps.googleusercontent.com",
    };

    beforeEach(async () => {
        vi.clearAllMocks();
        // Mock successful OAuth flow - returns URL with token in hash
        mockLaunchWebAuthFlow.mockResolvedValue(
            "https://abcdefgh.chromiumapp.org/#access_token=mock-token&expires_in=3600"
        );

        vi.resetModules();
        ({ googleSheetsTool } = await import("./google-sheets"));
    });

    describe("metadata", () => {
        it("should have correct name", () => {
            expect(googleSheetsTool.name).toBe("google_sheets");
        });

        it("should be disabled by default", () => {
            expect(googleSheetsTool.enabledByDefault).toBe(false);
        });

        it("should have required operation parameter", () => {
            expect(googleSheetsTool.schema.parameters?.required).toContain("operation");
        });
    });

    describe("validation", () => {
        it("should fail when clientId is not configured", async () => {
            const result = await googleSheetsTool.execute(
                { operation: "list_spreadsheets" },
                { clientId: "" }
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("Client ID not configured");
        });

        it("should fail for unknown operation", async () => {
            const result = await googleSheetsTool.execute(
                { operation: "unknown" },
                mockConfig
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("Unknown operation");
        });
    });

    describe("list_spreadsheets", () => {
        it("should list spreadsheets successfully", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    files: [
                        { id: "sheet1", name: "Spreadsheet 1", modifiedTime: "2024-01-01", webViewLink: "https://docs.google.com/spreadsheets/d/sheet1" },
                        { id: "sheet2", name: "Spreadsheet 2", modifiedTime: "2024-01-02", webViewLink: "https://docs.google.com/spreadsheets/d/sheet2" },
                    ]
                }),
            });

            const result = await googleSheetsTool.execute(
                { operation: "list_spreadsheets" },
                mockConfig
            );

            expect(result.success).toBe(true);
            expect(getData(result).spreadsheets).toHaveLength(2);
            expect(getData(result).count).toBe(2);
        });

        it("should handle empty list", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ files: [] }),
            });

            const result = await googleSheetsTool.execute(
                { operation: "list_spreadsheets" },
                mockConfig
            );

            expect(result.success).toBe(true);
            expect(getData(result).spreadsheets).toHaveLength(0);
        });

        it("should handle API error", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 403,
                json: () => Promise.resolve({ error: { message: "Access denied" } }),
            });

            const result = await googleSheetsTool.execute(
                { operation: "list_spreadsheets" },
                mockConfig
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("Access denied");
        });
    });

    describe("get_spreadsheet", () => {
        it("should get spreadsheet metadata successfully", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    spreadsheetId: "sheet123",
                    properties: { title: "My Spreadsheet", locale: "en_US" },
                    sheets: [
                        { properties: { sheetId: 0, title: "Sheet1", index: 0, gridProperties: { rowCount: 1000, columnCount: 26 } } },
                        { properties: { sheetId: 1, title: "Sheet2", index: 1, gridProperties: { rowCount: 500, columnCount: 10 } } },
                    ]
                }),
            });

            const result = await googleSheetsTool.execute(
                { operation: "get_spreadsheet", spreadsheetId: "sheet123" },
                mockConfig
            );

            expect(result.success).toBe(true);
            expect(getData(result).title).toBe("My Spreadsheet");
            expect(getData(result).sheets).toHaveLength(2);
            expect(getData(result).sheets[0].title).toBe("Sheet1");
        });

        it("should fail without spreadsheetId", async () => {
            const result = await googleSheetsTool.execute(
                { operation: "get_spreadsheet" },
                mockConfig
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("spreadsheetId is required");
        });

        it("should handle not found error", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 404,
                json: () => Promise.resolve({ error: { message: "Spreadsheet not found" } }),
            });

            const result = await googleSheetsTool.execute(
                { operation: "get_spreadsheet", spreadsheetId: "invalid" },
                mockConfig
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("not found");
        });
    });

    describe("create_spreadsheet", () => {
        it("should create spreadsheet successfully", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    spreadsheetId: "new-sheet-id",
                    properties: { title: "New Spreadsheet" },
                    spreadsheetUrl: "https://docs.google.com/spreadsheets/d/new-sheet-id",
                    sheets: [{ properties: { sheetId: 0, title: "Sheet1" } }]
                }),
            });

            const result = await googleSheetsTool.execute(
                { operation: "create_spreadsheet", title: "New Spreadsheet" },
                mockConfig
            );

            expect(result.success).toBe(true);
            expect(getData(result).spreadsheetId).toBe("new-sheet-id");
            expect(getData(result).title).toBe("New Spreadsheet");
            expect(getData(result).url).toContain("new-sheet-id");
        });

        it("should create spreadsheet with custom sheet title", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    spreadsheetId: "new-sheet-id",
                    properties: { title: "Budget 2024" },
                    spreadsheetUrl: "https://docs.google.com/spreadsheets/d/new-sheet-id",
                    sheets: [{ properties: { sheetId: 0, title: "January" } }]
                }),
            });

            const result = await googleSheetsTool.execute(
                { operation: "create_spreadsheet", title: "Budget 2024", sheetTitle: "January" },
                mockConfig
            );

            expect(result.success).toBe(true);
            expect(getData(result).sheets[0]?.title).toBe("January");
        });

        it("should fail without title", async () => {
            const result = await googleSheetsTool.execute(
                { operation: "create_spreadsheet" },
                mockConfig
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("title is required");
        });
    });

    describe("read_values", () => {
        it("should read values successfully", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    range: "Sheet1!A1:C3",
                    values: [
                        ["Name", "Age", "City"],
                        ["Alice", "30", "Berlin"],
                        ["Bob", "25", "Munich"],
                    ]
                }),
            });

            const result = await googleSheetsTool.execute(
                { operation: "read_values", spreadsheetId: "sheet123", range: "Sheet1!A1:C3" },
                mockConfig
            );

            expect(result.success).toBe(true);
            expect(getData(result).values).toHaveLength(3);
            expect(getData(result).rowCount).toBe(3);
            expect(getData(result).columnCount).toBe(3);
        });

        it("should handle empty range", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    range: "Sheet1!A1:C3",
                    // no values property when empty
                }),
            });

            const result = await googleSheetsTool.execute(
                { operation: "read_values", spreadsheetId: "sheet123", range: "Sheet1!A1:C3" },
                mockConfig
            );

            expect(result.success).toBe(true);
            expect(getData(result).values).toHaveLength(0);
        });

        it("should fail without spreadsheetId", async () => {
            const result = await googleSheetsTool.execute(
                { operation: "read_values", range: "A1:C3" },
                mockConfig
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("spreadsheetId is required");
        });

        it("should fail without range", async () => {
            const result = await googleSheetsTool.execute(
                { operation: "read_values", spreadsheetId: "sheet123" },
                mockConfig
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("range is required");
        });
    });

    describe("write_values", () => {
        it("should write values successfully", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    updatedRange: "Sheet1!A1:C2",
                    updatedRows: 2,
                    updatedColumns: 3,
                    updatedCells: 6,
                }),
            });

            const result = await googleSheetsTool.execute(
                {
                    operation: "write_values",
                    spreadsheetId: "sheet123",
                    range: "Sheet1!A1:C2",
                    values: [["A", "B", "C"], ["1", "2", "3"]]
                },
                mockConfig
            );

            expect(result.success).toBe(true);
            expect(getData(result).updatedCells).toBe(6);
            expect(getData(result).updatedRows).toBe(2);
        });

        it("should fail without values", async () => {
            const result = await googleSheetsTool.execute(
                { operation: "write_values", spreadsheetId: "sheet123", range: "A1:C2" },
                mockConfig
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("values");
        });

        it("should fail without spreadsheetId", async () => {
            const result = await googleSheetsTool.execute(
                { operation: "write_values", range: "A1:C2", values: [["test"]] },
                mockConfig
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("spreadsheetId is required");
        });

        it("should fail without range", async () => {
            const result = await googleSheetsTool.execute(
                { operation: "write_values", spreadsheetId: "sheet123", values: [["test"]] },
                mockConfig
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("range is required");
        });

        it("should fill range with fillValue using existing data dimensions", async () => {
            // First call reads the range to get dimensions
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    range: "Sheet1!G1:G10",
                    values: [["data1"], ["data2"], ["data3"], ["data4"], ["data5"]],
                }),
            });
            // Second call writes the filled values
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    updatedRange: "Sheet1!G1:G5",
                    updatedRows: 5,
                    updatedColumns: 1,
                    updatedCells: 5,
                }),
            });

            const result = await googleSheetsTool.execute(
                {
                    operation: "write_values",
                    spreadsheetId: "sheet123",
                    range: "Sheet1!G1:G10",
                    fillValue: ""
                },
                mockConfig
            );

            expect(result.success).toBe(true);
            expect(getData(result).updatedCells).toBe(5);
            expect(getData(result).filledWithValue).toBe("");
        });

        it("should fill range with fillValue parsing A1 notation when range is empty", async () => {
            // First call reads the range - returns empty
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    range: "Sheet1!A1:C3",
                }),
            });
            // Second call writes the filled values
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    updatedRange: "Sheet1!A1:C3",
                    updatedRows: 3,
                    updatedColumns: 3,
                    updatedCells: 9,
                }),
            });

            const result = await googleSheetsTool.execute(
                {
                    operation: "write_values",
                    spreadsheetId: "sheet123",
                    range: "Sheet1!A1:C3",
                    fillValue: "0"
                },
                mockConfig
            );

            expect(result.success).toBe(true);
            expect(getData(result).updatedCells).toBe(9);
            expect(getData(result).filledWithValue).toBe("0");
        });
    });

    describe("append_rows", () => {
        it("should append rows successfully", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    updates: {
                        updatedRange: "Sheet1!A4:C5",
                        updatedRows: 2,
                        updatedColumns: 3,
                        updatedCells: 6,
                    }
                }),
            });

            const result = await googleSheetsTool.execute(
                {
                    operation: "append_rows",
                    spreadsheetId: "sheet123",
                    range: "Sheet1",
                    values: [["New1", "New2", "New3"], ["New4", "New5", "New6"]]
                },
                mockConfig
            );

            expect(result.success).toBe(true);
            expect(getData(result).updatedRows).toBe(2);
            expect(getData(result).updatedCells).toBe(6);
        });

        it("should fail without values", async () => {
            const result = await googleSheetsTool.execute(
                { operation: "append_rows", spreadsheetId: "sheet123", range: "Sheet1" },
                mockConfig
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("values");
        });

        it("should fail without spreadsheetId", async () => {
            const result = await googleSheetsTool.execute(
                { operation: "append_rows", range: "Sheet1", values: [["test"]] },
                mockConfig
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("spreadsheetId is required");
        });

        it("should fail without range", async () => {
            const result = await googleSheetsTool.execute(
                { operation: "append_rows", spreadsheetId: "sheet123", values: [["test"]] },
                mockConfig
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("range is required");
        });
    });

    describe("OAuth", () => {
        it("should request OAuth token with correct scopes", async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ files: [] }),
            });

            await googleSheetsTool.execute(
                { operation: "list_spreadsheets" },
                mockConfig
            );

            expect(mockLaunchWebAuthFlow).toHaveBeenCalled();
            const authUrl = mockLaunchWebAuthFlow.mock.calls[0][0].url;
            expect(authUrl).toContain("spreadsheets");
        });

        it("should handle OAuth failure", async () => {
            mockLaunchWebAuthFlow.mockRejectedValueOnce(new Error("User cancelled"));

            const result = await googleSheetsTool.execute(
                { operation: "list_spreadsheets" },
                mockConfig
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain("auth token");
        });

        it("should cache OAuth token", async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ files: [] }),
            });

            // First call
            await googleSheetsTool.execute(
                { operation: "list_spreadsheets" },
                mockConfig
            );

            // Second call - should use cached token
            await googleSheetsTool.execute(
                { operation: "list_spreadsheets" },
                mockConfig
            );

            // OAuth flow should only be called once
            expect(mockLaunchWebAuthFlow).toHaveBeenCalledTimes(1);
        });
    });
});
