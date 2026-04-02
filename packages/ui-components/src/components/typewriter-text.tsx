'use client';

import React from 'react';
import { useTypewriter } from '@dmnpc/ui-components/hooks/use-typewriter';
import { cn } from '@dmnpc/ui-components/lib/utils';

interface TypewriterTextProps {
  /** The full text to display with typewriter effect */
  text: string;
  /** Characters per second (default: 40) */
  speed?: number;
  /** Delay before starting in ms (default: 0) */
  startDelay?: number;
  /** Called when typing completes */
  onComplete?: () => void;
  /** Called when skip is triggered (useful for external control) */
  onSkip?: () => void;
  /** Additional className for the container */
  className?: string;
  /** Additional className for the text itself */
  textClassName?: string;
  /** Whether to show the blinking cursor (default: true) */
  showCursor?: boolean;
  /** Custom cursor character (default: █) */
  cursor?: string;
  /** ClassName for the cursor */
  cursorClassName?: string;
  /** Whether clicking should skip to end (default: true) */
  clickToSkip?: boolean;
}

/**
 * Renders text with typewriter effect while maintaining static container dimensions.
 *
 * All characters are rendered in their final positions from the start.
 * Untyped characters are transparent, typed characters are visible.
 * The cursor follows the last typed character.
 */
function TypewriterContent({
  text,
  typedLength,
  textClassName,
  showCursor,
  cursor,
  cursorClassName,
  isComplete,
}: {
  text: string;
  typedLength: number;
  textClassName?: string;
  showCursor: boolean;
  cursor: string;
  cursorClassName?: string;
  isComplete: boolean;
}) {
  // Render all characters, with untyped ones transparent
  // Insert cursor after the last typed character
  const elements: React.ReactNode[] = [];
  const chars = text.split('');

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    const isTyped = i < typedLength;

    if (char === '\n') {
      elements.push(<br key={i} />);
    } else {
      elements.push(
        <span key={i} style={{ opacity: isTyped ? 1 : 0 }}>
          {char}
        </span>,
      );
    }

    // Insert cursor after the last typed character
    if (showCursor && !isComplete && i === typedLength - 1) {
      elements.push(
        <span key="cursor" className={cn('animate-pulse', cursorClassName)}>
          {cursor}
        </span>,
      );
    }
  }

  // Show cursor at start if nothing typed yet
  if (showCursor && !isComplete && typedLength === 0) {
    elements.unshift(
      <span key="cursor" className={cn('animate-pulse', cursorClassName)}>
        {cursor}
      </span>,
    );
  }

  return <span className={cn(textClassName, 'whitespace-pre-wrap')}>{elements}</span>;
}

/**
 * Typewriter text component with static container dimensions.
 *
 * Renders all characters in their final positions from the start,
 * with untyped characters transparent. This ensures the container
 * size never changes and letters appear in place.
 *
 * For full control over isComplete/skip/reset, use useTypewriterText hook instead.
 *
 * @example
 * ```tsx
 * <TypewriterText
 *   text="Once upon a time..."
 *   speed={50}
 *   className="max-w-2xl"
 *   textClassName="text-lg text-white"
 * />
 * ```
 */
export function TypewriterText({
  text,
  speed = 40,
  startDelay = 0,
  onComplete,
  onSkip,
  className,
  textClassName,
  showCursor = true,
  cursor = '█',
  cursorClassName,
  clickToSkip = true,
}: TypewriterTextProps) {
  const { displayedText, isComplete, skip } = useTypewriter(text, {
    speed,
    startDelay,
    onComplete,
  });

  const handleClick = () => {
    if (clickToSkip && !isComplete) {
      skip();
      onSkip?.();
    }
  };

  return (
    <div
      className={cn('relative', className)}
      onClick={handleClick}
      style={{ cursor: clickToSkip && !isComplete ? 'pointer' : undefined }}
      title={clickToSkip && !isComplete ? 'Click to skip' : undefined}
    >
      <TypewriterContent
        text={text}
        typedLength={displayedText.length}
        textClassName={textClassName}
        showCursor={showCursor}
        cursor={cursor}
        cursorClassName={cursorClassName}
        isComplete={isComplete}
      />
    </div>
  );
}

/**
 * Hook-based alternative for more control.
 * Returns the component and control methods separately.
 */
export function useTypewriterText(props: TypewriterTextProps) {
  const { displayedText, isComplete, skip, reset } = useTypewriter(props.text, {
    speed: props.speed,
    startDelay: props.startDelay,
    onComplete: props.onComplete,
  });

  const handleClick = () => {
    if (props.clickToSkip !== false && !isComplete) {
      skip();
      props.onSkip?.();
    }
  };

  const component = (
    <div
      className={cn('relative', props.className)}
      onClick={handleClick}
      style={{ cursor: props.clickToSkip !== false && !isComplete ? 'pointer' : undefined }}
      title={props.clickToSkip !== false && !isComplete ? 'Click to skip' : undefined}
    >
      <TypewriterContent
        text={props.text}
        typedLength={displayedText.length}
        textClassName={props.textClassName}
        showCursor={props.showCursor !== false}
        cursor={props.cursor ?? '█'}
        cursorClassName={props.cursorClassName}
        isComplete={isComplete}
      />
    </div>
  );

  return {
    component,
    displayedText,
    isComplete,
    skip,
    reset,
  };
}
