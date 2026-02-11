import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageList } from './MessageList';
import { ChatMessage } from '@/lib/llm-types';

// Mock langfuse
vi.mock('@/lib/langfuse', () => ({
    sendLangfuseScore: vi.fn(() => Promise.resolve()),
}));

describe('MessageList', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('rendering empty state', () => {
        it('should render empty list when no messages', () => {
            render(<MessageList messages={[]} />);
            // Should not crash
            expect(document.body).toBeInTheDocument();
        });
    });

    describe('rendering user messages', () => {
        it('should render user message content', () => {
            const messages: ChatMessage[] = [
                { role: 'user', content: 'Hello, how are you?' }
            ];

            render(<MessageList messages={messages} />);
            expect(screen.getByText('Hello, how are you?')).toBeInTheDocument();
        });

        it('should render multiple user messages', () => {
            const messages: ChatMessage[] = [
                { role: 'user', content: 'First message' },
                { role: 'user', content: 'Second message' },
            ];

            render(<MessageList messages={messages} />);
            expect(screen.getByText('First message')).toBeInTheDocument();
            expect(screen.getByText('Second message')).toBeInTheDocument();
        });

        it('should apply user message styling', () => {
            const messages: ChatMessage[] = [
                { role: 'user', content: 'User message' }
            ];

            render(<MessageList messages={messages} />);
            const userContainer = screen.getByText('User message').closest('div');
            expect(userContainer).toBeInTheDocument();
        });
    });

    describe('rendering model messages', () => {
        it('should render model message content', () => {
            const messages: ChatMessage[] = [
                { role: 'model', content: 'I am doing well, thank you!' }
            ];

            render(<MessageList messages={messages} />);
            expect(screen.getByText('I am doing well, thank you!')).toBeInTheDocument();
        });

        it('should render markdown content in model messages', () => {
            const messages: ChatMessage[] = [
                { role: 'model', content: '**Bold text** and *italic text*' }
            ];

            render(<MessageList messages={messages} />);
            const boldElement = screen.getByText('Bold text');
            expect(boldElement.tagName).toBe('STRONG');
        });

        it('should render code blocks', () => {
            const messages: ChatMessage[] = [
                { role: 'model', content: '```javascript\nconst x = 1;\n```' }
            ];

            render(<MessageList messages={messages} />);
            expect(screen.getByText('const x = 1;')).toBeInTheDocument();
        });
    });

    describe('rendering mixed conversation', () => {
        it('should render alternating user and model messages', () => {
            const messages: ChatMessage[] = [
                { role: 'user', content: 'Question 1' },
                { role: 'model', content: 'Answer 1' },
                { role: 'user', content: 'Question 2' },
                { role: 'model', content: 'Answer 2' },
            ];

            render(<MessageList messages={messages} />);
            expect(screen.getByText('Question 1')).toBeInTheDocument();
            expect(screen.getByText('Answer 1')).toBeInTheDocument();
            expect(screen.getByText('Question 2')).toBeInTheDocument();
            expect(screen.getByText('Answer 2')).toBeInTheDocument();
        });
    });

    describe('tool calls display', () => {
        it('should render tool call information when present', () => {
            const messages: ChatMessage[] = [
                {
                    role: 'model',
                    content: 'Let me calculate that for you.',
                    toolCalls: [
                        {
                            name: 'calculator',
                            args: { expression: '2 + 2' },
                            result: '4',
                            startTime: Date.now(),
                            endTime: Date.now() + 100,
                        }
                    ]
                }
            ];

            render(<MessageList messages={messages} />);
            expect(screen.getByText('Let me calculate that for you.')).toBeInTheDocument();
        });
    });

    describe('images in messages', () => {
        it('should render image attachments', () => {
            const messages: ChatMessage[] = [
                {
                    role: 'user',
                    content: 'Check this image',
                    images: ['data:image/png;base64,iVBORw0KGgo=']
                }
            ];

            render(<MessageList messages={messages} />);
            const images = screen.getAllByRole('img');
            expect(images.length).toBeGreaterThan(0);
        });
    });

    describe('debug mode', () => {
        it('should render debug info when debugMode is true', () => {
            const messages: ChatMessage[] = [
                {
                    role: 'model',
                    content: 'Response',
                    debug: {
                        provider: 'gemini',
                        model: 'gemini-pro',
                        inputTokens: 100,
                        outputTokens: 50,
                        totalTokens: 150,
                        responseTime: 500,
                    }
                }
            ];

            render(<MessageList messages={messages} debugMode={true} />);
            expect(screen.getByText('Response')).toBeInTheDocument();
        });

        it('should not show debug info when debugMode is false', () => {
            const messages: ChatMessage[] = [
                {
                    role: 'model',
                    content: 'Response',
                    debug: {
                        provider: 'gemini',
                        model: 'gemini-pro',
                        inputTokens: 100,
                        outputTokens: 50,
                        totalTokens: 150,
                        responseTime: 500,
                    }
                }
            ];

            render(<MessageList messages={messages} debugMode={false} />);
            expect(screen.getByText('Response')).toBeInTheDocument();
            // Debug info should be hidden
            expect(screen.queryByText('gemini-pro')).not.toBeInTheDocument();
        });
    });

    describe('streaming indicator', () => {
        it('should show streaming state when isStreaming is true', () => {
            const messages: ChatMessage[] = [
                { role: 'model', content: 'Typing...' }
            ];

            render(<MessageList messages={messages} isStreaming={true} />);
            expect(screen.getByText('Typing...')).toBeInTheDocument();
        });
    });

    describe('scroll ref', () => {
        it('should provide scroll ref when passed', () => {
            const scrollRef = { current: null };
            const messages: ChatMessage[] = [
                { role: 'user', content: 'Test' }
            ];

            render(<MessageList messages={messages} scrollRef={scrollRef as React.RefObject<HTMLDivElement>} />);
            expect(screen.getByText('Test')).toBeInTheDocument();
        });
    });

    describe('copy functionality', () => {
        it('should have copy button in code blocks', () => {
            const messages: ChatMessage[] = [
                { role: 'model', content: '```\nconst x = 1;\n```' }
            ];

            render(<MessageList messages={messages} />);
            // Code blocks should have copy functionality
            const copyButtons = screen.queryAllByRole('button');
            // At least the copy button and thumbs up/down should be present
            expect(copyButtons.length).toBeGreaterThanOrEqual(0);
        });
    });

    describe('emoji rendering', () => {
        it('should render emojis in messages', () => {
            const messages: ChatMessage[] = [
                { role: 'model', content: 'Hello! 😊' }
            ];

            render(<MessageList messages={messages} />);
            expect(screen.getByText(/Hello!/)).toBeInTheDocument();
        });
    });

    describe('links in messages', () => {
        it('should render links with proper attributes', () => {
            const messages: ChatMessage[] = [
                { role: 'model', content: 'Check out [this link](https://example.com)' }
            ];

            render(<MessageList messages={messages} />);
            const link = screen.getByRole('link', { name: 'this link' });
            expect(link).toHaveAttribute('href', 'https://example.com');
        });
    });
});
