import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { webPlatform } from "./web";
import { PLATFORM_CAPABILITIES } from "./types";

// Mock IndexedDB
const mockObjectStore = {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    clear: vi.fn(),
};

const mockTransaction = {
    objectStore: vi.fn(() => mockObjectStore),
    oncomplete: null as (() => void) | null,
    onerror: null as (() => void) | null,
};

const mockDB = {
    transaction: vi.fn(() => mockTransaction),
    objectStoreNames: { contains: vi.fn(() => true) },
    createObjectStore: vi.fn(),
};

const mockOpenRequest = {
    result: mockDB,
    error: null as Error | null,
    onsuccess: null as (() => void) | null,
    onerror: null as (() => void) | null,
    onupgradeneeded: null as ((event: unknown) => void) | null,
};

vi.stubGlobal("indexedDB", {
    open: vi.fn(() => {
        setTimeout(() => {
            if (mockOpenRequest.onsuccess) {
                mockOpenRequest.onsuccess();
            }
        }, 0);
        return mockOpenRequest;
    }),
});

// Mock window.open
const mockWindowOpen = vi.fn();
vi.stubGlobal("open", mockWindowOpen);

describe("webPlatform", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockObjectStore.get.mockImplementation(() => {
            const request = {
                result: undefined as unknown,
                onsuccess: null as (() => void) | null,
                onerror: null as (() => void) | null,
            };
            setTimeout(() => request.onsuccess?.(), 0);
            return request;
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("platform identity", () => {
        it("should have name 'web'", () => {
            expect(webPlatform.name).toBe("web");
        });

        it("should have storage", () => {
            expect(webPlatform.storage).toBeDefined();
        });

        it("should have tabs", () => {
            expect(webPlatform.tabs).toBeDefined();
        });
    });

    describe("hasCapability", () => {
        it("should return true for web capabilities", () => {
            for (const cap of PLATFORM_CAPABILITIES.web) {
                expect(webPlatform.hasCapability(cap)).toBe(true);
            }
        });

        it("should return false for non-web capabilities", () => {
            // captureTab is typically not available in web mode
            expect(webPlatform.hasCapability("captureTab")).toBe(false);
        });
    });

    describe("storage.get", () => {
        it("should return empty object for empty keys array", async () => {
            const result = await webPlatform.storage.get([]);
            expect(result).toEqual({});
        });

        it("should call IndexedDB get for single key", async () => {
            mockObjectStore.get.mockImplementation(() => {
                const request = {
                    result: "stored-value",
                    onsuccess: null as (() => void) | null,
                    onerror: null as (() => void) | null,
                };
                setTimeout(() => request.onsuccess?.(), 0);
                return request;
            });

            const result = await webPlatform.storage.get("test-key");
            expect(mockObjectStore.get).toHaveBeenCalledWith("test-key");
            expect(result).toEqual({ "test-key": "stored-value" });
        });

        it("should handle multiple keys", async () => {
            let callCount = 0;
            mockObjectStore.get.mockImplementation(() => {
                callCount++;
                const request = {
                    result: `value-${callCount}`,
                    onsuccess: null as (() => void) | null,
                    onerror: null as (() => void) | null,
                };
                setTimeout(() => request.onsuccess?.(), 0);
                return request;
            });

            const result = await webPlatform.storage.get(["key1", "key2"]);
            expect(result).toEqual({ "key1": "value-1", "key2": "value-2" });
        });

        it("should skip undefined values", async () => {
            mockObjectStore.get.mockImplementation(() => {
                const request = {
                    result: undefined,
                    onsuccess: null as (() => void) | null,
                    onerror: null as (() => void) | null,
                };
                setTimeout(() => request.onsuccess?.(), 0);
                return request;
            });

            const result = await webPlatform.storage.get("missing-key");
            expect(result).toEqual({});
        });
    });

    describe("storage.set", () => {
        it("should call IndexedDB put for each item", async () => {
            mockTransaction.oncomplete = null;
            const setPromise = webPlatform.storage.set({ key1: "val1", key2: "val2" });

            // Trigger transaction complete
            setTimeout(() => mockTransaction.oncomplete?.(), 10);

            await setPromise;
            expect(mockObjectStore.put).toHaveBeenCalledWith("val1", "key1");
            expect(mockObjectStore.put).toHaveBeenCalledWith("val2", "key2");
        });
    });

    describe("storage.remove", () => {
        it("should call IndexedDB delete for single key", async () => {
            const removePromise = webPlatform.storage.remove("del-key");
            setTimeout(() => mockTransaction.oncomplete?.(), 10);

            await removePromise;
            expect(mockObjectStore.delete).toHaveBeenCalledWith("del-key");
        });

        it("should call IndexedDB delete for multiple keys", async () => {
            const removePromise = webPlatform.storage.remove(["key1", "key2"]);
            setTimeout(() => mockTransaction.oncomplete?.(), 10);

            await removePromise;
            expect(mockObjectStore.delete).toHaveBeenCalledWith("key1");
            expect(mockObjectStore.delete).toHaveBeenCalledWith("key2");
        });
    });

    describe("storage.clear", () => {
        it("should call IndexedDB clear", async () => {
            const clearRequest = {
                onsuccess: null as (() => void) | null,
                onerror: null as (() => void) | null,
            };
            mockObjectStore.clear.mockReturnValue(clearRequest);

            const clearPromise = webPlatform.storage.clear();
            setTimeout(() => clearRequest.onsuccess?.(), 10);

            await clearPromise;
            expect(mockObjectStore.clear).toHaveBeenCalled();
        });
    });

    describe("tabs.create", () => {
        it("should open URL in new tab using window.open", async () => {
            await webPlatform.tabs.create("https://example.com");
            expect(mockWindowOpen).toHaveBeenCalledWith("https://example.com", "_blank");
        });
    });
});
