import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Input } from './input';

describe('Input', () => {
    describe('rendering', () => {
        it('should render an input element', () => {
            render(<Input />);
            expect(screen.getByRole('textbox')).toBeInTheDocument();
        });

        it('should render with placeholder text', () => {
            render(<Input placeholder="Enter text..." />);
            expect(screen.getByPlaceholderText('Enter text...')).toBeInTheDocument();
        });

        it('should render with a specific type', () => {
            render(<Input type="email" data-testid="email-input" />);
            const input = screen.getByTestId('email-input');
            expect(input).toHaveAttribute('type', 'email');
        });
    });

    describe('interactions', () => {
        it('should handle value changes', () => {
            const handleChange = vi.fn();
            render(<Input onChange={handleChange} />);

            fireEvent.change(screen.getByRole('textbox'), { target: { value: 'test' } });
            expect(handleChange).toHaveBeenCalled();
        });

        it('should display the entered value', () => {
            render(<Input defaultValue="initial" />);
            const input = screen.getByRole('textbox');

            expect(input).toHaveValue('initial');

            fireEvent.change(input, { target: { value: 'updated' } });
            expect(input).toHaveValue('updated');
        });

        it('should be disabled when disabled prop is true', () => {
            render(<Input disabled />);
            const input = screen.getByRole('textbox');

            expect(input).toBeDisabled();
            expect(input).toHaveClass('disabled:opacity-50', 'disabled:cursor-not-allowed');
        });

        it('should be readonly when readOnly prop is true', () => {
            render(<Input readOnly defaultValue="readonly" />);
            const input = screen.getByRole('textbox');

            expect(input).toHaveAttribute('readonly');
        });
    });

    describe('styling', () => {
        it('should have default styling classes', () => {
            render(<Input />);
            const input = screen.getByRole('textbox');

            expect(input).toHaveClass('h-10', 'w-full', 'rounded-md', 'border');
        });

        it('should merge custom className', () => {
            render(<Input className="custom-input-class" />);
            const input = screen.getByRole('textbox');

            expect(input).toHaveClass('custom-input-class');
        });

        it('should forward ref to the input element', () => {
            const ref = { current: null as HTMLInputElement | null };
            render(<Input ref={ref} />);

            expect(ref.current).toBeInstanceOf(HTMLInputElement);
        });
    });

    describe('accessibility', () => {
        it('should support aria-label', () => {
            render(<Input aria-label="Search input" />);
            expect(screen.getByLabelText('Search input')).toBeInTheDocument();
        });

        it('should support aria-describedby', () => {
            render(
                <>
                    <Input aria-describedby="helper-text" />
                    <span id="helper-text">Enter your email address</span>
                </>
            );
            const input = screen.getByRole('textbox');
            expect(input).toHaveAttribute('aria-describedby', 'helper-text');
        });
    });
});
