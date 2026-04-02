'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface UseTypewriterOptions {
  /** Characters per second (default: 40) */
  speed?: number;
  /** Delay before starting in ms (default: 0) */
  startDelay?: number;
  /** Called when typing completes */
  onComplete?: () => void;
}

interface UseTypewriterResult {
  /** The currently displayed text */
  displayedText: string;
  /** Whether the typewriter effect is complete */
  isComplete: boolean;
  /** Skip to the end and show all text */
  skip: () => void;
  /** Reset and start over */
  reset: () => void;
}

/**
 * Hook for typewriter text animation effect.
 *
 * @param text - The full text to display
 * @param options - Configuration options
 * @returns Object with displayedText, isComplete, skip, and reset
 *
 * @example
 * ```tsx
 * const { displayedText, isComplete, skip } = useTypewriter(narrative, { speed: 50 });
 *
 * return (
 *   <div onClick={skip}>
 *     {displayedText}
 *     {!isComplete && <span className="animate-pulse">█</span>}
 *   </div>
 * );
 * ```
 */
export function useTypewriter(
  text: string,
  options: UseTypewriterOptions = {},
): UseTypewriterResult {
  const { speed = 40, startDelay = 0, onComplete } = options;

  const [displayedText, setDisplayedText] = useState('');
  const [isComplete, setIsComplete] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const indexRef = useRef(0);
  const onCompleteRef = useRef(onComplete);

  // Keep onComplete ref updated in an effect to avoid updating refs during render
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // Clear interval on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  // Start delay timer
  useEffect(() => {
    if (startDelay > 0) {
      const timeout = setTimeout(() => {
        setHasStarted(true);
      }, startDelay);
      return () => clearTimeout(timeout);
    } else {
      setHasStarted(true);
      return undefined;
    }
  }, [startDelay]);

  // Main typing effect
  useEffect(() => {
    if (!hasStarted || !text) return;

    // Reset state when text changes - must be synchronous before interval starts
    indexRef.current = 0;
    setDisplayedText('');
    setIsComplete(false);

    if (text.length === 0) {
      setIsComplete(true);
      return;
    }

    const intervalMs = 1000 / speed;

    intervalRef.current = setInterval(() => {
      indexRef.current += 1;

      if (indexRef.current >= text.length) {
        setDisplayedText(text);
        setIsComplete(true);
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        onCompleteRef.current?.();
      } else {
        setDisplayedText(text.slice(0, indexRef.current));
      }
    }, intervalMs);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [text, speed, hasStarted]);

  const skip = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setDisplayedText(text);
    setIsComplete(true);
    onCompleteRef.current?.();
  }, [text]);

  const reset = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    indexRef.current = 0;
    setDisplayedText('');
    setIsComplete(false);
    setHasStarted(false);

    // Restart after delay
    if (startDelay > 0) {
      setTimeout(() => setHasStarted(true), startDelay);
    } else {
      setHasStarted(true);
    }
  }, [startDelay]);

  return {
    displayedText,
    isComplete,
    skip,
    reset,
  };
}
