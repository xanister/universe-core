import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsMobile } from '@dmnpc/ui-components/hooks/use-mobile';

const MOBILE_BREAKPOINT = 768;

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

describe('useIsMobile', () => {
  beforeEach(() => {
    // Default: desktop width
    Object.defineProperty(window, 'innerWidth', {
      value: 1024,
      writable: true,
      configurable: true,
    });
  });

  it('returns false on desktop viewport', () => {
    mockMatchMedia(false);
    Object.defineProperty(window, 'innerWidth', {
      value: 1024,
      writable: true,
      configurable: true,
    });
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('returns true on mobile viewport', () => {
    mockMatchMedia(true);
    Object.defineProperty(window, 'innerWidth', { value: 375, writable: true, configurable: true });
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('updates when viewport changes below breakpoint', () => {
    const mql = mockMatchMedia(false);
    Object.defineProperty(window, 'innerWidth', {
      value: 1024,
      writable: true,
      configurable: true,
    });
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => {
      Object.defineProperty(window, 'innerWidth', {
        value: MOBILE_BREAKPOINT - 1,
        writable: true,
        configurable: true,
      });
      mql._trigger(true);
    });
    expect(result.current).toBe(true);
  });
});
