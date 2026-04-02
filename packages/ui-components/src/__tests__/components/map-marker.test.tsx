import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MapMarker } from '@dmnpc/ui-components/components/map-marker';

const defaultProps = {
  label: 'Town Square',
  position: { x: 0.5, y: 0.5 },
};

describe('MapMarker', () => {
  it('renders a button with the given aria-label', () => {
    render(<MapMarker {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'Town Square' })).toBeInTheDocument();
  });

  it('positions the button using percentage styles', () => {
    render(<MapMarker {...defaultProps} position={{ x: 0.25, y: 0.75 }} />);
    const btn = screen.getByRole('button');
    expect(btn.style.left).toBe('25%');
    expect(btn.style.top).toBe('75%');
  });

  it('is not disabled by default', () => {
    render(<MapMarker {...defaultProps} />);
    expect(screen.getByRole('button')).not.toBeDisabled();
  });

  it('can be disabled', () => {
    render(<MapMarker {...defaultProps} disabled />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<MapMarker {...defaultProps} onClick={onClick} />);
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not call onClick when disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<MapMarker {...defaultProps} disabled onClick={onClick} />);
    await user.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('applies sm size classes by default', () => {
    render(<MapMarker {...defaultProps} />);
    expect(screen.getByRole('button').className).toContain('w-7');
  });

  it('applies md size classes when size="md"', () => {
    render(<MapMarker {...defaultProps} size="md" />);
    expect(screen.getByRole('button').className).toContain('w-9');
  });

  it('applies custom className', () => {
    render(<MapMarker {...defaultProps} className="extra-class" />);
    expect(screen.getByRole('button').className).toContain('extra-class');
  });

  it('has type="button" to avoid form submission', () => {
    render(<MapMarker {...defaultProps} />);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });
});
