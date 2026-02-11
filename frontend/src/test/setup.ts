import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Cleanup after each test (only in jsdom environment)
afterEach(() => {
    cleanup();
});

// Only set up browser mocks if we're in a browser-like environment
if (typeof window !== 'undefined') {
    // Mock chrome APIs for jsdom environment
    vi.stubGlobal('chrome', {
        storage: {
            local: {
                get: vi.fn((_keys: unknown, callback?: (result: object) => void) => {
                    const result = {};
                    if (typeof callback === "function") {
                        callback(result);
                        return;
                    }
                    return Promise.resolve(result);
                }),
                set: vi.fn((_items: unknown, callback?: () => void) => {
                    callback?.();
                }),
            },
        },
        tabs: {
            query: vi.fn(() => Promise.resolve([])),
            create: vi.fn(),
        },
        runtime: {
            getURL: vi.fn((path: string) => `chrome-extension://mock/${path}`),
        },
    });

    // Mock ResizeObserver for components that use it
    vi.stubGlobal('ResizeObserver', class ResizeObserver {
        observe() { }
        unobserve() { }
        disconnect() { }
    });

    // Mock IntersectionObserver
    vi.stubGlobal('IntersectionObserver', class IntersectionObserver {
        constructor() { }
        observe() { }
        unobserve() { }
        disconnect() { }
    });

    // Mock matchMedia
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockImplementation((query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })),
    });
}
