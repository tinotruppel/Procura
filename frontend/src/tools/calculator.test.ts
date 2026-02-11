import { describe, it, expect } from "vitest";
import { tokenize, evaluateExpression, MATH_FUNCTIONS, CONSTANTS } from "./calculator";

describe("Calculator Tool", () => {
    describe("tokenize", () => {
        it("should tokenize basic expressions", () => {
            expect(tokenize("125 * 8")).toEqual(["125", "*", "8"]);
            expect(tokenize("10 + 20")).toEqual(["10", "+", "20"]);
            expect(tokenize("5 / 2")).toEqual(["5", "/", "2"]);
        });

        it("should tokenize Unicode operators", () => {
            expect(tokenize("125×8")).toEqual(["125", "*", "8"]);
            expect(tokenize("100÷4")).toEqual(["100", "/", "4"]);
            expect(tokenize("100−50")).toEqual(["100", "-", "50"]);
        });

        it("should tokenize power operator", () => {
            expect(tokenize("2**10")).toEqual(["2", "**", "10"]);
            expect(tokenize("2^10")).toEqual(["2", "^", "10"]);
        });

        it("should tokenize functions", () => {
            expect(tokenize("sqrt(16)")).toEqual(["sqrt", "(", "16", ")"]);
            expect(tokenize("sin(PI)")).toEqual(["sin", "(", "PI", ")"]);
        });
    });

    describe("evaluateExpression", () => {
        it("should evaluate basic arithmetic", () => {
            expect(evaluateExpression("125 * 8")).toBe(1000);
            expect(evaluateExpression("10 + 20")).toBe(30);
            expect(evaluateExpression("100 / 4")).toBe(25);
            expect(evaluateExpression("50 - 25")).toBe(25);
        });

        it("should handle parentheses", () => {
            expect(evaluateExpression("(10 + 5) * 2")).toBe(30);
            expect(evaluateExpression("100 / (4 + 1)")).toBe(20);
        });

        it("should handle decimals", () => {
            expect(evaluateExpression("10.5 * 2")).toBe(21);
            expect(evaluateExpression("3.14159 * 2")).toBeCloseTo(6.28318, 4);
        });

        it("should handle Unicode operators", () => {
            expect(evaluateExpression("125×8")).toBe(1000);
            expect(evaluateExpression("100÷4")).toBe(25);
            expect(evaluateExpression("100−50")).toBe(50);
        });

        it("should handle negative numbers", () => {
            expect(evaluateExpression("-5 + 10")).toBe(5);
            expect(evaluateExpression("10 * -2")).toBe(-20);
        });

        it("should handle exponentiation", () => {
            expect(evaluateExpression("2**10")).toBe(1024);
            expect(evaluateExpression("2^8")).toBe(256);
            expect(evaluateExpression("194766**0.5")).toBeCloseTo(441.324, 2);
        });

        it("should handle math functions", () => {
            expect(evaluateExpression("sqrt(16)")).toBe(4);
            expect(evaluateExpression("sqrt(194766)")).toBeCloseTo(441.324, 2);
            expect(evaluateExpression("abs(-42)")).toBe(42);
            expect(evaluateExpression("floor(3.7)")).toBe(3);
            expect(evaluateExpression("ceil(3.2)")).toBe(4);
            expect(evaluateExpression("round(3.5)")).toBe(4);
        });

        it("should handle trigonometric functions", () => {
            expect(evaluateExpression("sin(0)")).toBe(0);
            expect(evaluateExpression("cos(0)")).toBe(1);
        });

        it("should handle constants", () => {
            expect(evaluateExpression("PI")).toBeCloseTo(3.14159, 4);
            expect(evaluateExpression("E")).toBeCloseTo(2.71828, 4);
            expect(evaluateExpression("sin(PI/2)")).toBeCloseTo(1, 5);
        });

        it("should handle multi-argument functions", () => {
            expect(evaluateExpression("pow(2, 8)")).toBe(256);
            expect(evaluateExpression("min(5, 3, 8)")).toBe(3);
            expect(evaluateExpression("max(5, 3, 8)")).toBe(8);
        });

        it("should handle thousand separators", () => {
            expect(evaluateExpression("1,000 * 2")).toBe(2000);
            expect(evaluateExpression("1,234,567")).toBe(1234567);
        });

        it("should reject invalid expressions", () => {
            expect(() => evaluateExpression("abc")).toThrow();
            expect(() => evaluateExpression("10 + x")).toThrow();
        });
    });

    describe("exports", () => {
        it("should export MATH_FUNCTIONS", () => {
            expect(MATH_FUNCTIONS).toBeDefined();
            expect(MATH_FUNCTIONS.sqrt).toBe(Math.sqrt);
        });

        it("should export CONSTANTS", () => {
            expect(CONSTANTS).toBeDefined();
            expect(CONSTANTS.PI).toBe(Math.PI);
        });
    });
});
