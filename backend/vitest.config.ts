import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
    test: {
        globals: true,
        env: {
            DOTENV_CONFIG_PATH: ".env.local",
        },
        coverage: {
            provider: "v8",
            reporter: ["text", "html"],
            exclude: [
                "node_modules/**",
                "dist/**",
                "**/*.test.ts",
                "**/*.d.ts",
                "*.config.*",
                "src/index.ts", // Entry point
                // External API MCP servers (integration-testable, not unit-testable)
                "src/routes/cv-database-mcp.ts",
                "src/routes/document-media-mcp.ts",
                "src/routes/github-mcp.ts",
                "src/routes/google-docs-mcp.ts",
                "src/routes/google-sheets-mcp.ts",
                "src/routes/google-slides-mcp.ts",
                "src/routes/google-oauth.ts",
                "src/routes/image-generation-mcp.ts",
                "src/routes/vector-store-mcp.ts",
                "src/routes/tasks-mcp.ts",
                "src/routes/weather-mcp.ts",
                "src/routes/sync.ts",
                "src/db/**", // DB connection pool (needs real DB)
            ],
            thresholds: {
                statements: 70,
                branches: 70,
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
