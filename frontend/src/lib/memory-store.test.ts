/**
 * Tests for Memory Store
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    getMemoryEntries,
    getMemoryEntry,
    setMemoryEntry,
    deleteMemoryEntry,
    clearAllMemory,
    getMemoryStore,
    setMemoryStore,
    getMemoryLastModified,
    setMemoryLastModified,
    getMemoryEntryCount,
    MemoryStore,
} from "./memory-store";

// Mock the platform module
vi.mock("@/platform", () => ({
    platform: {
        storage: {
            get: vi.fn(),
            set: vi.fn(),
        },
    },
}));

import { platform } from "@/platform";

const mockStorage = platform.storage as {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
};

describe("memory-store", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockStorage.set.mockResolvedValue(undefined);
    });

    describe("getMemoryEntries", () => {
        it("should return empty array for unknown promptId", async () => {
            mockStorage.get.mockResolvedValue({ procura_memory_store: {} });

            const entries = await getMemoryEntries("unknown-prompt");
            expect(entries).toEqual([]);
        });

        it("should return entries for existing promptId", async () => {
            const mockEntries = [
                { key: "name", value: "John", createdAt: 1000, updatedAt: 1000 },
            ];
            mockStorage.get.mockResolvedValue({
                procura_memory_store: { "prompt-1": mockEntries },
            });

            const entries = await getMemoryEntries("prompt-1");
            expect(entries).toEqual(mockEntries);
        });

        it("should handle empty storage", async () => {
            mockStorage.get.mockResolvedValue({});

            const entries = await getMemoryEntries("any-prompt");
            expect(entries).toEqual([]);
        });
    });

    describe("getMemoryEntry", () => {
        it("should return null for non-existent key", async () => {
            mockStorage.get.mockResolvedValue({ procura_memory_store: {} });

            const entry = await getMemoryEntry("prompt-1", "missing-key");
            expect(entry).toBeNull();
        });

        it("should return entry for existing key", async () => {
            const mockEntry = { key: "name", value: "Alice", createdAt: 1000, updatedAt: 2000 };
            mockStorage.get.mockResolvedValue({
                procura_memory_store: { "prompt-1": [mockEntry] },
            });

            const entry = await getMemoryEntry("prompt-1", "name");
            expect(entry).toEqual(mockEntry);
        });

        it("should find correct entry among multiple", async () => {
            const entries = [
                { key: "a", value: "1", createdAt: 1000, updatedAt: 1000 },
                { key: "b", value: "2", createdAt: 1000, updatedAt: 1000 },
                { key: "c", value: "3", createdAt: 1000, updatedAt: 1000 },
            ];
            mockStorage.get.mockResolvedValue({
                procura_memory_store: { "prompt-1": entries },
            });

            const entry = await getMemoryEntry("prompt-1", "b");
            expect(entry?.value).toBe("2");
        });
    });

    describe("setMemoryEntry", () => {
        it("should create new entry in empty store", async () => {
            mockStorage.get.mockResolvedValue({ procura_memory_store: {} });
            const now = Date.now();
            vi.setSystemTime(now);

            await setMemoryEntry("prompt-1", "name", "Bob");

            expect(mockStorage.set).toHaveBeenCalledWith({
                procura_memory_store: {
                    "prompt-1": [
                        { key: "name", value: "Bob", createdAt: now, updatedAt: now },
                    ],
                },
                procura_memory_last_modified: now,
            });
        });

        it("should update existing entry", async () => {
            const existingEntry = { key: "name", value: "Old", createdAt: 1000, updatedAt: 1000 };
            mockStorage.get.mockResolvedValue({
                procura_memory_store: { "prompt-1": [existingEntry] },
            });
            const now = 2000;
            vi.setSystemTime(now);

            await setMemoryEntry("prompt-1", "name", "New");

            expect(mockStorage.set).toHaveBeenCalledWith({
                procura_memory_store: {
                    "prompt-1": [
                        { key: "name", value: "New", createdAt: 1000, updatedAt: now },
                    ],
                },
                procura_memory_last_modified: now,
            });
        });

        it("should add new entry alongside existing ones", async () => {
            const existingEntry = { key: "a", value: "1", createdAt: 1000, updatedAt: 1000 };
            mockStorage.get.mockResolvedValue({
                procura_memory_store: { "prompt-1": [existingEntry] },
            });
            const now = 2000;
            vi.setSystemTime(now);

            await setMemoryEntry("prompt-1", "b", "2");

            const savedStore = mockStorage.set.mock.calls[0][0].procura_memory_store;
            expect(savedStore["prompt-1"]).toHaveLength(2);
            expect(savedStore["prompt-1"][1]).toEqual({
                key: "b",
                value: "2",
                createdAt: now,
                updatedAt: now,
            });
        });
    });

    describe("deleteMemoryEntry", () => {
        it("should return false when key does not exist", async () => {
            mockStorage.get.mockResolvedValue({ procura_memory_store: {} });

            const result = await deleteMemoryEntry("prompt-1", "missing");
            expect(result).toBe(false);
        });

        it("should delete entry and return true", async () => {
            const entries = [
                { key: "a", value: "1", createdAt: 1000, updatedAt: 1000 },
                { key: "b", value: "2", createdAt: 1000, updatedAt: 1000 },
            ];
            mockStorage.get.mockResolvedValue({
                procura_memory_store: { "prompt-1": entries },
            });

            const result = await deleteMemoryEntry("prompt-1", "a");

            expect(result).toBe(true);
            const savedStore = mockStorage.set.mock.calls[0][0].procura_memory_store;
            expect(savedStore["prompt-1"]).toHaveLength(1);
            expect(savedStore["prompt-1"][0].key).toBe("b");
        });

        it("should remove promptId when last entry is deleted", async () => {
            const entries = [{ key: "only", value: "1", createdAt: 1000, updatedAt: 1000 }];
            mockStorage.get.mockResolvedValue({
                procura_memory_store: { "prompt-1": entries },
            });

            await deleteMemoryEntry("prompt-1", "only");

            const savedStore = mockStorage.set.mock.calls[0][0].procura_memory_store;
            expect(savedStore["prompt-1"]).toBeUndefined();
        });
    });

    describe("clearAllMemory", () => {
        it("should clear entire store", async () => {
            const now = Date.now();
            vi.setSystemTime(now);

            await clearAllMemory();

            expect(mockStorage.set).toHaveBeenCalledWith({
                procura_memory_store: {},
                procura_memory_last_modified: now,
            });
        });
    });

    describe("getMemoryStore / setMemoryStore", () => {
        it("should get entire store", async () => {
            const store: MemoryStore = {
                "prompt-1": [{ key: "a", value: "1", createdAt: 1000, updatedAt: 1000 }],
            };
            mockStorage.get.mockResolvedValue({ procura_memory_store: store });

            const result = await getMemoryStore();
            expect(result).toEqual(store);
        });

        it("should set entire store", async () => {
            const store: MemoryStore = {
                "prompt-1": [{ key: "x", value: "y", createdAt: 500, updatedAt: 500 }],
            };
            const now = Date.now();
            vi.setSystemTime(now);

            await setMemoryStore(store);

            expect(mockStorage.set).toHaveBeenCalledWith({
                procura_memory_store: store,
                procura_memory_last_modified: now,
            });
        });
    });

    describe("getMemoryLastModified / setMemoryLastModified", () => {
        it("should return 0 when not set", async () => {
            mockStorage.get.mockResolvedValue({});

            const result = await getMemoryLastModified();
            expect(result).toBe(0);
        });

        it("should return stored timestamp", async () => {
            mockStorage.get.mockResolvedValue({ procura_memory_last_modified: 12345 });

            const result = await getMemoryLastModified();
            expect(result).toBe(12345);
        });

        it("should set timestamp", async () => {
            await setMemoryLastModified(99999);

            expect(mockStorage.set).toHaveBeenCalledWith({
                procura_memory_last_modified: 99999,
            });
        });
    });

    describe("getMemoryEntryCount", () => {
        it("should return 0 for empty store", async () => {
            mockStorage.get.mockResolvedValue({ procura_memory_store: {} });

            const count = await getMemoryEntryCount();
            expect(count).toBe(0);
        });

        it("should count entries across all prompts", async () => {
            mockStorage.get.mockResolvedValue({
                procura_memory_store: {
                    "prompt-1": [
                        { key: "a", value: "1", createdAt: 1000, updatedAt: 1000 },
                        { key: "b", value: "2", createdAt: 1000, updatedAt: 1000 },
                    ],
                    "prompt-2": [
                        { key: "c", value: "3", createdAt: 1000, updatedAt: 1000 },
                    ],
                },
            });

            const count = await getMemoryEntryCount();
            expect(count).toBe(3);
        });
    });
});
