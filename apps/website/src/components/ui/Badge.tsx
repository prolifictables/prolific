'use client';

import { HTMLAttributes, forwardRef } from 'react';
import { cn } from '@prolific/utils';

type Variant =
  | 'default'
  | 'accent'
  | 'emerald'
  | 'outline'
  | 'soft'
  | 'danger'
  | 'gradient'
  | 'glass'
  | 'neon'
  | 'neon-cyan'
  | 'neon-pink'
  | 'neon-lime';
type Size = 'xs' | 'sm' | 'md';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
  size?: Size;
  /** Optional leading dot (status indicator) — adds a 6px circle before the label */
  dot?: boolean;
}

// Neon/cyber dark variants
const variantClasses: Record<Variant, string> = {
  default: 'bg-amber-500/10 text-amber-200 ring-1 ring-amber-400/30',
  accent: 'bg-pink-500/12 text-pink-200 ring-1 ring-pink-400/30',
  emerald: 'bg-cyan-500/12 text-cyan-200 ring-1 ring-cyan-400/30',
  danger: 'bg-red-500/12 text-red-200 ring-1 ring-red-400/30',
  outline: 'border border-white/10 text-ink-muted bg-white/[0.02]',
  soft: 'bg-white/5 text-ink-muted ring-1 ring-white/10',
  gradient:
    'bg-gradient-neon text-white shadow-sm ring-1 ring-white/10',
  glass:
    'bg-white/6 backdrop-blur-md text-white ring-1 ring-white/10 shadow-sm',
  neon: 'bg-[linear-gradient(120deg,rgba(212,175,55,0.25),rgba(205,127,50,0.22))] text-white ring-1 ring-white/15 shadow-[0_0_18px_-6px_rgba(212,175,55,0.65)]',
  'neon-cyan':
    'bg-[linear-gradient(120deg,rgba(34,211,238,0.25),rgba(251,191,36,0.22))] text-white ring-1 ring-white/15 shadow-[0_0_18px_-6px_rgba(34,211,238,0.65)]',
  'neon-pink':
    'bg-[linear-gradient(120deg,rgba(234,88,12,0.25),rgba(205,127,50,0.22))] text-white ring-1 ring-white/15 shadow-[0_0_18px_-6px_rgba(234,88,12,0.65)]',
  'neon-lime':
    'bg-[linear-gradient(120deg,rgba(163,230,53,0.25),rgba(34,211,238,0.20))] text-white ring-1 ring-white/15 shadow-[0_0_18px_-6px_rgba(163,230,53,0.55)]',
};

const sizeClasses: Record<Size, string> = {
  xs: 'text-[10px] px-2 py-0.5 gap-1 rounded-full',
  sm: 'text-[11px] px-2.5 py-1 gap-1 rounded-full',
  md: 'text-xs px-3 py-1.5 gap-1.5 rounded-full',
};

/**
 * Futuristic neon Badge / status pill — with glow variants.
 */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { className, variant = 'default', size = 'sm', dot = false, children, ...rest },
  ref
) {
  // Neon dot color — matches badge tint
  const dotColor: Record<Variant, string> = {
    default: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]',
    accent: 'bg-pink-400 shadow-[0_0_8px_rgba(244,114,182,0.8)]',
    emerald: 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]',
    danger: 'bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.8)]',
    outline: 'bg-amber-400',
    soft: 'bg-white/60',
    gradient: 'bg-white',
    glass: 'bg-white',
    neon: 'bg-amber-300 shadow-[0_0_10px_rgba(251,191,36,0.9)]',
    'neon-cyan': 'bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,0.9)]',
    'neon-pink': 'bg-pink-300 shadow-[0_0_10px_rgba(249,168,212,0.9)]',
    'neon-lime': 'bg-lime-300 shadow-[0_0_10px_rgba(190,242,100,0.9)]',
  };

  return (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center font-semibold tracking-wide uppercase',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...rest}
    >
      {dot && (
        <span
          aria-hidden
          className={cn(
            'w-1.5 h-1.5 rounded-full inline-block flex-shrink-0',
            dotColor[variant],
            (variant === 'emerald' ||
              variant === 'neon-cyan' ||
              variant === 'neon-lime' ||
              variant === 'neon') &&
              'animate-pulse-soft'
          )}
        />
      )}
      {children}
    </span>
  );
});
