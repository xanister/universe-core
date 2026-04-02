import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Skeleton } from '@dmnpc/ui-components/components/skeleton';

describe('Skeleton', () => {
  it('renders a div with data-slot="skeleton"', () => {
    const { container } = render(<Skeleton />);
    const el = container.querySelector('[data-slot="skeleton"]');
    expect(el).toBeInTheDocument();
  });

  it('applies animate-pulse class', () => {
    const { container } = render(<Skeleton />);
    const el = container.querySelector('[data-slot="skeleton"]');
    expect(el?.className).toContain('animate-pulse');
  });

  it('applies custom className', () => {
    const { container } = render(<Skeleton className="h-4 w-full" />);
    const el = container.querySelector('[data-slot="skeleton"]');
    expect(el?.className).toContain('h-4');
    expect(el?.className).toContain('w-full');
  });

  it('passes through additional props', () => {
    render(<Skeleton data-testid="my-skeleton" />);
    expect(screen.getByTestId('my-skeleton')).toBeInTheDocument();
  });
});
