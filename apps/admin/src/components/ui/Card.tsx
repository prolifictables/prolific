'use client';

import { HTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padded?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, padded = false, children, ...rest },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-2xl bg-white shadow-card border border-slate-100',
        padded && 'p-5',
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
});

export const CardHeader = forwardRef<HTMLDivElement, CardProps>(function CardHeader(
  { className, padded = false, children, ...rest },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn(
        'flex items-center justify-between gap-4',
        padded && 'p-5 pb-0',
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
});

export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  function CardTitle({ className, children, ...rest }, ref) {
    return (
      <h3
        ref={ref}
        className={cn('text-lg font-semibold text-slate-900', className)}
        {...rest}
      >
        {children}
      </h3>
    );
  }
);

export const CardContent = forwardRef<HTMLDivElement, CardProps>(function CardContent(
  { className, padded = true, children, ...rest },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn(
        padded && 'p-5',
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
});

export const CardFooter = forwardRef<HTMLDivElement, CardProps>(function CardFooter(
  { className, padded = true, children, ...rest },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn(
        'flex items-center gap-3 border-t border-slate-100',
        padded && 'p-5 pt-4',
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
});
