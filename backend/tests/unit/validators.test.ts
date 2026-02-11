/**
 * Unit Tests for Validation Schemas
 */

import { describe, it, expect } from "vitest";
import { validateUserId, validateObjectId, putObjectBodySchema, mcpProxyBodySchema } from "../../src/validators/schemas";

describe("validateUserId", () => {
    it("should accept valid 64-char hex string", () => {
        expect(validateUserId("a".repeat(64))).toBe(true);
        expect(validateUserId("0123456789abcdef".repeat(4))).toBe(true);
    });

    it("should reject invalid formats", () => {
        expect(validateUserId("")).toBe(false);
        expect(validateUserId("a".repeat(63))).toBe(false);
        expect(validateUserId("a".repeat(65))).toBe(false);
        expect(validateUserId("A".repeat(64))).toBe(false); // uppercase
        expect(validateUserId("g".repeat(64))).toBe(false); // invalid hex
    });
});

describe("validateObjectId", () => {
    it("should accept valid object IDs", () => {
        expect(validateObjectId("settings")).toBe(true);
        expect(validateObjectId("chat-550e8400-e29b-41d4-a716-446655440000")).toBe(true);
        expect(validateObjectId("my_object_123")).toBe(true);
        expect(validateObjectId("a")).toBe(true);
        expect(validateObjectId("a".repeat(128))).toBe(true);
    });

    it("should reject invalid formats", () => {
        expect(validateObjectId("")).toBe(false);
        expect(validateObjectId("a".repeat(129))).toBe(false);
        expect(validateObjectId("has space")).toBe(false);
        expect(validateObjectId("has.dot")).toBe(false);
        expect(validateObjectId("has/slash")).toBe(false);
    });
});

describe("putObjectBodySchema", () => {
    it("should accept valid body", () => {
        const result = putObjectBodySchema.safeParse({ data: "base64data" });
        expect(result.success).toBe(true);
    });

    it("should accept body with lastModified", () => {
        const result = putObjectBodySchema.safeParse({ data: "base64data", lastModified: 1234567890 });
        expect(result.success).toBe(true);
    });

    it("should reject missing data", () => {
        const result = putObjectBodySchema.safeParse({});
        expect(result.success).toBe(false);
    });

    it("should reject empty data", () => {
        const result = putObjectBodySchema.safeParse({ data: "" });
        expect(result.success).toBe(false);
    });
});

describe("mcpProxyBodySchema", () => {
    it("should accept valid body", () => {
        const result = mcpProxyBodySchema.safeParse({
            targetUrl: "https://example.com/mcp",
            body: { method: "tools/list" },
        });
        expect(result.success).toBe(true);
    });

    it("should accept body with headers", () => {
        const result = mcpProxyBodySchema.safeParse({
            targetUrl: "https://example.com/mcp",
            body: {},
            headers: { "X-Custom": "value" },
        });
        expect(result.success).toBe(true);
    });

    it("should reject invalid URL", () => {
        const result = mcpProxyBodySchema.safeParse({
            targetUrl: "not-a-url",
            body: {},
        });
        expect(result.success).toBe(false);
    });

    it("should reject missing fields", () => {
        expect(mcpProxyBodySchema.safeParse({}).success).toBe(false);
        // Note: body is z.unknown() so it accepts any value including undefined
        // The targetUrl is required though
        expect(mcpProxyBodySchema.safeParse({ body: {} }).success).toBe(false);
    });
});
