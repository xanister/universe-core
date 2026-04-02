'use client';

import * as React from 'react';
import { DoorClosed } from 'lucide-react';
import { cn } from '@dmnpc/ui-components/lib/utils';

export interface MapMarkerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** The label for accessibility */
  label: string;
  /** Normalized position (0-1) on the map */
  position: { x: number; y: number };
  /** Size variant */
  size?: 'sm' | 'md';
}

const sizeClasses = {
  sm: 'w-7 h-7',
  md: 'w-9 h-9',
} as const;

const iconSizeClasses = {
  sm: 'h-3 w-3',
  md: 'h-4 w-4',
} as const;

export const MapMarker = React.forwardRef<HTMLButtonElement, MapMarkerProps>(
  ({ label, position, disabled = false, size = 'sm', className, ...props }, ref) => {
    const baseStyles = cn(
      'absolute flex items-center justify-center rounded-full transition-all duration-300 cursor-pointer',
      'bg-amber-900/40 text-amber-100 border-2 border-amber-400/50',
      'shadow-[0_0_10px_rgba(251,191,36,0.3)] backdrop-blur-sm',
      sizeClasses[size],
      'hover:scale-115 active:scale-95',
      'hover:bg-amber-800/60 hover:border-amber-300/70',
      'hover:shadow-[0_0_14px_rgba(251,191,36,0.5)]',
      'disabled:opacity-40 disabled:cursor-not-allowed',
      className,
    );

    const positionStyle: React.CSSProperties = {
      left: `${position.x * 100}%`,
      top: `${position.y * 100}%`,
      transform: 'translate(-50%, -50%)',
    };

    return (
      <button
        ref={ref}
        type="button"
        className={baseStyles}
        style={positionStyle}
        disabled={disabled}
        aria-label={label}
        {...props}
      >
        <DoorClosed
          className={cn(
            'shrink-0 drop-shadow-[0_0_2px_rgba(251,191,36,0.8)]',
            iconSizeClasses[size],
          )}
        />
      </button>
    );
  },
);

MapMarker.displayName = 'MapMarker';
