'use client';

import { HTMLAttributes, forwardRef } from 'react';
import { cn } from '@prolific/utils';

type Tone = 'info' | 'success' | 'warning' | 'danger' | 'brand';

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  tone?: Tone;
  /** Optional title rendered bold in the first line */
  title?: string;
  /** Removable close button (when onClose supplied) */
  onClose?: () => void;
  /** Compact (inline) or spacious card style */
  size?: 'sm' | 'md';
}

const toneMap: Record<Tone, { wrap: string; iconBg: string; iconShadow: string; icon: React.ReactNode }> = {
  info: {
    wrap: 'glass-neon border-cyan-400/20 text-white shadow-glow-accent',
    iconBg: 'bg-gradient-to-br from-cyan-400 to-blue-600 text-white',
    iconShadow: 'shadow-[0_0_12px_rgba(34,211,238,0.5)]',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    ),
  },
  success: {
    wrap: 'glass-neon border-emerald-400/20 text-white shadow-glow-emerald',
    iconBg: 'bg-gradient-to-br from-emerald-400 to-green-600 text-white',
    iconShadow: 'shadow-[0_0_12px_rgba(52,211,153,0.5)]',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
  },
  warning: {
    wrap: 'glass-neon border-amber-400/20 text-white shadow-[0_0_24px_-8px_rgba(251,191,36,0.45)]',
    iconBg: 'bg-gradient-to-br from-amber-400 to-orange-600 text-white',
    iconShadow: 'shadow-[0_0_12px_rgba(251,191,36,0.5)]',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
  },
  danger: {
    wrap: 'glass-neon border-pink-500/25 text-white shadow-[0_0_24px_-8px_rgba(236,72,153,0.45)]',
    iconBg: 'bg-gradient-to-br from-pink-500 to-rose-600 text-white',
    iconShadow: 'shadow-[0_0_12px_rgba(236,72,153,0.5)]',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    ),
  },
  brand: {
    wrap: 'glass-neon border-amber-400/25 text-white shadow-glow-restaurant',
    iconBg: 'bg-gradient-neon text-white',
    iconShadow: 'shadow-glow-restaurant',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0z" />
        <path d="M12 8v4l3 2" />
      </svg>
    ),
  },
};

/**
 * Accessible inline alert / callout.
 * Works for form errors, payment status, promo banners, and empty-state hints.
 */
export const Alert = forwardRef<HTMLDivElement, AlertProps>(function Alert(
  { className, tone = 'info', title, onClose, size = 'md', children, ...rest },
  ref
) {
  const t = toneMap[tone];
  return (
    <div
      ref={ref}
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'relative w-full rounded-2xl border flex items-start gap-3 animate-fade-in-up overflow-hidden backdrop-blur-xl',
        size === 'sm' ? 'px-3 py-2.5 text-sm' : 'px-4 py-3.5 text-sm',
        t.wrap,
        className
      )}
      {...rest}
    >
      <div className={cn('flex-shrink-0 w-7 h-7 rounded-xl flex items-center justify-center ring-1 ring-white/20', t.iconBg, t.iconShadow)}>
        {t.icon}
      </div>

      <div className="min-w-0 flex-1">
        {title && (
          <p className="font-semibold leading-tight mb-0.5 text-white">{title}</p>
        )}
        {children && <div className={cn(title ? 'text-ink-soft' : '')}>{children}</div>}
      </div>

      {onClose && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onClose}
          className={cn(
            'flex-shrink-0 -mr-1 -mt-0.5 p-1.5 rounded-lg transition-all text-white',
            'opacity-60 hover:opacity-100 hover:bg-white/10 active:scale-95'
          )}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );
});
