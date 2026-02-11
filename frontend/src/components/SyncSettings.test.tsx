import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SyncSettings } from './SyncSettings';

// Mock sync service
vi.mock('@/lib/sync-service', () => ({
    getSyncSettings: vi.fn(() => Promise.resolve({ enabled: false })),
    setupNewSync: vi.fn(() => Promise.resolve()),
    disableSync: vi.fn(() => Promise.resolve()),
    performSync: vi.fn(() => Promise.resolve()),
    getSyncUserId: vi.fn(() => Promise.resolve('user-123')),
}));

describe('SyncSettings', () => {
    const mockOnSyncComplete = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('initial render', () => {
        it('should render sync settings section with title', async () => {
            render(<SyncSettings />);

            await waitFor(() => {
                expect(screen.getByText('Cross-Device Sync')).toBeInTheDocument();
            });
        });

        it('should render with onSyncComplete callback', async () => {
            render(<SyncSettings onSyncComplete={mockOnSyncComplete} />);

            await waitFor(() => {
                expect(screen.getByText('Cross-Device Sync')).toBeInTheDocument();
            });
        });
    });

    describe('disabled state UI', () => {
        it('should show Enable Sync button when disabled', async () => {
            render(<SyncSettings />);

            await waitFor(() => {
                expect(screen.getByText('Enable Sync')).toBeInTheDocument();
            });
        });

        it('should show API key input when disabled', async () => {
            render(<SyncSettings />);

            await waitFor(() => {
                expect(screen.getByPlaceholderText('Enter API key...')).toBeInTheDocument();
            });
        });
    });
});
