import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import sonarjs from "eslint-plugin-sonarjs";

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    sonarjs.configs.recommended,
    {
        ignores: ["dist/**", "dist-pwa/**", "dist-extension/**", "coverage/**", "node_modules/**", "*.config.*", "src/test/**"],
    },
    {
        // Main source files
        files: ["src/**/*.ts", "src/**/*.tsx"],
        ignores: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx"],
        languageOptions: {
            parserOptions: {
                project: true,
            },
        },
        rules: {
            // --- Smells / Maintainability gates (warnings for gradual improvement) ---
            // Increased limits to be more pragmatic for tool implementations with large switch statements
            "complexity": ["warn", 50],
            "max-depth": ["warn", 9],
            "max-nested-callbacks": ["warn", 4],
            "max-params": ["warn", 9],
            "max-statements": ["warn", 120],
            "max-lines-per-function": ["warn", { max: 800, skipBlankLines: true, skipComments: true }],
            "sonarjs/cognitive-complexity": ["warn", 60],
            "sonarjs/no-nested-functions": "warn",

            // --- Common bug prevention ---
            "no-console": "off", // Extension uses console.log extensively

            // --- TypeScript overrides ---
            "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/no-empty-object-type": "off", // Used in UI components

            // --- SonarJS relaxations ---
            "sonarjs/prefer-read-only-props": "off", // Too strict for React
            "sonarjs/no-useless-catch": "warn",
            "sonarjs/prefer-regexp-exec": "warn",
            "sonarjs/deprecation": "warn",
            "sonarjs/different-types-comparison": "warn",
            "sonarjs/duplicates-in-character-class": "warn",
        },
    },
    {
        // Test files - relaxed rules
        files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx"],
        rules: {
            "max-lines-per-function": "off",
            "max-statements": "off",
            "max-nested-callbacks": "off",
            "sonarjs/no-duplicate-string": "off",
            "sonarjs/no-nested-functions": "off",
            "sonarjs/no-clear-text-protocols": "off", // Test URLs are fine with http
            "sonarjs/unused-import": "warn",
            "sonarjs/no-unused-vars": "off",
            "sonarjs/no-dead-store": "off",
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-unused-vars": "warn",
        },
    },
);
