'use client';

import { HTMLAttributes, forwardRef } from 'react';
import { cn } from '@prolific/utils';

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'text' | 'circle' | 'rect';
  lines?: number;
}

/**
 * Neon-cyber animated shimmer skeleton loader.
 */
export const Skeleton = forwardRef<HTMLDivElement, SkeletonProps>(function Skeleton(
  { className, variant = 'rect', lines = 1, ...rest },
  ref
) {
  // Multi-line text — stacked widths mimic wrapped text
  if (variant === 'text' && lines > 1) {
    return (
      <div ref={ref} className={cn('flex flex-col gap-2 w-full', className)} {...rest}>
        {Array.from({ length: lines }).map((_, i) => {
          const width = i === lines - 1 ? 'w-3/4' : 'w-full';
          return (
            <div
              key={i}
              className={cn(
                'h-4 rounded-md bg-white/[0.04] bg-shimmer animate-shimmer',
                width
              )}
            />
          );
        })}
      </div>
    );
  }

  const shape =
    variant === 'circle'
      ? 'rounded-full'
      : variant === 'text'
      ? 'h-4 rounded-md'
      : 'rounded-2xl';

  return (
    <div
      ref={ref}
      className={cn(
        'relative overflow-hidden bg-white/[0.04] bg-shimmer animate-shimmer',
        shape,
        className
      )}
      aria-busy
      aria-hidden
      {...rest}
    />
  );
});

export function SkeletonListItem({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-4 w-full p-3', className)}>
      <Skeleton variant="circle" className="w-12 h-12 flex-shrink-0" />
      <div className="flex-1 min-w-0 space-y-2">
        <Skeleton variant="text" className="w-2/3" />
        <Skeleton variant="text" className="w-1/2" />
      </div>
      <Skeleton className="w-16 h-9 rounded-xl" />
    </div>
  );
}

export function SkeletonMenuCard({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-3xl bg-surface-elevated shadow-sm border border-white/5 overflow-hidden', className)}>
      <Skeleton variant="rect" className="aspect-square w-full rounded-none" />
      <div className="p-3 space-y-2">
        <Skeleton variant="text" className="w-3/4" />
        <Skeleton variant="text" className="w-1/2" />
        <Skeleton variant="text" className="w-1/3" />
      </div>
    </div>
  );
}
