import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card, CardHeader, CardTitle, CardContent } from './card';

describe('Card Components', () => {
    describe('Card', () => {
        it('should render a div element', () => {
            render(<Card data-testid="card">Content</Card>);
            const card = screen.getByTestId('card');
            expect(card).toBeInTheDocument();
            expect(card.tagName).toBe('DIV');
        });

        it('should apply default styling classes', () => {
            render(<Card data-testid="card">Content</Card>);
            const card = screen.getByTestId('card');
            expect(card).toHaveClass('rounded-lg', 'border', 'bg-card', 'shadow-sm');
        });

        it('should merge custom className', () => {
            render(<Card className="custom-card" data-testid="card">Content</Card>);
            expect(screen.getByTestId('card')).toHaveClass('custom-card');
        });

        it('should forward ref', () => {
            const ref = { current: null as HTMLDivElement | null };
            render(<Card ref={ref}>Content</Card>);
            expect(ref.current).toBeInstanceOf(HTMLDivElement);
        });

        it('should render children', () => {
            render(<Card>Card Content</Card>);
            expect(screen.getByText('Card Content')).toBeInTheDocument();
        });
    });

    describe('CardHeader', () => {
        it('should render with flex layout classes', () => {
            render(<CardHeader data-testid="header">Header</CardHeader>);
            const header = screen.getByTestId('header');
            expect(header).toHaveClass('flex', 'flex-col', 'space-y-1.5', 'p-6');
        });

        it('should merge custom className', () => {
            render(<CardHeader className="custom-header" data-testid="header">Header</CardHeader>);
            expect(screen.getByTestId('header')).toHaveClass('custom-header');
        });

        it('should forward ref', () => {
            const ref = { current: null as HTMLDivElement | null };
            render(<CardHeader ref={ref}>Header</CardHeader>);
            expect(ref.current).toBeInstanceOf(HTMLDivElement);
        });
    });

    describe('CardTitle', () => {
        it('should render as h3 element', () => {
            render(<CardTitle data-testid="title">Title</CardTitle>);
            const title = screen.getByTestId('title');
            expect(title.tagName).toBe('H3');
        });

        it('should apply typography classes', () => {
            render(<CardTitle data-testid="title">Title</CardTitle>);
            const title = screen.getByTestId('title');
            expect(title).toHaveClass('text-2xl', 'font-semibold', 'leading-none');
        });

        it('should merge custom className', () => {
            render(<CardTitle className="custom-title" data-testid="title">Title</CardTitle>);
            expect(screen.getByTestId('title')).toHaveClass('custom-title');
        });

        it('should forward ref', () => {
            const ref = { current: null as HTMLParagraphElement | null };
            render(<CardTitle ref={ref}>Title</CardTitle>);
            expect(ref.current).toBeInstanceOf(HTMLHeadingElement);
        });
    });

    describe('CardContent', () => {
        it('should render with padding classes', () => {
            render(<CardContent data-testid="content">Content</CardContent>);
            const content = screen.getByTestId('content');
            expect(content).toHaveClass('p-6', 'pt-0');
        });

        it('should merge custom className', () => {
            render(<CardContent className="custom-content" data-testid="content">Content</CardContent>);
            expect(screen.getByTestId('content')).toHaveClass('custom-content');
        });

        it('should forward ref', () => {
            const ref = { current: null as HTMLDivElement | null };
            render(<CardContent ref={ref}>Content</CardContent>);
            expect(ref.current).toBeInstanceOf(HTMLDivElement);
        });
    });

    describe('Card composition', () => {
        it('should render a complete card with all subcomponents', () => {
            render(
                <Card data-testid="card">
                    <CardHeader>
                        <CardTitle>Test Title</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p>Test content paragraph</p>
                    </CardContent>
                </Card>
            );

            expect(screen.getByTestId('card')).toBeInTheDocument();
            expect(screen.getByText('Test Title')).toBeInTheDocument();
            expect(screen.getByText('Test content paragraph')).toBeInTheDocument();
        });
    });
});
