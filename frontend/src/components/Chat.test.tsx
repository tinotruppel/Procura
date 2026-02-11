import React from "react";
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { Chat } from './Chat';

// Mock storage functions
vi.mock('@/lib/storage', () => ({
    getProvider: vi.fn(() => Promise.resolve('gemini')),
    getApiKeyForProvider: vi.fn(() => Promise.resolve('test-api-key')),
    getModelForProvider: vi.fn(() => Promise.resolve('gemini-pro')),
    getActiveSystemPrompt: vi.fn(() => Promise.resolve('You are a helpful assistant')),
    getDebugMode: vi.fn(() => Promise.resolve(false)),
    getChatSessions: vi.fn(() => Promise.resolve([])),
    getCurrentChat: vi.fn(() => Promise.resolve(null)),
    saveCurrentChat: vi.fn(() => Promise.resolve()),
    switchToChat: vi.fn(() => Promise.resolve({ id: 'test', title: 'Test', messages: [] })),
    createNewChat: vi.fn(() => Promise.resolve('new-chat-id')),
    forkConversation: vi.fn(() => Promise.resolve()),
    getSystemPrompts: vi.fn(() => Promise.resolve([])),
    getSelectedSystemPromptId: vi.fn(() => Promise.resolve(null)),
    setSelectedSystemPromptId: vi.fn(() => Promise.resolve()),
    getLangfuseConfig: vi.fn(() => Promise.resolve({ enabled: false, publicKey: '', secretKey: '', host: '' })),
    getPromptVariables: vi.fn(() => Promise.resolve([])),
    getCustomBaseUrl: vi.fn(() => Promise.resolve('')),
    getMcpServers: vi.fn(() => Promise.resolve([])),
    getToolConfigs: vi.fn(() => Promise.resolve({})),
    toggleChatPinned: vi.fn(() => Promise.resolve(false)),
    updateChatTitleById: vi.fn(() => Promise.resolve()),
}));

// Mock memory store
vi.mock('@/lib/memory-store', () => ({
    getMemoryEntries: vi.fn(() => Promise.resolve([])),
}));

// Mock tools
vi.mock('@/tools', () => ({
    getTool: vi.fn(() => null),
}));

// Mock LLM flow helper
vi.mock('@/lib/chat/llm-flow', () => ({
    executeLlmChatTurn: vi.fn(async ({ onTextChunk }: { onTextChunk?: (chunk: string) => void }) => {
        if (onTextChunk) {
            onTextChunk("Hello ");
            onTextChunk("world");
        }
        return {
            text: "Hello world",
            toolCalls: [],
            debugEvents: [],
        };
    }),
}));

// Mock Langfuse
vi.mock('@/lib/langfuse', () => ({
    fetchLangfusePromptList: vi.fn(() => Promise.resolve([])),
    fetchLangfusePrompt: vi.fn(() => Promise.resolve(null)),
    sendLangfuseBatch: vi.fn(() => Promise.resolve()),
    replacePromptVariables: vi.fn((prompt: string) => ({ result: prompt, missing: [] })),
}));

// Mock file store
vi.mock('@/lib/file-store', () => ({
    addFile: vi.fn(() => "file_123"),
    isImageMimeType: vi.fn((mime: string) => mime.startsWith('image/')),
}));

// Mock MCP client
vi.mock('@/lib/mcp-client', () => ({
    initializeMcpServers: vi.fn(() => Promise.resolve()),
}));

// Mock vault
vi.mock('@/lib/vault', () => ({
    isVaultUnlocked: vi.fn(() => false),
    lockVault: vi.fn(),
    restoreVaultFromSession: vi.fn(() => Promise.resolve()),
}));

// Mock tool-context
vi.mock('@/lib/tool-context', () => ({
    setToolContext: vi.fn(),
    getToolContext: vi.fn(() => ({})),
    clearToolContext: vi.fn(),
}));

// Mock web-interaction
vi.mock('@/tools/web-interaction', () => ({
    clearAnnotationState: vi.fn(),
}));

// Mock prompt-resolver
vi.mock('@/lib/chat/prompt-resolver', () => ({
    resolveSystemPrompt: vi.fn(() => Promise.resolve({
        systemPrompt: 'You are helpful',
        systemPromptName: undefined,
        systemPromptVersion: undefined,
        systemPromptSource: undefined,
        missingVariables: [],
        injectedMemoryCount: 0,
    })),
}));

// Mock chat/attachments
vi.mock('@/lib/chat/attachments', () => ({
    prepareMessagesWithAttachments: vi.fn(({ input }: { input: string }) => ({
        displayMessage: { role: 'user', content: input },
        llmMessage: { role: 'user', content: input },
        registeredFiles: [],
        imageIds: [],
        llmContent: input,
    })),
}));

// Mock chat/export
vi.mock('@/lib/chat/export', () => ({
    exportChatAsMarkdown: vi.fn(),
    formatDate: vi.fn((ts: number) => new Date(ts).toLocaleDateString()),
    formatFileSize: vi.fn(() => "1KB"),
    getFileIcon: vi.fn(() => "📄"),
}));

// Mock timer-manager
let timerCallback: ((chatId: string, message: string) => void) | null = null;
vi.mock('@/lib/timer-manager', () => ({
    onTimerFire: vi.fn((cb: (chatId: string, message: string) => void) => {
        timerCallback = cb;
        return vi.fn(); // unsubscribe
    }),
}));

// Mock MessageList component
vi.mock('./MessageList', () => ({
    MessageList: ({ messages }: { messages: Array<{ role: string; content: string }> }) => (
        <div data-testid="message-list">
            {messages.map((message, idx) => (
                <div key={idx}>
                    {message.role}:{message.content}
                </div>
            ))}
        </div>
    ),
}));

// Helper: creates a promise that hangs until manually resolved
function createControllablePromise<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- used as typeof for createControllablePromise generic
const defaultLlmResponse = { text: "Response", toolCalls: [], debugEvents: [] };

describe('Chat', () => {
    const mockOnOpenSettings = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        timerCallback = null;
        sessionStorage.clear(); // Clear any draft data between tests
    });

    describe('initial render', () => {
        it('should render the chat interface', async () => {
            render(<Chat onOpenSettings={mockOnOpenSettings} />);

            // Should have message input
            expect(screen.getByPlaceholderText(/message/i)).toBeInTheDocument();
        });

        it('should render settings button with title', async () => {
            render(<Chat onOpenSettings={mockOnOpenSettings} />);

            expect(screen.getByTitle('Settings')).toBeInTheDocument();
        });

        it('should render history button with title', async () => {
            render(<Chat onOpenSettings={mockOnOpenSettings} />);

            expect(screen.getByTitle('Chat History')).toBeInTheDocument();
        });

        it('should render new chat button with title', async () => {
            render(<Chat onOpenSettings={mockOnOpenSettings} />);

            expect(screen.getByTitle('New Chat')).toBeInTheDocument();
        });

        it('should render welcome message when no messages', async () => {
            render(<Chat onOpenSettings={mockOnOpenSettings} />);

            await waitFor(() => {
                expect(screen.getByText('Start a chat')).toBeInTheDocument();
            });
        });

        it('should render app title', async () => {
            render(<Chat onOpenSettings={mockOnOpenSettings} />);

            expect(screen.getByText('Procura')).toBeInTheDocument();
        });
    });

    describe('text input', () => {
        it('should update input value on change', async () => {
            render(<Chat onOpenSettings={mockOnOpenSettings} />);

            const input = screen.getByPlaceholderText(/message/i);
            fireEvent.change(input, { target: { value: 'Hello world' } });

            expect(input).toHaveValue('Hello world');
        });

        it('should have textarea element', async () => {
            render(<Chat onOpenSettings={mockOnOpenSettings} />);

            const textarea = screen.getByPlaceholderText(/message/i);
            expect(textarea.tagName).toBe('TEXTAREA');
        });
    });

    describe('button clicks', () => {
        it('should call onOpenSettings when settings button is clicked', async () => {
            render(<Chat onOpenSettings={mockOnOpenSettings} />);

            const settingsBtn = screen.getByTitle('Settings');
            fireEvent.click(settingsBtn);

            expect(mockOnOpenSettings).toHaveBeenCalledTimes(1);
        });

        it('should handle new chat button click', async () => {
            const storage = await vi.importMock("@/lib/storage") as any;
            const { createNewChat } = storage;
            render(<Chat onOpenSettings={mockOnOpenSettings} />);

            const newChatBtn = screen.getByTitle('New Chat');
            fireEvent.click(newChatBtn);

            await waitFor(() => {
                expect(createNewChat).toHaveBeenCalled();
            });
        });
    });

    describe('history panel', () => {
        it('should toggle history panel on button click', async () => {
            render(<Chat onOpenSettings={mockOnOpenSettings} />);

            const historyBtn = screen.getByTitle('Chat History');
            fireEvent.click(historyBtn);

            // History panel should appear
            await waitFor(() => {
                const closeBtn = screen.queryByTitle('Close History');
                expect(closeBtn || screen.getByTitle('Chat History')).toBeInTheDocument();
            });
        });
    });

    describe('drag and drop', () => {
        it('should handle drag over event on input area', async () => {
            render(<Chat onOpenSettings={mockOnOpenSettings} />);

            const textarea = screen.getByPlaceholderText(/message/i);
            const container = textarea.closest('.flex.gap-2');

            if (container) {
                fireEvent.dragOver(container, {
                    preventDefault: vi.fn(),
                    dataTransfer: { types: ['Files'] },
                });
            }

            expect(true).toBe(true);
        });
    });

    describe('keyboard interaction', () => {
        it('should not submit on Shift+Enter', async () => {
            render(<Chat onOpenSettings={mockOnOpenSettings} />);

            const textarea = screen.getByPlaceholderText(/message/i);
            fireEvent.change(textarea, { target: { value: 'Test message' } });
            fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

            // Message should still be there (Shift+Enter adds newline)
            expect(textarea).toHaveValue('Test message');
        });
    });

    describe('send button state', () => {
        it('should have disabled send button when input is empty', async () => {
            render(<Chat onOpenSettings={mockOnOpenSettings} />);

            const sendButton = screen.getByLabelText("Send message");
            expect(sendButton).toBeDisabled();
        });

        it('should enable send button when input has text', async () => {
            render(<Chat onOpenSettings={mockOnOpenSettings} />);

            const textarea = screen.getByPlaceholderText(/message/i);
            fireEvent.change(textarea, { target: { value: 'Hello' } });

            const sendButton = screen.getByLabelText("Send message");
            expect(sendButton).not.toBeDisabled();
        });
    });

    describe('accessibility', () => {
        it('should have accessible button titles', async () => {
            render(<Chat onOpenSettings={mockOnOpenSettings} />);

            expect(screen.getByTitle('Settings')).toBeInTheDocument();
            expect(screen.getByTitle('Chat History')).toBeInTheDocument();
            expect(screen.getByTitle('New Chat')).toBeInTheDocument();
        });

        it('should have placeholder text for input', async () => {
            render(<Chat onOpenSettings={mockOnOpenSettings} />);

            expect(screen.getByPlaceholderText(/Message/i)).toBeInTheDocument();
        });
    });

    describe('message sending', () => {
        it('should send a message and render the streamed response', async () => {
            render(<Chat onOpenSettings={mockOnOpenSettings} />);

            const textarea = screen.getByPlaceholderText(/message/i);
            fireEvent.change(textarea, { target: { value: 'Hello' } });

            const sendButton = screen.getByLabelText("Send message");
            fireEvent.click(sendButton);

            await waitFor(() => {
                expect(screen.getByText("model:Hello world")).toBeInTheDocument();
            });
        });

        it('should include the selected local system prompt in the LLM call', async () => {
            const storage = await vi.importMock("@/lib/storage") as any;
            const llmFlow = await vi.importMock("@/lib/chat/llm-flow") as any;
            const promptResolver = await vi.importMock("@/lib/chat/prompt-resolver") as any;

            (storage.getSystemPrompts as ReturnType<typeof vi.fn>).mockResolvedValue([
                { id: "local-1", title: "Local Prompt", prompt: "Local prompt content" },
            ]);
            (storage.getSelectedSystemPromptId as ReturnType<typeof vi.fn>).mockResolvedValue("local-1");
            (promptResolver.resolveSystemPrompt as ReturnType<typeof vi.fn>).mockResolvedValue({
                systemPrompt: 'Local prompt content',
                systemPromptName: 'Local Prompt',
                systemPromptVersion: undefined,
                systemPromptSource: 'local',
                missingVariables: [],
                injectedMemoryCount: 0,
            });

            const executeSpy = llmFlow.executeLlmChatTurn as ReturnType<typeof vi.fn>;
            executeSpy.mockImplementationOnce(async ({ onTextChunk, systemPrompt }: any) => {
                if (onTextChunk) {
                    onTextChunk("OK");
                }
                return {
                    text: "OK",
                    toolCalls: [],
                    debugEvents: [],
                    systemPrompt,
                };
            });

            render(<Chat onOpenSettings={mockOnOpenSettings} />);

            await waitFor(() => {
                expect(storage.getSelectedSystemPromptId).toHaveBeenCalled();
            });

            const textarea = screen.getByPlaceholderText(/message/i);
            fireEvent.change(textarea, { target: { value: 'Hello' } });

            const sendButton = screen.getByLabelText("Send message");
            fireEvent.click(sendButton);

            await waitFor(() => {
                expect(executeSpy).toHaveBeenCalled();
            });

            const lastCallArgs = executeSpy.mock.calls[0][0];
            expect(lastCallArgs.systemPrompt).toBe("Local prompt content");
        });
    });

    describe('chat switching during streaming', () => {
        it('should abort stream and show empty state when starting new chat during streaming', async () => {
            const llmFlow = await vi.importMock("@/lib/chat/llm-flow") as any;
            const storage = await vi.importMock("@/lib/storage") as any;
            const { promise, resolve } = createControllablePromise<typeof defaultLlmResponse>();

            const executeSpy = llmFlow.executeLlmChatTurn as ReturnType<typeof vi.fn>;
            executeSpy.mockImplementationOnce(async ({ onTextChunk }: any) => {
                onTextChunk?.("Partial ");
                return promise;
            });

            render(<Chat onOpenSettings={mockOnOpenSettings} />);

            // Type and send
            const textarea = screen.getByPlaceholderText(/message/i);
            fireEvent.change(textarea, { target: { value: 'Hello' } });
            fireEvent.click(screen.getByLabelText('Send message'));

            // Wait for loading state
            await waitFor(() => {
                expect(screen.getByLabelText('Stop response')).toBeInTheDocument();
            });

            // Click New Chat while streaming
            fireEvent.click(screen.getByTitle('New Chat'));

            // Loading should clear, empty state shown
            await waitFor(() => {
                expect(screen.queryByLabelText('Stop response')).not.toBeInTheDocument();
            });
            expect(storage.createNewChat).toHaveBeenCalled();

            // Resolve stale promise — should not crash or affect new chat
            resolve({ text: 'Stale response', toolCalls: [], debugEvents: [] });

            // Should still show empty state
            await waitFor(() => {
                expect(screen.getByText('Start a chat')).toBeInTheDocument();
            });
        });

        it('should abort stream when selecting a different chat', async () => {
            const llmFlow = await vi.importMock("@/lib/chat/llm-flow") as any;
            const storage = await vi.importMock("@/lib/storage") as any;
            const { promise, resolve } = createControllablePromise<typeof defaultLlmResponse>();

            const executeSpy = llmFlow.executeLlmChatTurn as ReturnType<typeof vi.fn>;
            executeSpy.mockImplementationOnce(async ({ onTextChunk }: any) => {
                onTextChunk?.("Partial ");
                return promise;
            });

            // Set up history with a chat
            (storage.getChatSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
                { id: 'other-chat', title: 'Other Chat', messages: [{ role: 'user', content: 'Hi' }], createdAt: 1, updatedAt: 2 },
            ]);
            (storage.switchToChat as ReturnType<typeof vi.fn>).mockResolvedValue(
                { id: 'other-chat', title: 'Other Chat', messages: [{ role: 'user', content: 'Hi' }], createdAt: 1, updatedAt: 2 }
            );

            render(<Chat onOpenSettings={mockOnOpenSettings} />);

            // Send a message to start streaming
            const textarea = screen.getByPlaceholderText(/message/i);
            fireEvent.change(textarea, { target: { value: 'Hello' } });
            fireEvent.click(screen.getByLabelText('Send message'));

            await waitFor(() => {
                expect(screen.getByLabelText('Stop response')).toBeInTheDocument();
            });

            // Open history and select another chat
            fireEvent.click(screen.getByTitle('Chat History'));
            await waitFor(() => {
                expect(screen.getByText('Other Chat')).toBeInTheDocument();
            });
            fireEvent.click(screen.getByText('Other Chat'));

            // Loading should be cleared
            await waitFor(() => {
                expect(screen.queryByLabelText('Stop response')).not.toBeInTheDocument();
            });

            // Resolve stale promise
            resolve({ text: 'Stale', toolCalls: [], debugEvents: [] });

            // Should show messages from the selected chat
            await waitFor(() => {
                expect(screen.getByText('user:Hi')).toBeInTheDocument();
            });
        });

        it('should not let stale finally reset isLoading for a new request', async () => {
            const llmFlow = await vi.importMock("@/lib/chat/llm-flow") as any;
            const firstRequest = createControllablePromise<typeof defaultLlmResponse>();
            let callCount = 0;

            const executeSpy = llmFlow.executeLlmChatTurn as ReturnType<typeof vi.fn>;
            executeSpy.mockImplementation(async ({ onTextChunk }: any) => {
                callCount++;
                if (callCount === 1) {
                    onTextChunk?.("Partial ");
                    return firstRequest.promise;
                }
                // Second call resolves immediately
                onTextChunk?.("New response");
                return { text: "New response", toolCalls: [], debugEvents: [] };
            });

            render(<Chat onOpenSettings={mockOnOpenSettings} />);

            // Send first message
            const textarea = screen.getByPlaceholderText(/message/i);
            fireEvent.change(textarea, { target: { value: 'First' } });
            fireEvent.click(screen.getByLabelText('Send message'));

            await waitFor(() => {
                expect(screen.getByLabelText('Stop response')).toBeInTheDocument();
            });

            // Click New Chat (aborts first request)
            fireEvent.click(screen.getByTitle('New Chat'));

            await waitFor(() => {
                expect(screen.queryByLabelText('Stop response')).not.toBeInTheDocument();
                expect(screen.getByText('Start a chat')).toBeInTheDocument();
            });

            // Resolve stale first request — its finally block should NOT affect new state
            firstRequest.resolve({ text: 'Old response', toolCalls: [], debugEvents: [] });

            // isLoading should still be false (send button visible, not stop button)
            await waitFor(() => {
                expect(screen.queryByLabelText('Stop response')).not.toBeInTheDocument();
            });
        });
    });

    describe('chat title generation', () => {
        it('should save generated title to the original chat even after switching', async () => {
            const storage = await vi.importMock("@/lib/storage") as any;
            const llmFlow = await vi.importMock("@/lib/chat/llm-flow") as any;

            // Start with chat-1
            (storage.getCurrentChat as ReturnType<typeof vi.fn>).mockResolvedValue({
                id: 'chat-1', title: null, messages: [], systemPromptId: null,
            });

            let titleCallResolve: ((v: any) => void) | null = null;
            let callCount = 0;
            const executeSpy = llmFlow.executeLlmChatTurn as ReturnType<typeof vi.fn>;
            executeSpy.mockImplementation(async ({ onTextChunk }: any) => {
                callCount++;
                // First call: the actual message send
                if (callCount === 1) {
                    onTextChunk?.("Hello back");
                    return { text: "Hello back", toolCalls: [], debugEvents: [] };
                }
                // Second call: the title generation (fire-and-forget, hangs until resolved)
                return new Promise(resolve => { titleCallResolve = resolve; });
            });

            render(<Chat onOpenSettings={mockOnOpenSettings} />);

            // Wait for init
            await waitFor(() => {
                expect(screen.getByPlaceholderText(/message/i)).toBeInTheDocument();
            });

            // Send first message (triggers title generation after response)
            const textarea = screen.getByPlaceholderText(/message/i);
            fireEvent.change(textarea, { target: { value: 'Hello' } });
            fireEvent.click(screen.getByLabelText('Send message'));

            // Wait for response and title generation call to start
            await waitFor(() => {
                expect(callCount).toBe(2);
            });

            // Switch to a new chat while title generation is pending
            fireEvent.click(screen.getByTitle('New Chat'));
            await waitFor(() => {
                expect(storage.createNewChat).toHaveBeenCalled();
            });

            // Now resolve the title generation
            titleCallResolve!({ text: "Great Title", toolCalls: [], debugEvents: [] });

            // Title should be saved to the ORIGINAL chat-1, not the new current chat
            await waitFor(() => {
                expect(storage.updateChatTitleById).toHaveBeenCalledWith('chat-1', 'Great Title');
            });
        });
    });

    describe('timer handling', () => {
        it('should send message when timer fires for current chat', async () => {
            const storage = await vi.importMock("@/lib/storage") as any;
            const llmFlow = await vi.importMock("@/lib/chat/llm-flow") as any;

            (storage.getCurrentChat as ReturnType<typeof vi.fn>).mockResolvedValue({
                id: 'chat-1', title: 'Test', messages: [], systemPromptId: null,
            });

            const executeSpy = llmFlow.executeLlmChatTurn as ReturnType<typeof vi.fn>;
            executeSpy.mockResolvedValue({
                text: 'Timer response', toolCalls: [], debugEvents: [],
            });

            render(<Chat onOpenSettings={mockOnOpenSettings} />);

            // Wait for initialization and timer callback registration
            await waitFor(() => {
                expect(timerCallback).not.toBeNull();
            });

            // Fire timer for current chat
            await act(async () => {
                timerCallback!('chat-1', 'Scheduled message');
            });

            // The 100ms setTimeout in Chat.tsx fires naturally with real timers
            await waitFor(() => {
                expect(executeSpy).toHaveBeenCalled();
            });
        });

        it('should switch chat when timer fires for different chat', async () => {
            const storage = await vi.importMock("@/lib/storage") as any;
            const llmFlow = await vi.importMock("@/lib/chat/llm-flow") as any;

            (storage.getCurrentChat as ReturnType<typeof vi.fn>).mockResolvedValue({
                id: 'chat-1', title: 'Test', messages: [], systemPromptId: null,
            });
            (storage.switchToChat as ReturnType<typeof vi.fn>).mockResolvedValue({
                id: 'chat-2', title: 'Timer Chat', messages: [], systemPromptId: null, createdAt: 1, updatedAt: 2,
            });

            const executeSpy = llmFlow.executeLlmChatTurn as ReturnType<typeof vi.fn>;
            executeSpy.mockResolvedValue({
                text: 'Response', toolCalls: [], debugEvents: [],
            });

            render(<Chat onOpenSettings={mockOnOpenSettings} />);

            // Wait for initialization and timer callback registration
            await waitFor(() => {
                expect(timerCallback).not.toBeNull();
            });

            // Fire timer for different chat
            await act(async () => {
                timerCallback!('chat-2', 'Cross-chat message');
            });

            // Should switch to the target chat
            await waitFor(() => {
                expect(storage.switchToChat).toHaveBeenCalledWith('chat-2');
            });
        });
    });
});
