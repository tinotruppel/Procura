import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import sonarjs from "eslint-plugin-sonarjs";

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    sonarjs.configs.recommended,
    {
        ignores: ["dist/**", "coverage/**", "node_modules/**", "*.config.*"],
    },
    {
        // Main source files
        files: ["src/**/*.ts"],
        ignores: ["**/*.test.ts"],
        languageOptions: {
            parserOptions: {
                project: true,
            },
        },
        rules: {
            // --- Maintainability gates ---
            "complexity": ["warn", 30],
            "max-depth": ["warn", 6],
            "max-nested-callbacks": ["warn", 4],
            "max-params": ["warn", 6],
            "max-statements": ["warn", 80],
            "max-lines-per-function": ["warn", { max: 400, skipBlankLines: true, skipComments: true }],
            "sonarjs/cognitive-complexity": ["warn", 40],
            "sonarjs/no-nested-functions": "warn",

            // --- Common ---
            "no-console": "off", // Server uses console.log for logging

            // --- TypeScript ---
            "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
            "@typescript-eslint/no-explicit-any": "warn",

            // --- SonarJS relaxations ---
            "sonarjs/no-useless-catch": "warn",
            "sonarjs/prefer-regexp-exec": "warn",
            "sonarjs/deprecation": "warn",
            "sonarjs/different-types-comparison": "warn",
        },
    },
    {
        // Test files - relaxed rules
        files: ["**/*.test.ts"],
        rules: {
            "max-lines-per-function": "off",
            "max-statements": "off",
            "max-nested-callbacks": "off",
            "sonarjs/no-duplicate-string": "off",
            "sonarjs/no-nested-functions": "off",
            "sonarjs/no-clear-text-protocols": "off",
            "sonarjs/no-hardcoded-ip": "off", // Test fixtures use mock IPs
            "sonarjs/no-hardcoded-passwords": "off", // Test fixtures use mock passwords
            "sonarjs/no-nested-template-literals": "off",
            "no-useless-escape": "off",
            "sonarjs/unused-import": "warn",
            "sonarjs/no-unused-vars": "off",
            "sonarjs/no-dead-store": "off",
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-unused-vars": "warn",
        },
    },
);
