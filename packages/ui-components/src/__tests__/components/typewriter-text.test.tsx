import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import { TypewriterText } from '@dmnpc/ui-components/components/typewriter-text';

describe('TypewriterText', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the container div', () => {
    const { container } = render(<TypewriterText text="Hello" />);
    expect(container.querySelector('div')).toBeInTheDocument();
  });

  it('renders all text characters (including transparent ones)', () => {
    const { container } = render(<TypewriterText text="Hi" />);
    // All chars are rendered, typed ones at opacity 1, others at opacity 0
    const spans = container.querySelectorAll('span');
    // Should have at least 2 char spans plus cursor
    expect(spans.length).toBeGreaterThanOrEqual(2);
  });

  it('shows cursor initially when typing is in progress', () => {
    const { container } = render(<TypewriterText text="Hello" showCursor cursor="█" />);
    const cursorSpan = Array.from(container.querySelectorAll('span')).find(
      (el) => el.textContent === '█',
    );
    expect(cursorSpan).toBeDefined();
  });

  it('hides cursor after typing completes', () => {
    const { container } = render(<TypewriterText text="Hi" speed={100} showCursor cursor="█" />);

    act(() => {
      vi.advanceTimersByTime(100); // speed=100 chars/sec → 10ms/char, 20ms total
    });

    // After skip/completion cursor should be gone
    act(() => {
      vi.runAllTimers();
    });

    const cursorSpan = Array.from(container.querySelectorAll('span')).find(
      (el) => el.textContent === '█',
    );
    expect(cursorSpan).toBeUndefined();
  });

  it('skips to end on click when clickToSkip=true (default)', () => {
    const onSkip = vi.fn();
    const { container } = render(
      <TypewriterText text="Hello world" clickToSkip onSkip={onSkip} speed={10} />,
    );

    act(() => {
      fireEvent.click(container.querySelector('div')!);
    });
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it('does not skip on click when clickToSkip=false', () => {
    const onSkip = vi.fn();
    const { container } = render(
      <TypewriterText text="Hello world" clickToSkip={false} onSkip={onSkip} speed={10} />,
    );

    act(() => {
      fireEvent.click(container.querySelector('div')!);
    });
    expect(onSkip).not.toHaveBeenCalled();
  });

  it('calls onComplete when typing finishes', () => {
    const onComplete = vi.fn();
    render(<TypewriterText text="Hi" speed={100} onComplete={onComplete} />);

    act(() => {
      vi.runAllTimers();
    });

    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('applies custom className to the container', () => {
    const { container } = render(<TypewriterText text="Hi" className="my-class" />);
    expect(container.querySelector('div')?.className).toContain('my-class');
  });

  it('uses custom cursor character', () => {
    const { container } = render(<TypewriterText text="Hi" cursor="|" showCursor />);
    const cursorSpan = Array.from(container.querySelectorAll('span')).find(
      (el) => el.textContent === '|',
    );
    expect(cursorSpan).toBeDefined();
  });

  it('hides cursor when showCursor=false', () => {
    const { container } = render(<TypewriterText text="Hi" showCursor={false} cursor="█" />);
    const cursorSpan = Array.from(container.querySelectorAll('span')).find(
      (el) => el.textContent === '█',
    );
    expect(cursorSpan).toBeUndefined();
  });
});
