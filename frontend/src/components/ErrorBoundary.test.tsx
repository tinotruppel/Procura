import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

// Component that throws an error
const ThrowError = ({ shouldThrow }: { shouldThrow: boolean }) => {
    if (shouldThrow) {
        throw new Error('Test error message');
    }
    return <div>No error</div>;
};

// Suppress error console output during tests
const originalError = console.error;
beforeEach(() => {
    console.error = vi.fn();
});
afterEach(() => {
    console.error = originalError;
});

describe('ErrorBoundary', () => {
    describe('when no error occurs', () => {
        it('should render children normally', () => {
            render(
                <ErrorBoundary>
                    <div>Child content</div>
                </ErrorBoundary>
            );
            expect(screen.getByText('Child content')).toBeInTheDocument();
        });

        it('should not show error UI', () => {
            render(
                <ErrorBoundary>
                    <div>Normal content</div>
                </ErrorBoundary>
            );
            expect(screen.queryByText('Reload')).not.toBeInTheDocument();
        });
    });

    describe('when an error occurs', () => {
        it('should catch errors and display error UI', () => {
            render(
                <ErrorBoundary>
                    <ThrowError shouldThrow={true} />
                </ErrorBoundary>
            );

            expect(screen.getByText('Error')).toBeInTheDocument();
            expect(screen.getByText('Test error message')).toBeInTheDocument();
            expect(screen.getByText('Reload')).toBeInTheDocument();
        });

        it('should display error name', () => {
            render(
                <ErrorBoundary>
                    <ThrowError shouldThrow={true} />
                </ErrorBoundary>
            );

            expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Error');
        });

        it('should log error to console', () => {
            render(
                <ErrorBoundary>
                    <ThrowError shouldThrow={true} />
                </ErrorBoundary>
            );

            expect(console.error).toHaveBeenCalled();
        });

        it('should render custom fallback when provided', () => {
            render(
                <ErrorBoundary fallback={<div>Custom error message</div>}>
                    <ThrowError shouldThrow={true} />
                </ErrorBoundary>
            );

            expect(screen.getByText('Custom error message')).toBeInTheDocument();
            expect(screen.queryByText('Reload')).not.toBeInTheDocument();
        });

        it('should show reload button that calls window.location.reload', () => {
            const reloadMock = vi.fn();
            Object.defineProperty(window, 'location', {
                value: { reload: reloadMock },
                writable: true,
            });

            render(
                <ErrorBoundary>
                    <ThrowError shouldThrow={true} />
                </ErrorBoundary>
            );

            fireEvent.click(screen.getByText('Reload'));
            expect(reloadMock).toHaveBeenCalled();
        });
    });

    describe('error message handling', () => {
        it('should handle minified React errors', () => {
            const MinifiedError = () => {
                throw new Error('Minified React error #123');
            };

            render(
                <ErrorBoundary>
                    <MinifiedError />
                </ErrorBoundary>
            );

            expect(screen.getByText(/rendering error occurred/i)).toBeInTheDocument();
        });

        it('should display default message when error has no message', () => {
            const NoMessageError = () => {
                const error = new Error();
                error.message = '';
                throw error;
            };

            render(
                <ErrorBoundary>
                    <NoMessageError />
                </ErrorBoundary>
            );

            // Should still render without crashing
            expect(screen.getByText('Reload')).toBeInTheDocument();
        });
    });
});
