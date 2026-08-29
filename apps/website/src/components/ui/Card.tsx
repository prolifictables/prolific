'use client';

import { HTMLAttributes, forwardRef } from 'react';
import { cn } from '@prolific/utils';

type Elevation = 'flat' | 'sm' | 'md' | 'lg' | 'xl' | 'glow' | 'neon';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padded?: boolean | 'sm' | 'md' | 'lg';
  /** Visual elevation — default 'md' for balanced depth */
  elevation?: Elevation;
  /** If true, applies hover-lift + neon border glow on mouseover */
  interactive?: boolean;
  /** Radius — defaults to 3xl for modern rounded feel */
  radius?: 'xl' | '2xl' | '3xl' | '4xl' | 'none';
}

const padMap = {
  sm: 'p-3',
  md: 'p-5',
  lg: 'p-7',
};

// Elevation variants — neon/cyber dark palette
const elevationMap: Record<Elevation, string> = {
  flat: 'border border-white/5 shadow-none',
  sm: 'border border-white/6 shadow-sm',
  md: 'border border-white/6 shadow-md',
  lg: 'border border-white/6 shadow-lg',
  xl: 'border border-white/6 shadow-xl',
  glow: 'border border-amber-400/25 shadow-glow-restaurant',
  neon: 'border border-amber-400/30 shadow-[0_0_30px_-8px_rgba(212,175,55,0.6)]',
};

const radiusMap: Record<NonNullable<CardProps['radius']>, string> = {
  none: 'rounded-none',
  xl: 'rounded-xl',
  '2xl': 'rounded-2xl',
  '3xl': 'rounded-3xl',
  '4xl': 'rounded-4xl',
};

/**
 * Futuristic Card — dark translucent glass, interactive neon lift on hover.
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  {
    className,
    padded = false,
    elevation = 'md',
    interactive = false,
    radius = '3xl',
    children,
    ...rest
  },
  ref
) {
  const padClass =
    padded === false
      ? ''
      : padded === true
      ? padMap.md
      : padMap[padded];

  return (
    <div
      ref={ref}
      className={cn(
        'relative bg-gradient-card backdrop-blur-xl overflow-hidden',
        radiusMap[radius],
        elevationMap[elevation],
        padClass,
        interactive &&
          'transition-all duration-500 ease-out-expo hover:-translate-y-0.5 hover:shadow-glow-restaurant hover:border-amber-400/35 active:translate-y-0 active:shadow-md cursor-pointer group',
        className
      )}
      {...rest}
    >
      {/* subtle top specular highlight */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/40 to-transparent opacity-60" />
      {children}
    </div>
  );
});

export function CardHeader({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 px-5 py-4 border-b border-white/6',
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardBody({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex-1 px-5 py-4', className)} {...rest}>{children}</div>;
}

export function CardFooter({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 px-5 py-4 border-t border-white/6 bg-white/[0.02]',
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
