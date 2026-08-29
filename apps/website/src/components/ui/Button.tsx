'use client';

import { ButtonHTMLAttributes, forwardRef, useCallback, useRef } from 'react';
import { cn } from '@prolific/utils';

type Variant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'outline'
  | 'gradient'
  | 'gradient-accent'
  | 'neon'
  | 'neon-pink'
  | 'neon-cyan'
  | 'emerald'
  | 'soft';
type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
  /** Render leading / trailing icon slots — use before the label */
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

// Variant classes — luxury gold / dark futuristic: lift hover + glow + focus ring
const variantClasses: Record<Variant, string> = {
  // Core brand — metallic luxury gold
  primary:
    'bg-restaurant-600 text-white hover:bg-restaurant-500 active:bg-restaurant-700 shadow-md hover:shadow-glow-restaurant disabled:bg-restaurant-800 disabled:text-ink-muted disabled:shadow-none',
  // Accent CTA — burnt ember / copper
  secondary:
    'bg-accent-500 text-white hover:bg-accent-400 active:bg-accent-600 shadow-md hover:shadow-glow-accent disabled:bg-accent-800 disabled:text-ink-muted disabled:shadow-none',
  // Low emphasis text button
  ghost:
    'bg-transparent text-ink hover:bg-white/5 active:bg-white/10 text-white',
  // Destructive
  danger:
    'bg-red-600 text-white hover:bg-red-500 active:bg-red-700 shadow-md hover:shadow-[0_0_24px_-6px_rgba(239,68,68,0.7)] disabled:bg-red-900 disabled:shadow-none',
  // Outlined surface button
  outline:
    'bg-surface-muted text-ink border border-white/10 hover:bg-white/5 active:bg-white/10 shadow-sm text-white',
  // Premium gradient CTA — 24k gold / metallic / copper (hero CTAs)
  gradient:
    'bg-gradient-neon text-white shadow-glow-restaurant hover:shadow-2xl hover:brightness-110 active:brightness-95 animate-neon-pulse',
  // Sunset hot gradient CTA — ember → gold (promos / highlight)
  'gradient-accent':
    'bg-gradient-sunset text-white shadow-glow-accent hover:shadow-2xl hover:brightness-110 active:brightness-95',
  // Signature gold 4-stop gradient — for primary hero / CTA
  neon:
    'bg-gradient-neon text-white shadow-glow-restaurant hover:shadow-glow-fuchsia hover:brightness-110 active:brightness-95 animate-neon-pulse ring-1 ring-white/10',
  // Hot ember / copper neon accent
  'neon-pink':
    'bg-[linear-gradient(120deg,#EA580C_0%,#CD7F32_100%)] text-white shadow-glow-accent hover:brightness-110 active:brightness-95 ring-1 ring-white/10',
  // Cyan neon variant
  'neon-cyan':
    'bg-[linear-gradient(120deg,#22D3EE_0%,#0EA5E9_100%)] text-white shadow-glow-emerald hover:brightness-110 active:brightness-95 ring-1 ring-white/10',
  // Emerald success
  emerald:
    'bg-emerald-500 text-white hover:bg-emerald-400 active:bg-emerald-600 shadow-md hover:shadow-glow-emerald disabled:bg-emerald-800 disabled:shadow-none',
  // Soft "tag" style — for secondary CTAs inside cards
  soft:
    'bg-white/5 text-ink border border-white/10 hover:bg-white/10 active:bg-white/15 text-white',
};

const sizeClasses: Record<Size, string> = {
  xs: 'text-xs py-1.5 px-3 rounded-lg gap-1.5 h-8',
  sm: 'text-sm py-2 px-4 rounded-xl gap-1.5 h-9',
  md: 'text-sm font-medium py-2.5 px-5 rounded-2xl gap-2 h-11',
  lg: 'text-base font-semibold py-3 px-7 rounded-2xl gap-2 h-12',
  xl: 'text-base font-semibold py-4 px-8 rounded-3xl gap-2.5 h-14',
};

/**
 * Modern primary button with:
 *  - Material-style ripple click feedback
 *  - Press scale micro-interaction (scale-98)
 *  - Gradient + glow CTA variants
 *  - leftIcon / rightIcon slots
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'primary',
    size = 'md',
    loading,
    fullWidth,
    leftIcon,
    rightIcon,
    children,
    disabled,
    onClick,
    ...rest
  },
  ref
) {
  const hostRef = useRef<HTMLButtonElement | null>(null);

  // Click ripple — injects a transient span that grows & fades from pointer position
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const btn = hostRef.current;
      if (btn && !disabled && !loading) {
        const rect = btn.getBoundingClientRect();
        const span = document.createElement('span');
        const size = Math.max(rect.width, rect.height);
        span.style.width = span.style.height = size + 'px';
        span.style.left = e.clientX - rect.left - size / 2 + 'px';
        span.style.top = e.clientY - rect.top - size / 2 + 'px';
        span.className =
          'absolute rounded-full bg-white/25 pointer-events-none animate-ripple';
        btn.appendChild(span);
        setTimeout(() => span.remove(), 600);
      }
      onClick?.(e);
    },
    [onClick, disabled, loading]
  );

  const setRefs = (node: HTMLButtonElement | null) => {
    hostRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) (ref as React.MutableRefObject<HTMLButtonElement | null>).current = node;
  };

  return (
    <button
      ref={setRefs}
      disabled={disabled || loading}
      onClick={handleClick}
      className={cn(
        // Base — relative for ripple, tap targets, transitions
        'relative inline-flex items-center justify-center transition-all duration-200 ease-out-expo font-medium select-none',
        // Hover lift + press scale — subtle, feels premium
        'active:scale-[0.98]',
        // Ripple isolation — prevents overflow on rounded shapes
        'ripple-target overflow-hidden',
        // Disabled
        'disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100 disabled:hover:shadow-none',
        // Focus ring (accessible)
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-500/30',
        variantClasses[variant],
        sizeClasses[size],
        fullWidth && 'w-full',
        className
      )}
      {...rest}
    >
      {loading && (
        <svg
          className="animate-spin h-4 w-4 flex-shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
        >
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
          <path
            fill="currentColor"
            d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
            className="opacity-75"
          />
        </svg>
      )}
      {!loading && leftIcon && <span className="flex-shrink-0">{leftIcon}</span>}
      {children}
      {rightIcon && <span className="flex-shrink-0">{rightIcon}</span>}
    </button>
  );
});

// Backward-compatible shorthands
export function PrimaryButton(props: Omit<ButtonProps, 'variant'>) {
  return <Button variant="primary" {...props} />;
}

export function SecondaryButton(props: Omit<ButtonProps, 'variant'>) {
  return <Button variant="secondary" {...props} />;
}

/** Icon-only circle button — common for add-to-cart, close, filters etc. */
export function IconButton({
  variant = 'soft',
  size = 'md',
  className,
  title,
  children,
  ...rest
}: ButtonProps & { title?: string }) {
  const dim: Record<Size, string> = {
    xs: 'w-8 h-8 p-0',
    sm: 'w-9 h-9 p-0',
    md: 'w-11 h-11 p-0',
    lg: 'w-12 h-12 p-0',
    xl: 'w-14 h-14 p-0',
  };
  return (
    <Button
      variant={variant}
      size={size}
      aria-label={title}
      title={title}
      className={cn('rounded-full', dim[size], className)}
      {...rest}
    >
      {children}
    </Button>
  );
}

