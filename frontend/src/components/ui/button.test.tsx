import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from './button';

describe('Button', () => {
    describe('rendering', () => {
        it('should render a button with text content', () => {
            render(<Button>Click me</Button>);
            expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
        });

        it('should render as a different element when asChild is true', () => {
            render(
                <Button asChild>
                    <a href="/test">Link Button</a>
                </Button>
            );
            expect(screen.getByRole('link', { name: 'Link Button' })).toBeInTheDocument();
        });
    });

    describe('variants', () => {
        it('should apply default variant classes', () => {
            render(<Button>Default</Button>);
            const button = screen.getByRole('button');
            expect(button).toHaveClass('bg-primary', 'text-primary-foreground');
        });

        it('should apply secondary variant classes', () => {
            render(<Button variant="secondary">Secondary</Button>);
            const button = screen.getByRole('button');
            expect(button).toHaveClass('bg-secondary', 'text-secondary-foreground');
        });

        it('should apply ghost variant classes', () => {
            render(<Button variant="ghost">Ghost</Button>);
            const button = screen.getByRole('button');
            expect(button).toHaveClass('hover:bg-accent');
        });

        it('should apply outline variant classes', () => {
            render(<Button variant="outline">Outline</Button>);
            const button = screen.getByRole('button');
            expect(button).toHaveClass('border', 'border-input');
        });
    });

    describe('sizes', () => {
        it('should apply default size classes', () => {
            render(<Button>Default Size</Button>);
            const button = screen.getByRole('button');
            expect(button).toHaveClass('h-10', 'px-4', 'py-2');
        });

        it('should apply small size classes', () => {
            render(<Button size="sm">Small</Button>);
            const button = screen.getByRole('button');
            expect(button).toHaveClass('h-9', 'px-3');
        });

        it('should apply large size classes', () => {
            render(<Button size="lg">Large</Button>);
            const button = screen.getByRole('button');
            expect(button).toHaveClass('h-11', 'px-8');
        });

        it('should apply icon size classes', () => {
            render(<Button size="icon">🔍</Button>);
            const button = screen.getByRole('button');
            expect(button).toHaveClass('h-10', 'w-10');
        });
    });

    describe('interactions', () => {
        it('should handle click events', () => {
            const handleClick = vi.fn();
            render(<Button onClick={handleClick}>Click me</Button>);

            fireEvent.click(screen.getByRole('button'));
            expect(handleClick).toHaveBeenCalledTimes(1);
        });

        it('should be disabled when disabled prop is true', () => {
            render(<Button disabled>Disabled</Button>);
            const button = screen.getByRole('button');

            expect(button).toBeDisabled();
            expect(button).toHaveClass('disabled:opacity-50');
        });

        it('should not trigger click when disabled', () => {
            const handleClick = vi.fn();
            render(<Button disabled onClick={handleClick}>Disabled</Button>);

            fireEvent.click(screen.getByRole('button'));
            expect(handleClick).not.toHaveBeenCalled();
        });
    });

    describe('styling', () => {
        it('should merge custom className', () => {
            render(<Button className="custom-class">Custom</Button>);
            const button = screen.getByRole('button');
            expect(button).toHaveClass('custom-class');
        });

        it('should forward ref to the button element', () => {
            const ref = { current: null as HTMLButtonElement | null };
            render(<Button ref={ref}>Ref Button</Button>);
            expect(ref.current).toBeInstanceOf(HTMLButtonElement);
        });
    });
});
