'use client';

import { HTMLAttributes, forwardRef } from 'react';
import { cn } from '@prolific/utils';
import { Button, ButtonProps } from './Button';

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick?: () => void; props?: Partial<ButtonProps> };
  secondaryAction?: { label: string; onClick?: () => void; props?: Partial<ButtonProps> };
  compact?: boolean;
}

/**
 * Futuristic neon empty state — glowing blobs, animated icon, neon CTAs.
 */
export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(function EmptyState(
  { className, icon, title, description, action, secondaryAction, compact = false, ...rest },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn(
        'relative w-full flex flex-col items-center justify-center text-center overflow-hidden',
        'rounded-3xl border border-dashed border-white/10 bg-gradient-card backdrop-blur-xl',
        compact ? 'px-4 py-8' : 'px-6 py-16',
        className
      )}
      {...rest}
    >
      {/* Neon glow blobs backdrop */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl">
        <div className="absolute -top-24 -left-16 w-64 h-64 blob bg-amber-500/20 blur-3xl animate-float-slow" />
        <div className="absolute -bottom-24 -right-16 w-64 h-64 blob bg-pink-500/15 blur-3xl animate-float-slow" style={{ animationDelay: '-4s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 blob bg-cyan-400/10 blur-3xl animate-float" />
      </div>

      {/* Subtle grid overlay */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-cyber-grid opacity-40" />

      {/* Icon / illustration */}
      {icon !== null && (
        <div className="relative z-10 mb-5 animate-bounce-soft">
          {icon ?? (
            <div className="w-16 h-16 rounded-3xl bg-surface-panel/90 backdrop-blur-xl shadow-glow-restaurant border border-amber-400/30 flex items-center justify-center animate-neon-pulse">
              <span className="text-3xl">🍽️</span>
            </div>
          )}
        </div>
      )}

      {/* Text block */}
      <div className="relative z-10 max-w-md mx-auto w-full">
        <h3 className="text-lg font-semibold text-white leading-tight tracking-tight">{title}</h3>
        {description && (
          <p className="mt-1.5 text-sm text-ink-muted leading-relaxed">{description}</p>
        )}
      </div>

      {/* Actions */}
      {(action || secondaryAction) && (
        <div className="relative z-10 mt-6 flex flex-col sm:flex-row items-center justify-center gap-2 w-full max-w-xs mx-auto">
          {action && (
            <Button
              fullWidth
              variant="neon"
              size="md"
              onClick={action.onClick}
              {...action.props}
            >
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button
              fullWidth
              variant="outline"
              size="md"
              onClick={secondaryAction.onClick}
              {...secondaryAction.props}
            >
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
});

export function EmptyCart({ onBrowse, compact }: { onBrowse?: () => void; compact?: boolean }) {
  return (
    <EmptyState
      compact={compact}
      icon={
        <div className="w-16 h-16 rounded-3xl bg-surface-panel/90 backdrop-blur-xl shadow-glow-accent border border-pink-400/30 flex items-center justify-center">
          <span className="text-3xl">🛒</span>
        </div>
      }
      title="Your cart is empty"
      description="Looks like you haven't added anything yet. Browse the menu to start your order."
      action={onBrowse ? { label: 'Browse Menu', onClick: onBrowse, props: { variant: 'neon-pink' as const } } : undefined}
    />
  );
}

export function EmptySearch({ query, onClear }: { query?: string; onClear?: () => void }) {
  return (
    <EmptyState
      compact
      icon={
        <div className="w-16 h-16 rounded-3xl bg-surface-panel/90 backdrop-blur-xl shadow-glow-emerald border border-cyan-400/30 flex items-center justify-center">
          <span className="text-3xl">🔍</span>
        </div>
      }
      title={query ? `No results for "${query}"` : 'No results'}
      description="Try a different keyword or browse the categories below."
      action={onClear ? { label: 'Clear search', onClick: onClear, props: { variant: 'neon-cyan' as const } } : undefined}
    />
  );
}

export function EmptyOrders({ onExplore }: { onExplore?: () => void }) {
  return (
    <EmptyState
      icon={
        <div className="w-16 h-16 rounded-3xl bg-surface-panel/90 backdrop-blur-xl shadow-glow-restaurant border border-amber-400/30 flex items-center justify-center">
          <span className="text-3xl">📋</span>
        </div>
      }
      title="No orders yet"
      description="Once you place an order, it will show up here with live status updates."
      action={onExplore ? { label: 'Start an order', onClick: onExplore } : undefined}
    />
  );
}
