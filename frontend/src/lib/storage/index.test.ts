/**
 * Tests for storage.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../vault", () => ({
    isVaultConfigured: vi.fn(() => Promise.resolve(true)),
    isVaultUnlocked: vi.fn(() => true),
    restoreVaultFromSession: vi.fn(() => Promise.resolve(true)),
    getVaultKeyHash: vi.fn(() => Promise.resolve("vault-hash-1")),
    getVaultMeta: vi.fn(() => Promise.resolve({ saltBase64: "test-salt", iterations: 600000 })),
    encryptWithVault: vi.fn(async (value: unknown) => `enc:${btoa(JSON.stringify(value))}`),
    decryptWithVault: vi.fn(async (payload: string) => JSON.parse(atob(payload.replace("enc:", "")))),
}));

// Mock chrome.storage.local
const mockStorage: Record<string, unknown> = {};
const chromeMock = {
    storage: {
        local: {
            get: vi.fn((keys: string | string[]) => {
                if (typeof keys === "string") {
                    return Promise.resolve({ [keys]: mockStorage[keys] });
                }
                const result: Record<string, unknown> = {};
                for (const key of keys) {
                    if (mockStorage[key] !== undefined) {
                        result[key] = mockStorage[key];
                    }
                }
                return Promise.resolve(result);
            }),
            set: vi.fn((items: Record<string, unknown>) => {
                Object.assign(mockStorage, items);
                return Promise.resolve();
            }),
            remove: vi.fn((keys: string | string[]) => {
                const keysArray = typeof keys === "string" ? [keys] : keys;
                for (const key of keysArray) {
                    delete mockStorage[key];
                }
                return Promise.resolve();
            }),
        },
    },
    runtime: {
        id: "test-extension-id", // This makes platform detection return 'chrome'
    },
};

vi.stubGlobal("chrome", chromeMock);

// Mock the platform module to ensure Chrome platform is used
vi.mock("@/platform", async () => {
    const mockPlatformStorage = {
        async get<T = unknown>(keys: string[]): Promise<Record<string, T>> {
            const result: Record<string, T> = {};
            for (const key of keys) {
                if ((globalThis as unknown as { chrome: typeof chromeMock }).chrome) {
                    const stored = await chromeMock.storage.local.get(key);
                    if (stored[key] !== undefined) {
                        result[key] = stored[key] as T;
                    }
                }
            }
            return result;
        },
        async set(items: Record<string, unknown>): Promise<void> {
            if ((globalThis as unknown as { chrome: typeof chromeMock }).chrome) {
                await chromeMock.storage.local.set(items);
            }
        },
        async remove(keys: string | string[]): Promise<void> {
            if ((globalThis as unknown as { chrome: typeof chromeMock }).chrome) {
                await chromeMock.storage.local.remove(keys);
            }
        },
    };

    return {
        platform: {
            name: "chrome" as const,
            storage: mockPlatformStorage,
            tabs: { create: vi.fn() },
            hasCapability: vi.fn(() => true),
        },
        isExtension: () => true,
        isWeb: () => false,
        hasCapability: vi.fn(() => true),
    };
});

// Import after mocking
import {
    getProvider,
    setProvider,
    getApiKeys,
    setApiKeys,
    getModels,
    setModels,
    getModelForProvider,
    setModelForProvider,
    getToolConfigs,
    setToolConfigs,
    getMcpServers,
    setMcpServers,
    getMcpToolStates,
    setMcpToolStates,
    isMcpToolEnabled,
    setMcpToolEnabled,
    getSystemPrompts,
    addSystemPrompt,

    getSelectedSystemPromptId,
    setSelectedSystemPromptId,
    getDebugMode,
    setDebugMode,
    getCustomBaseUrl,
    getLangfuseConfig,
    setLangfuseConfig,
    getPromptVariables,
    getMcpProxyConfig,
    setMcpProxyConfig,
    exportConfig,
    importConfig,


} from ".";

describe("storage", () => {
    beforeEach(() => {
        // Clear mock storage before each test
        Object.keys(mockStorage).forEach(key => delete mockStorage[key]);
        vi.clearAllMocks();
    });

    describe("Provider", () => {
        it("should return default provider when none set", async () => {
            const provider = await getProvider();
            expect(provider).toBe("gemini");
        });

        it("should save and retrieve provider", async () => {
            await setProvider("claude");
            const provider = await getProvider();
            expect(provider).toBe("claude");
        });

        it("should handle all provider types", async () => {
            for (const p of ["gemini", "claude", "openai"] as const) {
                await setProvider(p);
                const result = await getProvider();
                expect(result).toBe(p);
            }
        });
    });

    describe("API Keys", () => {
        it("should return empty object when no keys set", async () => {
            const keys = await getApiKeys();
            expect(keys).toEqual({});
        });

        it("should save and retrieve API keys", async () => {
            const keys = { gemini: "key1", claude: "key2" };
            await setApiKeys(keys);
            const result = await getApiKeys();
            expect(result).toEqual(keys);
        });
    });

    describe("Models", () => {
        it("should return default models when none set", async () => {
            const models = await getModels();
            expect(models).toHaveProperty("gemini");
            expect(models).toHaveProperty("claude");
            expect(models).toHaveProperty("openai");
        });

        it("should save and retrieve models", async () => {
            const models = { gemini: "model-a", claude: "model-b", openai: "model-c" };
            await setModels(models);
            const result = await getModels();
            expect(result).toEqual(models);
        });

        it("should get model for specific provider", async () => {
            await setModels({ gemini: "test-model", claude: "c", openai: "o" });
            const model = await getModelForProvider("gemini");
            expect(model).toBe("test-model");
        });

        it("should set model for specific provider", async () => {
            await setModels({ gemini: "old", claude: "c", openai: "o" });
            await setModelForProvider("gemini", "new-model");
            const model = await getModelForProvider("gemini");
            expect(model).toBe("new-model");
        });
    });

    describe("Tool Configs", () => {
        it("should return empty object when no configs", async () => {
            const configs = await getToolConfigs();
            expect(configs).toEqual({});
        });

        it("should save and retrieve tool configs", async () => {
            const configs = {
                calculator: { enabled: true, settings: { precision: 2 } },
            };
            await setToolConfigs(configs);
            const result = await getToolConfigs();
            expect(result).toEqual(configs);
        });

        it("should update single tool config", async () => {
            const configs = await getToolConfigs();
            configs.calculator = { enabled: false, settings: { precision: 2 } };
            await setToolConfigs(configs);
            const result = await getToolConfigs();
            expect(result.calculator?.enabled).toBe(false);
        });
    });

    describe("MCP Servers", () => {
        it("should return empty array when no servers", async () => {
            const servers = await getMcpServers();
            expect(servers).toEqual([]);
        });

        it("should save and retrieve MCP servers", async () => {
            const servers = [
                { id: "1", name: "Server 1", url: "http://s1" },
            ];
            await setMcpServers(servers as any);
            const result = await getMcpServers();
            expect(result).toEqual(servers);
        });
    });

    describe("MCP Tool States", () => {
        it("should check tool enabled state", async () => {
            await setMcpToolEnabled("serverA", "toolB", false);
            const enabled = await isMcpToolEnabled("serverA", "toolB");
            expect(enabled).toBe(false);
        });

        it("should default to true when not set", async () => {
            const enabled = await isMcpToolEnabled("nonexistent", "tool");
            expect(enabled).toBe(true);
        });

        it("should set tool enabled state", async () => {
            await setMcpToolEnabled("server2", "tool2", false);
            const enabled = await isMcpToolEnabled("server2", "tool2");
            expect(enabled).toBe(false);
        });
    });

    describe("Config Export/Import", () => {
        it("should export settings with encrypted secrets (v10)", async () => {
            // Set ALL exportable settings
            await setProvider("claude");
            await setApiKeys({ gemini: "g-key", claude: "c-key", openai: "o-key" });
            await setModels({ gemini: "g-model", claude: "c-model", openai: "o-model" });
            const prompt = await addSystemPrompt("Test Prompt", "Test system prompt content");
            await setSelectedSystemPromptId(prompt.id);
            await setDebugMode(true);
            await setToolConfigs({ calculator: { enabled: true, settings: { precision: 2, apiKey: "should-strip" } } });
            await setMcpServers([{ id: "mcp-1", url: "http://test.com", name: "Test MCP" }]);
            await setMcpToolStates({ "mcp-1": { "tool1": true, "tool2": false } });
            await setLangfuseConfig({ enabled: true, publicKey: "pk-test", secretKey: "sk-test", host: "https://cloud.langfuse.com" });
            await setMcpProxyConfig({ enabled: true, url: "https://proxy", apiKey: "proxy-key" });

            const exported = await exportConfig();

            // Verify settings are exported with encrypted secrets
            expect(exported.version).toBe(10);
            expect(exported.exportedAt).toBeDefined();
            expect(exported.provider).toBe("claude");
            expect("apiKeys" in exported).toBe(false);
            expect(exported.models.gemini).toBe("g-model");
            expect(exported.models.claude).toBe("c-model");
            expect(exported.models.openai).toBe("o-model");
            expect(exported.systemPrompts).toHaveLength(1);
            expect(exported.systemPrompts?.[0].title).toBe("Test Prompt");
            expect(exported.systemPrompts?.[0].prompt).toBe("Test system prompt content");
            expect(exported.selectedPromptId).toBe(prompt.id);
            expect(exported.debugMode).toBe(true);
            expect(exported.toolConfigs.calculator.enabled).toBe(true);
            expect(exported.toolConfigs.calculator.settings?.precision).toBe(2);
            expect(exported.toolConfigs.calculator.settings?.apiKey).toBeUndefined();
            expect(exported.langfuseConfig.enabled).toBe(true);
            expect(exported.langfuseConfig.host).toBe("https://cloud.langfuse.com");
            expect(exported.mcpProxyConfig.enabled).toBe(true);
            expect(exported.mcpProxyConfig.url).toBe("https://proxy");
            expect(exported.mcpServers).toHaveLength(1);
            expect(exported.mcpServers[0].name).toBe("Test MCP");
            expect(exported.mcpToolStates["mcp-1"]["tool1"]).toBe(true);
            expect(exported.mcpToolStates["mcp-1"]["tool2"]).toBe(false);
            expect(exported.encryptedSecrets?.vaultKeyHash).toBe("vault-hash-1");
            expect(exported.encryptedSecrets?.vaultMeta?.saltBase64).toBe("test-salt");
            expect(exported.encryptedSecrets?.vaultMeta?.iterations).toBe(600000);
            expect(exported.encryptedSecrets?.payload).toMatch(/^enc:/);
        });

        it("should import ALL settings comprehensively", async () => {
            const configToImport = {
                version: 10,
                exportedAt: new Date().toISOString(),
                provider: "openai" as const,
                models: { gemini: "gem-1", claude: "cla-1", openai: "gpt-imported" },
                systemPrompts: [{ id: "imported-1", title: "Imported", prompt: "Imported prompt" }],
                selectedPromptId: "imported-1",
                debugMode: true,
                customBaseUrl: "https://custom.example.com",
                langfuseConfig: { enabled: false, host: "https://cloud.langfuse.com" },
                promptVariables: [],
                mcpProxyConfig: { enabled: false, url: import.meta.env.VITE_API_BASE_URL ? `${import.meta.env.VITE_API_BASE_URL}/mcp-proxy` : "" },
                toolConfigs: { calculator: { enabled: false, settings: { precision: 3 } } },
                mcpServers: [{ id: "imported-mcp", url: "http://imported.com", name: "Imported MCP" }],
                mcpToolStates: { "imported-mcp": { "tool-a": true } },
                encryptedSecrets: {
                    vaultKeyHash: "vault-hash-1",
                    payload: `enc:${btoa(JSON.stringify({
                        apiKeys: { gemini: "imported-g", claude: "imported-c", openai: "imported-o" },
                        langfuseSecrets: { publicKey: "pk-imported", secretKey: "sk-imported" },
                        mcpProxyApiKey: "proxy-imported",
                        mcpServerTokens: { "imported-mcp": "token-1" },
                        toolConfigSecrets: { calculator: { apiKey: "calc-key" } },
                    }))}`,
                },
            };

            await importConfig(configToImport);

            // Verify ALL settings are imported
            const provider = await getProvider();
            const models = await getModels();
            const prompts = await getSystemPrompts();
            const selectedId = await getSelectedSystemPromptId();
            const debugMode = await getDebugMode();
            const customBaseUrl = await getCustomBaseUrl();
            const langfuseConfig = await getLangfuseConfig();
            const promptVariables = await getPromptVariables();
            const mcpProxyConfig = await getMcpProxyConfig();
            const toolConfigs = await getToolConfigs();
            const mcpServers = await getMcpServers();
            const mcpToolStates = await getMcpToolStates();
            const apiKeys = await getApiKeys();

            expect(provider).toBe("openai");
            expect(models.gemini).toBe("gem-1");
            expect(models.claude).toBe("cla-1");
            expect(models.openai).toBe("gpt-imported");
            expect(prompts).toHaveLength(1);
            expect(prompts[0].title).toBe("Imported");
            expect(prompts[0].prompt).toBe("Imported prompt");
            expect(selectedId).toBe("imported-1");
            expect(debugMode).toBe(true);
            expect(customBaseUrl).toBe("https://custom.example.com");
            expect(langfuseConfig.enabled).toBe(false);
            expect(langfuseConfig.publicKey).toBe("pk-imported");
            expect(promptVariables).toEqual([]);
            expect(mcpProxyConfig.url).toBe(import.meta.env.VITE_API_BASE_URL ? `${import.meta.env.VITE_API_BASE_URL}/mcp-proxy` : "");
            expect(mcpProxyConfig.apiKey).toBe("proxy-imported");
            expect(toolConfigs.calculator.enabled).toBe(false);
            expect(toolConfigs.calculator.settings?.precision).toBe(3);
            expect(toolConfigs.calculator.settings?.apiKey).toBe("calc-key");
            expect(mcpServers[0].name).toBe("Imported MCP");
            expect(mcpServers[0].authToken).toBe("token-1");
            expect(mcpToolStates["imported-mcp"]["tool-a"]).toBe(true);
            expect(apiKeys.openai).toBe("imported-o");
        });

        it("should throw error when vault key does not match export", async () => {
            const configToImport = {
                version: 10,
                exportedAt: new Date().toISOString(),
                provider: "openai" as const,
                models: { gemini: "gem-1", claude: "cla-1", openai: "gpt-imported" },
                systemPrompts: [],
                selectedPromptId: null,
                debugMode: false,
                customBaseUrl: "",
                langfuseConfig: { enabled: false, host: "https://cloud.langfuse.com" },
                promptVariables: [],
                mcpProxyConfig: { enabled: false, url: import.meta.env.VITE_API_BASE_URL ? `${import.meta.env.VITE_API_BASE_URL}/mcp-proxy` : "" },
                toolConfigs: {},
                mcpServers: [],
                mcpToolStates: {},
                encryptedSecrets: {
                    vaultKeyHash: "vault-hash-2",
                    vaultMeta: { saltBase64: "other-salt", iterations: 600000 },
                    payload: "enc:e30=",
                },
            };

            await expect(importConfig(configToImport)).rejects.toThrow("Security key does not match export");
        });

        it("should throw error for invalid config version", async () => {
            const invalidConfig = { version: 999 } as any;
            await expect(importConfig(invalidConfig)).rejects.toThrow("Invalid or unsupported config version");
        });
    });

    describe("Chat Sessions", () => {
        // Import chat session functions dynamically to avoid import issues
        let getChatSessions: typeof import(".").getChatSessions;
        let saveCurrentChat: typeof import(".").saveCurrentChat;
        let getCurrentChatId: typeof import(".").getCurrentChatId;
        let getCurrentChat: typeof import(".").getCurrentChat;
        let createNewChat: typeof import(".").createNewChat;
        let switchToChat: typeof import(".").switchToChat;
        let deleteChat: typeof import(".").deleteChat;

        beforeEach(async () => {
            const storage = await import(".");
            getChatSessions = storage.getChatSessions;
            saveCurrentChat = storage.saveCurrentChat;
            getCurrentChatId = storage.getCurrentChatId;
            getCurrentChat = storage.getCurrentChat;
            createNewChat = storage.createNewChat;
            switchToChat = storage.switchToChat;
            deleteChat = storage.deleteChat;
        });

        it("should return empty sessions initially", async () => {
            const sessions = await getChatSessions();
            expect(sessions).toEqual([]);
        });

        it("should create a new chat", async () => {
            const chatId = await createNewChat();
            expect(chatId).toBeTruthy();

            const sessions = await getChatSessions();
            expect(sessions).toHaveLength(1);
            expect(sessions[0].id).toBe(chatId);
        });

        it("should save and retrieve current chat", async () => {
            await createNewChat();
            const messages = [{ role: "user" as const, content: "Hello" }];
            await saveCurrentChat(messages, "Test Chat");

            const currentChat = await getCurrentChat();
            expect(currentChat).not.toBeNull();
            expect(currentChat?.title).toBe("Test Chat");
            expect(currentChat?.messages).toHaveLength(1);
        });

        it("should switch between chats", async () => {
            const chat1 = await createNewChat();
            await saveCurrentChat([{ role: "user" as const, content: "Chat 1" }], "Chat 1");

            await createNewChat();
            await saveCurrentChat([{ role: "user" as const, content: "Chat 2" }], "Chat 2");

            const switched = await switchToChat(chat1);
            expect(switched?.id).toBe(chat1);
            expect(switched?.title).toBe("Chat 1");

            const currentId = await getCurrentChatId();
            expect(currentId).toBe(chat1);
        });

        it("should delete a chat", async () => {
            const chat1 = await createNewChat();
            const chat2 = await createNewChat();

            await deleteChat(chat1);

            const sessions = await getChatSessions();
            expect(sessions).toHaveLength(1);
            expect(sessions[0].id).toBe(chat2);
        });

        it("should create new chat when deleting current", async () => {
            const chat1 = await createNewChat();
            await deleteChat(chat1);

            const currentId = await getCurrentChatId();
            expect(currentId).toBeTruthy();
            expect(currentId).not.toBe(chat1);
        });

        it("should auto-cleanup sessions when exceeding limit (20)", async () => {
            // Create 22 sessions with different updatedAt times
            for (let i = 0; i < 22; i++) {
                await createNewChat();
                const messages = [{ role: "user" as const, content: `Message ${i}` }];
                await saveCurrentChat(messages, `Chat ${i}`);
            }

            const sessions = await getChatSessions();
            // Should be capped at 20
            expect(sessions.length).toBeLessThanOrEqual(20);
        });

        it("should return null when switching to nonexistent chat", async () => {
            await createNewChat();
            const result = await switchToChat("nonexistent-id");
            expect(result).toBeNull();
        });

        it("should switch to most recent when deleting current with remaining chats", async () => {
            const chat1 = await createNewChat();
            await saveCurrentChat([{ role: "user" as const, content: "msg1" }], "Chat 1");

            const chat2 = await createNewChat();
            await saveCurrentChat([{ role: "user" as const, content: "msg2" }], "Chat 2");

            // Make chat2 current, then delete it
            await switchToChat(chat2);
            await deleteChat(chat2);

            const currentId = await getCurrentChatId();
            // Should switch to chat1 (remaining)
            expect(currentId).toBe(chat1);
        });
    });

    describe("Fork Conversation", () => {
        let forkConversation: typeof import(".").forkConversation;
        let getChatSessions: typeof import(".").getChatSessions;

        beforeEach(async () => {
            const storage = await import(".");
            forkConversation = storage.forkConversation;
            getChatSessions = storage.getChatSessions;
        });

        it("should fork with source title", async () => {
            const messages = [
                { role: "user" as const, content: "Hello" },
                { role: "model" as const, content: "Hi" },
                { role: "user" as const, content: "Follow up" },
            ];

            const id = await forkConversation(messages, 1, "Original Chat");
            const sessions = await getChatSessions();
            const forked = sessions.find(s => s.id === id);

            expect(forked?.title).toBe("Fork: Original Chat");
            expect(forked?.messages).toHaveLength(2);
        });

        it("should fork without title (uses 'Untitled')", async () => {
            const messages = [{ role: "user" as const, content: "Msg" }];
            const id = await forkConversation(messages, 0, null);
            const sessions = await getChatSessions();
            const forked = sessions.find(s => s.id === id);

            expect(forked?.title).toBe("Fork: Untitled");
        });

        it("should copy images and files when forking", async () => {
            const messages = [
                {
                    role: "user" as const,
                    content: "With attachments",
                    images: ["img1.png"],
                    files: [{ id: "f1", fileName: "file.txt", mimeType: "text/plain", fileSize: 4, dataUrl: "data:text/plain;base64,ZGF0YQ==" }],
                },
            ];

            const id = await forkConversation(messages, 0);
            const sessions = await getChatSessions();
            const forked = sessions.find(s => s.id === id);

            expect(forked?.messages[0].images).toEqual(["img1.png"]);
            expect(forked?.messages[0].files).toHaveLength(1);
        });

        it("should fork with system prompt ID", async () => {
            const messages = [{ role: "user" as const, content: "Msg" }];
            const id = await forkConversation(messages, 0, "Test", "prompt-123");
            const sessions = await getChatSessions();
            const forked = sessions.find(s => s.id === id);

            expect(forked?.systemPromptId).toBe("prompt-123");
        });
    });

    describe("Chat Pinning", () => {
        let createNewChat: typeof import(".").createNewChat;
        let toggleChatPinned: typeof import(".").toggleChatPinned;
        let getPinnedChatsCount: typeof import(".").getPinnedChatsCount;

        beforeEach(async () => {
            const storage = await import(".");
            createNewChat = storage.createNewChat;
            toggleChatPinned = storage.toggleChatPinned;
            getPinnedChatsCount = storage.getPinnedChatsCount;
        });

        it("should pin a chat", async () => {
            const id = await createNewChat();
            const pinned = await toggleChatPinned(id);
            expect(pinned).toBe(true);
            expect(await getPinnedChatsCount()).toBe(1);
        });

        it("should unpin a chat", async () => {
            const id = await createNewChat();
            await toggleChatPinned(id); // pin
            const unpinned = await toggleChatPinned(id); // unpin
            expect(unpinned).toBe(false);
            expect(await getPinnedChatsCount()).toBe(0);
        });

        it("should throw when pinning nonexistent chat", async () => {
            await expect(toggleChatPinned("nonexistent")).rejects.toThrow("Chat session not found");
        });

        it("should throw when exceeding max pinned limit", async () => {
            // Pin 5 chats (MAX_PINNED_CHATS)
            for (let i = 0; i < 5; i++) {
                const id = await createNewChat();
                await toggleChatPinned(id);
            }
            const lastId = await createNewChat();
            await expect(toggleChatPinned(lastId)).rejects.toThrow(/Maximum.*pinned chats allowed/);
        });
    });

    describe("System Prompts", () => {
        let updateSystemPrompt: typeof import(".").updateSystemPrompt;
        let deleteSystemPrompt: typeof import(".").deleteSystemPrompt;
        let getActiveSystemPrompt: typeof import(".").getActiveSystemPrompt;

        beforeEach(async () => {
            const storage = await import(".");
            updateSystemPrompt = storage.updateSystemPrompt;
            deleteSystemPrompt = storage.deleteSystemPrompt;
            getActiveSystemPrompt = storage.getActiveSystemPrompt;
        });

        it("should update an existing system prompt", async () => {
            const prompt = await addSystemPrompt("Old Title", "Old Content");
            await updateSystemPrompt(prompt.id, "New Title", "New Content");

            const prompts = await getSystemPrompts();
            const updated = prompts.find(p => p.id === prompt.id);
            expect(updated?.title).toBe("New Title");
            expect(updated?.prompt).toBe("New Content");
        });

        it("should not throw when updating nonexistent prompt", async () => {
            await expect(updateSystemPrompt("nonexistent", "T", "C")).resolves.toBeUndefined();
        });

        it("should clear selection when deleting selected prompt", async () => {
            const prompt = await addSystemPrompt("To Delete", "Content");
            await setSelectedSystemPromptId(prompt.id);
            expect(await getSelectedSystemPromptId()).toBe(prompt.id);

            await deleteSystemPrompt(prompt.id);
            expect(await getSelectedSystemPromptId()).toBeNull();
        });

        it("should not clear selection when deleting non-selected prompt", async () => {
            const p1 = await addSystemPrompt("Keep", "Content");
            const p2 = await addSystemPrompt("Delete", "Content");
            await setSelectedSystemPromptId(p1.id);

            await deleteSystemPrompt(p2.id);
            expect(await getSelectedSystemPromptId()).toBe(p1.id);
        });

        it("should return empty string when no prompt selected", async () => {
            const result = await getActiveSystemPrompt();
            expect(result).toBe("");
        });

        it("should return prompt text for selected prompt", async () => {
            const prompt = await addSystemPrompt("Active", "This is the prompt");
            await setSelectedSystemPromptId(prompt.id);

            const result = await getActiveSystemPrompt();
            expect(result).toBe("This is the prompt");
        });

        it("should return empty string when selected prompt ID not found", async () => {
            await setSelectedSystemPromptId("nonexistent-id");
            const result = await getActiveSystemPrompt();
            expect(result).toBe("");
        });
    });

    // Skipped: these tests require special mock handling for storage.get(null)
    // which doesn't work well with the platform abstraction mock
    describe.skip("Debug Storage Usage", () => {
        let debugStorageUsage: typeof import(".").debugStorageUsage;

        beforeEach(async () => {
            // Update mock to support get(null) for all keys
            chromeMock.storage.local.get = vi.fn((keys) => {
                if (keys === null) {
                    return Promise.resolve({ ...mockStorage });
                }
                if (typeof keys === "string") {
                    return Promise.resolve({ [keys]: mockStorage[keys] });
                }
                const result: Record<string, unknown> = {};
                for (const key of keys) {
                    if (mockStorage[key] !== undefined) {
                        result[key] = mockStorage[key];
                    }
                }
                return Promise.resolve(result);
            });
            const storage = await import(".");
            debugStorageUsage = storage.debugStorageUsage;
        });

        it("should return storage usage report", async () => {
            mockStorage["test_key1"] = "short value";
            mockStorage["test_key2"] = { nested: "object", array: [1, 2, 3] };

            const report = await debugStorageUsage();

            expect(report).toHaveProperty("items");
            expect(report).toHaveProperty("totalBytes");
            expect(report).toHaveProperty("totalFormatted");
            expect(report).toHaveProperty("quotaBytes");
            expect(report).toHaveProperty("usagePercent");
            expect(report.items.length).toBeGreaterThan(0);
            expect(report.totalBytes).toBeGreaterThan(0);
        });

        it("should sort items by size descending", async () => {
            mockStorage["small"] = "a";
            mockStorage["large"] = "a".repeat(1000);

            const report = await debugStorageUsage();

            const largeIdx = report.items.findIndex(i => i.key === "large");
            const smallIdx = report.items.findIndex(i => i.key === "small");
            expect(largeIdx).toBeLessThan(smallIdx);
        });

        it("should format bytes correctly", async () => {
            mockStorage["kb_test"] = "a".repeat(2000);

            const report = await debugStorageUsage();
            const kbItem = report.items.find(i => i.key === "kb_test");

            expect(kbItem?.sizeFormatted).toMatch(/KB/);
        });
    });
});
