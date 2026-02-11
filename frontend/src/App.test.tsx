import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from './App';

vi.mock('@/lib/vault', () => ({
    restoreVaultFromSession: vi.fn(() => Promise.resolve(true)),
    isVaultUnlocked: vi.fn(() => true),
}));

vi.mock('@/lib/storage', () => ({
    getTheme: vi.fn(() => Promise.resolve('system')),
    applyTheme: vi.fn(),
}));

// Mock the Chat and Settings components to isolate App tests
vi.mock('@/components/Chat', () => ({
    Chat: ({ onOpenSettings }: { onOpenSettings: () => void }) => (
        <div data-testid="chat-view">
            <button onClick={onOpenSettings} data-testid="open-settings">
                Open Settings
            </button>
        </div>
    ),
}));

vi.mock('@/components/Settings', () => ({
    Settings: ({ onBack }: { onBack: () => void }) => (
        <div data-testid="settings-view">
            <button onClick={onBack} data-testid="back-to-chat">
                Back to Chat
            </button>
        </div>
    ),
}));

describe('App', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render the Chat view by default', async () => {
        render(<App />);

        expect(await screen.findByTestId('chat-view')).toBeInTheDocument();
        expect(screen.queryByTestId('settings-view')).not.toBeInTheDocument();
    });

    it('should switch to Settings view when onOpenSettings is called', async () => {
        render(<App />);

        // Initially shows Chat
        await screen.findByTestId('chat-view');

        // Click to open settings
        fireEvent.click(screen.getByTestId('open-settings'));

        // Now shows Settings
        expect(await screen.findByTestId('settings-view')).toBeInTheDocument();
        expect(screen.queryByTestId('chat-view')).not.toBeInTheDocument();
    });

    it('should switch back to Chat view when onBack is called', async () => {
        render(<App />);

        // Go to settings first
        await screen.findByTestId('open-settings');
        fireEvent.click(screen.getByTestId('open-settings'));
        await screen.findByTestId('settings-view');

        // Click back
        fireEvent.click(screen.getByTestId('back-to-chat'));

        // Back to Chat
        expect(await screen.findByTestId('chat-view')).toBeInTheDocument();
        expect(screen.queryByTestId('settings-view')).not.toBeInTheDocument();
    });

    it('should have correct container styling', async () => {
        const { container } = render(<App />);

        const appContainer = container.firstChild as HTMLElement;
        await waitFor(() => {
            expect(appContainer).toHaveClass('h-dvh', 'w-full', 'bg-background', 'overflow-hidden');
        });
    });
});
