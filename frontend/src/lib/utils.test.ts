/**
 * Tests for utils.ts
 */
import { describe, it, expect } from "vitest";
import { cn } from "./utils";

describe("cn (class names utility)", () => {
    it("should merge class names", () => {
        expect(cn("foo", "bar")).toBe("foo bar");
    });

    it("should handle conditional classes", () => {
        // eslint-disable-next-line no-constant-binary-expression, sonarjs/no-redundant-boolean -- intentional constant for test
        expect(cn("foo", false && "bar", "baz")).toBe("foo baz");
    });

    it("should handle undefined and null", () => {
        expect(cn("foo", undefined, null, "bar")).toBe("foo bar");
    });

    it("should merge Tailwind classes correctly", () => {
        expect(cn("px-2", "px-4")).toBe("px-4");
        expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
    });

    it("should handle arrays of classes", () => {
        expect(cn(["foo", "bar"])).toBe("foo bar");
    });

    it("should handle objects of classes", () => {
        expect(cn({ foo: true, bar: false, baz: true })).toBe("foo baz");
    });

    it("should handle empty input", () => {
        expect(cn()).toBe("");
    });
});
