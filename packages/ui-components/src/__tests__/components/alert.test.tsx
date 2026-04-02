import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Alert, AlertTitle, AlertDescription } from '@dmnpc/ui-components/components/alert';

describe('Alert', () => {
  it('renders with role="alert"', () => {
    render(<Alert>Test alert</Alert>);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders children', () => {
    render(<Alert>Something went wrong</Alert>);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    render(<Alert className="custom-class">Alert</Alert>);
    expect(screen.getByRole('alert')).toHaveClass('custom-class');
  });

  it('renders default variant without extra destructive classes', () => {
    render(<Alert variant="default">Default alert</Alert>);
    const el = screen.getByRole('alert');
    expect(el).toHaveAttribute('data-slot', 'alert');
  });

  it('renders destructive variant', () => {
    render(<Alert variant="destructive">Error!</Alert>);
    const el = screen.getByRole('alert');
    expect(el.className).toContain('destructive');
  });
});

describe('AlertTitle', () => {
  it('renders children', () => {
    render(<AlertTitle>Error</AlertTitle>);
    expect(screen.getByText('Error')).toBeInTheDocument();
  });

  it('has data-slot="alert-title"', () => {
    render(<AlertTitle>Title</AlertTitle>);
    expect(screen.getByText('Title')).toHaveAttribute('data-slot', 'alert-title');
  });
});

describe('AlertDescription', () => {
  it('renders children', () => {
    render(<AlertDescription>More details here</AlertDescription>);
    expect(screen.getByText('More details here')).toBeInTheDocument();
  });

  it('has data-slot="alert-description"', () => {
    render(<AlertDescription>Desc</AlertDescription>);
    expect(screen.getByText('Desc')).toHaveAttribute('data-slot', 'alert-description');
  });
});

describe('Alert composition', () => {
  it('renders Alert with title and description together', () => {
    render(
      <Alert>
        <AlertTitle>Heads up!</AlertTitle>
        <AlertDescription>You can add components and dependencies.</AlertDescription>
      </Alert>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Heads up!')).toBeInTheDocument();
    expect(screen.getByText('You can add components and dependencies.')).toBeInTheDocument();
  });
});
