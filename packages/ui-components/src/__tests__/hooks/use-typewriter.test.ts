import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTypewriter } from '@dmnpc/ui-components/hooks/use-typewriter';

describe('useTypewriter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with empty displayedText and isComplete false', () => {
    const { result } = renderHook(() => useTypewriter('Hello'));
    expect(result.current.displayedText).toBe('');
    expect(result.current.isComplete).toBe(false);
  });

  it('types characters incrementally at the given speed', () => {
    // speed=10 chars/sec → 100ms per char
    const { result } = renderHook(() => useTypewriter('Hi', { speed: 10 }));

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.displayedText).toBe('H');

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.displayedText).toBe('Hi');
    expect(result.current.isComplete).toBe(true);
  });

  it('completes after all characters are typed', () => {
    const { result } = renderHook(() => useTypewriter('AB', { speed: 10 }));

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.displayedText).toBe('AB');
    expect(result.current.isComplete).toBe(true);
  });

  it('skip() immediately shows full text and marks complete', () => {
    const { result } = renderHook(() => useTypewriter('Hello world'));

    act(() => {
      result.current.skip();
    });
    expect(result.current.displayedText).toBe('Hello world');
    expect(result.current.isComplete).toBe(true);
  });

  it('skip() calls onComplete callback', () => {
    const onComplete = vi.fn();
    const { result } = renderHook(() => useTypewriter('Hi', { onComplete }));

    act(() => {
      result.current.skip();
    });
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('reset() clears text and starts over', () => {
    const { result } = renderHook(() => useTypewriter('Hi', { speed: 10 }));

    // Advance to completion
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.isComplete).toBe(true);

    // Reset
    act(() => {
      result.current.reset();
    });
    expect(result.current.displayedText).toBe('');
    expect(result.current.isComplete).toBe(false);
  });

  it('respects startDelay before beginning', () => {
    const { result } = renderHook(() => useTypewriter('Hi', { speed: 10, startDelay: 500 }));

    // Before delay: nothing typed
    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(result.current.displayedText).toBe('');
    expect(result.current.isComplete).toBe(false);

    // Cross the delay threshold — React re-renders + new effect sets up interval
    act(() => {
      vi.advanceTimersByTime(2); // now at 501ms; timeout fires, hasStarted becomes true
    });

    // Advance through typing time (speed=10 → 100ms/char; 'H' at 100ms, 'i' at 200ms)
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.displayedText.length).toBeGreaterThan(0);
  });

  it('calls onComplete when typing finishes naturally', () => {
    const onComplete = vi.fn();
    renderHook(() => useTypewriter('Hi', { speed: 10, onComplete }));

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('handles empty string: displayedText stays empty, isComplete stays false', () => {
    // The hook guards with `if (!hasStarted || !text) return` — empty string is falsy,
    // so the typing effect never runs and isComplete is never set to true.
    const { result } = renderHook(() => useTypewriter(''));

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.displayedText).toBe('');
    expect(result.current.isComplete).toBe(false);
  });
});
