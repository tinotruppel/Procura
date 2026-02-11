import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Settings } from './Settings';

// Mock storage functions
vi.mock('@/lib/storage', () => ({
    getProvider: vi.fn(() => Promise.resolve('gemini')),
    setProvider: vi.fn(() => Promise.resolve()),
    getApiKeys: vi.fn(() => Promise.resolve({})),
    setApiKeys: vi.fn(() => Promise.resolve()),
    getModels: vi.fn(() => Promise.resolve({ gemini: 'gemini-pro', claude: 'claude-3-opus', openai: 'gpt-4' })),
    setModels: vi.fn(() => Promise.resolve()),
    getDebugMode: vi.fn(() => Promise.resolve(false)),
    setDebugMode: vi.fn(() => Promise.resolve()),
    getToolConfigs: vi.fn(() => Promise.resolve({})),
    setToolConfigs: vi.fn(() => Promise.resolve()),
    getSystemPrompts: vi.fn(() => Promise.resolve([])),
    addSystemPrompt: vi.fn(() => Promise.resolve()),
    updateSystemPrompt: vi.fn(() => Promise.resolve()),
    deleteSystemPrompt: vi.fn(() => Promise.resolve()),
    getLangfuseConfig: vi.fn(() => Promise.resolve({ enabled: false, publicKey: '', secretKey: '', host: '' })),
    setLangfuseConfig: vi.fn(() => Promise.resolve()),
    getPromptVariables: vi.fn(() => Promise.resolve([])),
    setPromptVariables: vi.fn(() => Promise.resolve()),
    getCustomBaseUrl: vi.fn(() => Promise.resolve('')),
    setCustomBaseUrl: vi.fn(() => Promise.resolve()),
    exportConfig: vi.fn(() => Promise.resolve({})),
    importConfig: vi.fn(() => Promise.resolve()),
    getTheme: vi.fn(() => Promise.resolve('system')),
    setTheme: vi.fn(() => Promise.resolve()),
}));

// Mock custom OpenAI
vi.mock('@/lib/custom-openai', () => ({
    fetchCustomModels: vi.fn(() => Promise.resolve([])),
}));

// Mock Langfuse
vi.mock('@/lib/langfuse', () => ({
    testLangfuseConnection: vi.fn(() => Promise.resolve({ success: true, promptCount: 5 })),
}));

// Mock platform
vi.mock('@/platform', () => ({
    platform: {
        name: 'web',
        isExtension: false,
    },
}));

// Mock memory store
vi.mock('@/lib/memory-store', () => ({
    getMemoryEntryCount: vi.fn(() => Promise.resolve(0)),
    clearAllMemory: vi.fn(() => Promise.resolve()),
}));

// Mock tools with proper structure
vi.mock('@/tools', () => ({
    allTools: [
        {
            name: 'calculator',
            definition: {
                name: 'calculator',
                description: 'Calculator tool',
                parameters: {},
            },
            enabledByDefault: true,
            settingsFields: [],
        },
    ],
    ToolConfigMap: {},
}));

// Mock llm-types
vi.mock('@/lib/llm-types', () => ({
    GEMINI_MODELS: [{ id: 'gemini-pro', name: 'Gemini Pro' }],
    CLAUDE_MODELS: [{ id: 'claude-3-opus', name: 'Claude 3 Opus' }],
    OPENAI_MODELS: [{ id: 'gpt-4', name: 'GPT-4' }],
    PROVIDER_LABELS: { gemini: 'Gemini', claude: 'Claude', openai: 'OpenAI', custom: 'Custom' },
    DEFAULT_MODELS: { gemini: 'gemini-pro', claude: 'claude-3-opus', openai: 'gpt-4' },
}));

// Mock sub-components
vi.mock('@/components/McpServerSettings', () => ({
    McpServerSettings: () => <div data-testid="mcp-settings">MCP Settings</div>,
}));

vi.mock('@/components/CloudSettings', () => ({
    CloudSettings: () => <div data-testid="cloud-settings">Cloud Settings</div>,
}));

describe('Settings', () => {
    const mockOnBack = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('initial render', () => {
        it('should render settings page with title', async () => {
            render(<Settings onBack={mockOnBack} />);

            await waitFor(() => {
                expect(screen.getByText('Settings')).toBeInTheDocument();
            });
        });

        it('should render back button', async () => {
            render(<Settings onBack={mockOnBack} />);

            await waitFor(() => {
                const buttons = screen.getAllByRole('button');
                expect(buttons.length).toBeGreaterThan(0);
            });
        });
    });

    describe('navigation', () => {
        it('should call onBack when back button is clicked', async () => {
            render(<Settings onBack={mockOnBack} />);

            await waitFor(() => {
                const backBtn = screen.getAllByRole('button')[0];
                fireEvent.click(backBtn);
            });

            expect(mockOnBack).toHaveBeenCalled();
        });
    });

    describe('provider section', () => {
        it('should render AI Provider section', async () => {
            render(<Settings onBack={mockOnBack} />);

            await waitFor(() => {
                expect(screen.getByText('AI Provider')).toBeInTheDocument();
            });
        });

        it('should render Provider label', async () => {
            render(<Settings onBack={mockOnBack} />);

            await waitFor(() => {
                expect(screen.getByText('Provider')).toBeInTheDocument();
            });
        });
    });

    describe('cloud settings', () => {
        it('should render cloud settings component', async () => {
            render(<Settings onBack={mockOnBack} />);

            await waitFor(() => {
                expect(screen.getByTestId('cloud-settings')).toBeInTheDocument();
            });
        });
    });

    describe('MCP settings', () => {
        it('should render MCP settings component', async () => {
            render(<Settings onBack={mockOnBack} />);

            await waitFor(() => {
                expect(screen.getByTestId('mcp-settings')).toBeInTheDocument();
            });
        });
    });

    describe('export/import', () => {
        it('should have export button with title', async () => {
            render(<Settings onBack={mockOnBack} />);

            await waitFor(() => {
                expect(screen.getByTitle('Export Config')).toBeInTheDocument();
            });
        });

        it('should have import button with title', async () => {
            render(<Settings onBack={mockOnBack} />);

            await waitFor(() => {
                expect(screen.getByTitle('Import Config')).toBeInTheDocument();
            });
        });
    });

    describe('system prompts', () => {
        it('should render System Prompts section', async () => {
            render(<Settings onBack={mockOnBack} />);

            await waitFor(() => {
                expect(screen.getByText('System Prompts')).toBeInTheDocument();
            });
        });

        it('should have Add button for system prompts', async () => {
            render(<Settings onBack={mockOnBack} />);

            await waitFor(() => {
                expect(screen.getByText('Add')).toBeInTheDocument();
            });
        });
    });

    describe('langfuse integration', () => {
        it('should render Langfuse Integration section', async () => {
            render(<Settings onBack={mockOnBack} />);

            await waitFor(() => {
                expect(screen.getByText('Langfuse Integration')).toBeInTheDocument();
            });
        });

        it('should have Langfuse toggle', async () => {
            render(<Settings onBack={mockOnBack} />);

            await waitFor(() => {
                expect(screen.getByText('Remote prompts and tracing for observability')).toBeInTheDocument();
            });
        });
    });

    describe('tools section', () => {
        it('should render Tools section', async () => {
            render(<Settings onBack={mockOnBack} />);

            await waitFor(() => {
                expect(screen.getByText('Tools')).toBeInTheDocument();
            });
        });
    });
});
