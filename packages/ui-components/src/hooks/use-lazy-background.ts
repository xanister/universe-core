'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Hook that defers loading a CSS background image until the element enters the viewport.
 *
 * Uses IntersectionObserver with a 200px rootMargin to start loading slightly before
 * the element scrolls into view. Once visible, the observer disconnects (load once).
 *
 * Usage:
 * ```tsx
 * const { ref, backgroundImage } = useLazyBackgroundImage(imageUrl);
 * return <div ref={ref} style={{ backgroundImage }} />;
 * ```
 *
 * @param imageUrl - The image URL to lazy-load, or null/undefined to skip.
 * @returns An object with a ref to attach to the container element and
 *          the `backgroundImage` CSS value (undefined until visible).
 */
export function useLazyBackgroundImage(imageUrl: string | null | undefined): {
  ref: React.RefObject<HTMLDivElement | null>;
  backgroundImage: string | undefined;
} {
  const ref = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || !imageUrl) return;

    // If already visible (e.g. above the fold), skip observer
    if (isVisible) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [imageUrl, isVisible]);

  const backgroundImage = isVisible && imageUrl ? `url("${imageUrl}")` : undefined;
  return { ref, backgroundImage };
}
