import { Component, ErrorInfo, ReactNode } from 'react';
import { Download, FileText } from 'lucide-react';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
    /** Callback to export current chat as markdown */
    onExportChat?: () => void;
    /** Callback to start a new thread */
    onNewThread?: () => void;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

/**
 * Error Boundary component to catch React rendering errors.
 * Displays a user-friendly error message instead of a white screen.
 * Provides recovery options: reload, export chat, start new thread.
 */
export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error: Error): Partial<State> {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        this.setState({ errorInfo });
        console.error('[ErrorBoundary] Caught error:', error);
        console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);
    }

    handleReset = (): void => {
        this.setState({ hasError: false, error: null, errorInfo: null });
    };

    handleReload = (): void => {
        window.location.reload();
    };

    handleExportChat = (): void => {
        if (this.props.onExportChat) {
            this.props.onExportChat();
        }
    };

    handleNewThread = (): void => {
        if (this.props.onNewThread) {
            this.props.onNewThread();
            // Reset error state to allow new thread to render
            this.handleReset();
        }
    };

    render(): JSX.Element {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return <>{this.props.fallback}</>;
            }

            // Extract a user-friendly error message
            const errorName = this.state.error?.name || 'Error';
            const errorMessage = this.state.error?.message || 'An unexpected error occurred';

            // Make minified React errors more readable
            const isMinifiedError = errorMessage.includes('Minified React error');
            const displayMessage = isMinifiedError
                ? 'A rendering error occurred. This is usually caused by a component crash.'
                : errorMessage;

            const hasRecoveryOptions = this.props.onExportChat || this.props.onNewThread;

            return (
                <div className="p-4 h-full flex items-center justify-center">
                    <div className="max-w-md p-4 rounded-lg border border-destructive/50 bg-destructive/10">
                        <div className="flex flex-col gap-3">
                            <div>
                                <h3 className="font-semibold text-destructive mb-1">{errorName}</h3>
                                <p className="text-sm text-muted-foreground">
                                    {displayMessage}
                                </p>
                            </div>
                            {this.state.errorInfo && (
                                <details>
                                    <summary className="cursor-pointer text-xs opacity-70 hover:opacity-100">
                                        Technical details
                                    </summary>
                                    <pre className="mt-2 text-xs overflow-auto max-h-32 p-2 bg-background/50 rounded text-muted-foreground whitespace-pre-wrap">
                                        {this.state.errorInfo.componentStack}
                                    </pre>
                                </details>
                            )}

                            {/* Primary action: Reload */}
                            <button
                                onClick={this.handleReload}
                                className="px-3 py-1.5 text-sm rounded border border-border hover:bg-accent"
                            >
                                Reload
                            </button>

                            {/* Recovery options */}
                            {hasRecoveryOptions && (
                                <div className="flex flex-col gap-2 pt-2 border-t border-border/50">
                                    <p className="text-xs text-muted-foreground">Recovery options:</p>

                                    {this.props.onExportChat && (
                                        <button
                                            onClick={this.handleExportChat}
                                            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded border border-border hover:bg-accent text-left"
                                        >
                                            <Download className="h-4 w-4" />
                                            Export Chat as Markdown
                                        </button>
                                    )}

                                    {this.props.onNewThread && (
                                        <button
                                            onClick={this.handleNewThread}
                                            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded border border-border hover:bg-accent text-left"
                                        >
                                            <FileText className="h-4 w-4" />
                                            Start New Thread
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            );
        }

        return <>{this.props.children}</>;
    }
}
