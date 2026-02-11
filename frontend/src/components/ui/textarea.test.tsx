import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Textarea } from './textarea';

describe('Textarea', () => {
    describe('rendering', () => {
        it('should render a textarea element', () => {
            render(<Textarea data-testid="textarea" />);
            expect(screen.getByTestId('textarea')).toBeInTheDocument();
            expect(screen.getByTestId('textarea').tagName).toBe('TEXTAREA');
        });

        it('should render with placeholder text', () => {
            render(<Textarea placeholder="Enter description..." />);
            expect(screen.getByPlaceholderText('Enter description...')).toBeInTheDocument();
        });

        it('should render with default value', () => {
            render(<Textarea defaultValue="Initial content" data-testid="textarea" />);
            expect(screen.getByTestId('textarea')).toHaveValue('Initial content');
        });
    });

    describe('interactions', () => {
        it('should handle value changes', () => {
            const handleChange = vi.fn();
            render(<Textarea onChange={handleChange} data-testid="textarea" />);

            fireEvent.change(screen.getByTestId('textarea'), { target: { value: 'New text' } });
            expect(handleChange).toHaveBeenCalled();
        });

        it('should update value on user input', () => {
            render(<Textarea data-testid="textarea" />);
            const textarea = screen.getByTestId('textarea');

            fireEvent.change(textarea, { target: { value: 'Updated content' } });
            expect(textarea).toHaveValue('Updated content');
        });

        it('should be disabled when disabled prop is true', () => {
            render(<Textarea disabled data-testid="textarea" />);
            const textarea = screen.getByTestId('textarea');

            expect(textarea).toBeDisabled();
            expect(textarea).toHaveClass('disabled:opacity-50', 'disabled:cursor-not-allowed');
        });

        it('should be readonly when readOnly prop is true', () => {
            render(<Textarea readOnly defaultValue="readonly" data-testid="textarea" />);
            expect(screen.getByTestId('textarea')).toHaveAttribute('readonly');
        });
    });

    describe('styling', () => {
        it('should have default styling classes', () => {
            render(<Textarea data-testid="textarea" />);
            const textarea = screen.getByTestId('textarea');

            expect(textarea).toHaveClass('min-h-[80px]', 'w-full', 'rounded-md', 'border');
        });

        it('should merge custom className', () => {
            render(<Textarea className="custom-textarea" data-testid="textarea" />);
            expect(screen.getByTestId('textarea')).toHaveClass('custom-textarea');
        });

        it('should forward ref to the textarea element', () => {
            const ref = { current: null as HTMLTextAreaElement | null };
            render(<Textarea ref={ref} />);
            expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
        });
    });

    describe('attributes', () => {
        it('should support rows attribute', () => {
            render(<Textarea rows={5} data-testid="textarea" />);
            expect(screen.getByTestId('textarea')).toHaveAttribute('rows', '5');
        });

        it('should support maxLength attribute', () => {
            render(<Textarea maxLength={100} data-testid="textarea" />);
            expect(screen.getByTestId('textarea')).toHaveAttribute('maxlength', '100');
        });
    });
});
