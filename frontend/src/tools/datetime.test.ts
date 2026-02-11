import { describe, it, expect, vi, beforeEach } from "vitest";
import { datetimeTool } from "./datetime";

describe("datetimeTool", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe("schema", () => {
        it("should have correct name", () => {
            expect(datetimeTool.name).toBe("datetime");
        });

        it("should be enabled by default", () => {
            expect(datetimeTool.enabledByDefault).toBe(true);
        });

        it("should have no required parameters", () => {
            expect(datetimeTool.schema.parameters.required).toEqual([]);
        });
    });

    describe("execute", () => {
        it("should return current date and time", async () => {
            // Set a specific date: Monday, January 12, 2026 at 10:30:45
            vi.setSystemTime(new Date(2026, 0, 12, 10, 30, 45));

            const result = await datetimeTool.execute({}, {});

            expect(result.success).toBe(true);
            expect(result.data).toBeDefined();
            expect(result.data?.weekday).toBe("Monday");
            expect(result.data?.day).toBe(12);
            expect(result.data?.month).toBe("January");
            expect(result.data?.monthNumber).toBe(1);
            expect(result.data?.year).toBe(2026);
            expect(result.data?.hours).toBe(10);
            expect(result.data?.minutes).toBe(30);
            expect(result.data?.seconds).toBe(45);
            expect(result.data?.time).toBe("10:30:45");
            expect(result.data?.date).toBe("2026-01-12");
        });

        it("should return formatted string with weekday", async () => {
            vi.setSystemTime(new Date(2026, 0, 12, 10, 30, 45));

            const result = await datetimeTool.execute({}, {});

            expect(result.data?.formatted).toBe("Monday, January 12, 2026 at 10:30");
        });

        it("should return ISO string", async () => {
            vi.setSystemTime(new Date("2026-01-12T10:30:45.000Z"));

            const result = await datetimeTool.execute({}, {});

            expect(result.data?.iso).toContain("2026-01-12");
        });

        it("should return timestamp", async () => {
            const testDate = new Date(2026, 0, 12, 10, 30, 45);
            vi.setSystemTime(testDate);

            const result = await datetimeTool.execute({}, {});

            expect(result.data?.timestamp).toBe(testDate.getTime());
        });

        it("should handle different weekdays", async () => {
            // Test Sunday
            vi.setSystemTime(new Date(2026, 0, 11)); // Sunday
            let result = await datetimeTool.execute({}, {});
            expect(result.data?.weekday).toBe("Sunday");

            // Test Friday
            vi.setSystemTime(new Date(2026, 0, 16)); // Friday
            result = await datetimeTool.execute({}, {});
            expect(result.data?.weekday).toBe("Friday");

            // Test Saturday
            vi.setSystemTime(new Date(2026, 0, 17)); // Saturday
            result = await datetimeTool.execute({}, {});
            expect(result.data?.weekday).toBe("Saturday");
        });

        it("should pad single digit hours/minutes/seconds", async () => {
            vi.setSystemTime(new Date(2026, 0, 12, 5, 3, 7));

            const result = await datetimeTool.execute({}, {});

            expect(result.data?.time).toBe("05:03:07");
        });

        it("should handle different months", async () => {
            vi.setSystemTime(new Date(2026, 6, 15)); // July
            let result = await datetimeTool.execute({}, {});
            expect(result.data?.month).toBe("July");
            expect(result.data?.monthNumber).toBe(7);

            vi.setSystemTime(new Date(2026, 11, 25)); // December
            result = await datetimeTool.execute({}, {});
            expect(result.data?.month).toBe("December");
            expect(result.data?.monthNumber).toBe(12);
        });

        it("should include timezone information", async () => {
            vi.setSystemTime(new Date(2026, 0, 12, 10, 30, 45));

            const result = await datetimeTool.execute({}, {});

            expect(result.data?.timezone).toMatch(/^UTC[+-]\d+$/);
        });

        it("should handle error gracefully", async () => {
            // Make Date constructor throw
            const originalDate = globalThis.Date;
            vi.stubGlobal("Date", function () {
                throw new Error("Date failed");
            });

            const result = await datetimeTool.execute({}, {});

            expect(result.success).toBe(false);
            expect(result.error).toBe("Date failed");

            vi.stubGlobal("Date", originalDate);
        });

        it("should handle non-Error throws gracefully", async () => {
            const originalDate = globalThis.Date;
            vi.stubGlobal("Date", function () {
                throw "string error";
            });

            const result = await datetimeTool.execute({}, {});

            expect(result.success).toBe(false);
            expect(result.error).toBe("Failed to get datetime");

            vi.stubGlobal("Date", originalDate);
        });
    });
});
