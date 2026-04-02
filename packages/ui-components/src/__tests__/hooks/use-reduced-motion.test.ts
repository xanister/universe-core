import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useReducedMotion } from '@dmnpc/ui-components/hooks/use-reduced-motion';

function mockMatchMedia(matches: boolean) {
  const listeners: Array<(e: MediaQueryListEvent) => void> = [];
  const mql = {
    matches,
    addEventListener: vi.fn((_: string, handler: (e: MediaQueryListEvent) => void) => {
      listeners.push(handler);
    }),
    removeEventListener: vi.fn((_: string, handler: (e: MediaQueryListEvent) => void) => {
      const idx = listeners.indexOf(handler);
      if (idx !== -1) listeners.splice(idx, 1);
    }),
    _trigger: (newMatches: boolean) => {
      listeners.forEach((fn) => fn({ matches: newMatches } as MediaQueryListEvent));
    },
  };
  vi.spyOn(window, 'matchMedia').mockReturnValue(mql as unknown as MediaQueryList);
  return mql;
}

describe('useReducedMotion', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false when prefers-reduced-motion is not set', () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it('returns true when prefers-reduced-motion: reduce is active', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it('updates when media query changes', () => {
    const mql = mockMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);

    act(() => {
      mql._trigger(true);
    });
    expect(result.current).toBe(true);
  });

  it('unsubscribes from media query on unmount', () => {
    const mql = mockMatchMedia(false);
    const { unmount } = renderHook(() => useReducedMotion());
    unmount();
    expect(mql.removeEventListener).toHaveBeenCalled();
  });
});
