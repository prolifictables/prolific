'use client';

import { HTMLAttributes, forwardRef } from 'react';
import { cn } from '@prolific/utils';

export interface ProgressProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Percentage 0–100 */
  value: number;
  /** Visual thickness */
  size?: 'sm' | 'md' | 'lg';
  /** Color variant */
  tone?: 'brand' | 'accent' | 'emerald' | 'slate' | 'neon';
  /** Show numeric % label */
  showLabel?: boolean;
  /** Animation disabled (e.g. static value render) */
  static?: boolean;
}

/**
 * Modern animated progress bar.
 * Clamps the value to 0-100, animates on mount via keyframe or transition.
 */
export const Progress = forwardRef<HTMLDivElement, ProgressProps>(function Progress(
  { className, value, size = 'md', tone = 'brand', showLabel = false, static: isStatic = false, ...rest },
  ref
) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));

  const track = {
    sm: 'h-1.5 rounded-full',
    md: 'h-2.5 rounded-full',
    lg: 'h-4 rounded-full',
  }[size];

  const bar = {
    brand: 'bg-gradient-warm',
    accent: 'bg-gradient-sunset',
    emerald: 'bg-gradient-forest',
    slate: 'bg-slate-500',
    neon: 'bg-gradient-neon',
  }[tone];

  return (
    <div
      ref={ref}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('w-full', className)}
      {...rest}
    >
      <div className={cn('relative w-full overflow-hidden bg-surface-sunken shadow-inner-soft', track)}>
        <div
          className={cn(
            'h-full rounded-full shadow-sm',
            bar,
            isStatic ? 'transition-all duration-500 ease-out-expo' : 'animate-progress'
          )}
          style={{ width: `${clamped}%` }}
        />
        {/* Soft animated shine overlay — adds polish */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="w-1/3 h-full bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer bg-shimmer" />
        </div>
      </div>
      {showLabel && (
        <div className="mt-1.5 flex items-center justify-between text-xs text-ink-muted font-medium tabular-nums">
          <span>{clamped}%</span>
          <span>Ready</span>
        </div>
      )}
    </div>
  );
});

/**
 * Meter — a horizontal progress bar with optional discrete segments.
 * Good for showing: "spicy level 3/5", "popularity 4/5", "nutrition bars".
 */
export interface MeterProps extends HTMLAttributes<HTMLDivElement> {
  /** Current value (0..segments) */
  value: number;
  /** Total segments */
  segments?: number;
  tone?: 'brand' | 'accent' | 'emerald' | 'rose';
}

export function Meter({
  className,
  value,
  segments = 5,
  tone = 'accent',
  ...rest
}: MeterProps) {
  const fill = Math.max(0, Math.min(segments, Math.round(value)));

  const activeColor = {
    brand: 'bg-restaurant-600',
    accent: 'bg-accent-500',
    emerald: 'bg-emerald-500',
    rose: 'bg-rose-500',
  }[tone];

  return (
    <div
      className={cn('flex items-center gap-1 w-full', className)}
      role="img"
      aria-label={`${fill} out of ${segments}`}
      {...rest}
    >
      {Array.from({ length: segments }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'flex-1 h-2 rounded-sm transition-all duration-300',
            i < fill ? activeColor : 'bg-surface-sunken'
          )}
        />
      ))}
    </div>
  );
}
