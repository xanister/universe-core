import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { useLazyBackgroundImage } from '@dmnpc/ui-components/hooks/use-lazy-background';

describe('useLazyBackgroundImage', () => {
  it('returns undefined backgroundImage when not yet visible', () => {
    const { result } = renderHook(() => useLazyBackgroundImage('https://example.com/img.png'));
    expect(result.current.backgroundImage).toBeUndefined();
  });

  it('returns undefined when imageUrl is null', () => {
    const { result } = renderHook(() => useLazyBackgroundImage(null));
    expect(result.current.backgroundImage).toBeUndefined();
  });

  it('returns undefined when imageUrl is undefined', () => {
    const { result } = renderHook(() => useLazyBackgroundImage(undefined));
    expect(result.current.backgroundImage).toBeUndefined();
  });

  it('returns a ref object', () => {
    const { result } = renderHook(() => useLazyBackgroundImage('https://example.com/img.png'));
    expect(result.current.ref).toBeDefined();
    expect(typeof result.current.ref).toBe('object');
  });

  it('sets backgroundImage when intersection observer fires', () => {
    let observerCallback: IntersectionObserverCallback | null = null;
    const mockObserver = {
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    };
    vi.spyOn(global, 'IntersectionObserver').mockImplementation((callback) => {
      observerCallback = callback;
      return mockObserver as unknown as IntersectionObserver;
    });

    // Render a component so the ref gets attached to a real DOM element
    let capturedBg: string | undefined;
    function TestComponent() {
      const { ref, backgroundImage } = useLazyBackgroundImage('https://example.com/img.png');
      capturedBg = backgroundImage;
      return React.createElement('div', { ref });
    }

    render(React.createElement(TestComponent));

    // Simulate the element entering the viewport
    act(() => {
      observerCallback?.(
        [{ isIntersecting: true }] as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      );
    });

    expect(capturedBg).toBe('url("https://example.com/img.png")');
    expect(mockObserver.disconnect).toHaveBeenCalled();
  });
});
