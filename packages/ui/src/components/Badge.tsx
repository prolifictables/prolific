import * as React from 'react';
import { cn } from '../index';

type BadgeVariant =
  | 'default'
  | 'secondary'
  | 'outline'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: BadgeVariant;
  asChild?: boolean;
}

const VARIANTS: Record<BadgeVariant, string> = {
  default: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  secondary: 'bg-slate-100 text-slate-700 border-slate-200',
  outline: 'text-slate-700 border-slate-300',
  success: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-100 text-amber-800 border-amber-200',
  danger: 'bg-rose-100 text-rose-700 border-rose-200',
  info: 'bg-sky-100 text-sky-700 border-sky-200',
};

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors',
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}
