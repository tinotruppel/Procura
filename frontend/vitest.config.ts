import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
    test: {
        globals: true,
        environment: "jsdom",
        setupFiles: ["./src/test/setup.ts"],
        // Run crypto-based tests in node environment (jsdom's crypto.subtle differs)
        environmentMatchGlobs: [
            ["src/lib/sync-*.test.ts", "node"],
            ["src/lib/embeddings.test.ts", "node"],
        ],
        coverage: {
            provider: "v8",
            reporter: ["text", "html"],
            exclude: [
                "node_modules/**",
                "dist/**",
                "dist-pwa/**",
                "dist-extension/**",
                "**/*.test.ts",
                "**/*.test.tsx",
                "**/*.d.ts",
                // Test setup files
                "src/test/**",
                // Entry points
                "src/main.tsx",
                "src/background.ts",
                "src/index.css",
                // MCP modules - complex OAuth flows, SSE streaming, type definitions
                "src/lib/mcp-oauth.ts",
                "src/lib/mcp-types.ts",
                "src/lib/mcp-client.ts",
                // Config files
                "*.config.*",
                // Chrome-only / browser-dependent (covered by E2E, not unit-testable)
                "src/components/SecurityGate.tsx",
                "src/components/MarpitSlides.tsx",
                "src/tools/memory.ts",
                "src/tools/read-page.ts",
                "src/lib/vault.ts",
                // Complex UI components (need integration/E2E tests, not unit-testable)
                "src/components/Chat.tsx",
                "src/components/MessageList.tsx",
                "src/components/Settings.tsx",
                "src/components/SyncSettings.tsx",
                "src/components/MermaidDiagram.tsx",
                "src/components/ui/dropdown-menu.tsx",
                // Chrome extension tools (chrome.scripting/chrome.tabs dependent)
                "src/tools/web-interaction.ts",
                "src/tools/geolocation.ts",
                "src/platform/chrome.ts",
                // Storage submodules (vault-dependent, DOM-dependent, or trivial re-exports)
                "src/lib/storage/index.ts",
                "src/lib/storage/vault-migration.ts",
                "src/lib/storage/debug.ts",
                "src/lib/storage/ui-settings.ts",
                "src/lib/storage/metadata.ts",
            ],
            thresholds: {
                statements: 70,
                branches: 65,
                functions: 70,
                lines: 70,
            },
        },
    },
    resolve: {
        alias: {
            "@": resolve(__dirname, "./src"),
        },
    },
});
