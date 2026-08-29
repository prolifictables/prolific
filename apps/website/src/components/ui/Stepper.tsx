'use client';

import { HTMLAttributes, forwardRef } from 'react';
import { cn } from '@prolific/utils';

export interface StepperStep {
  label: string;
  description?: string;
  status?: 'upcoming' | 'current' | 'complete';
  icon?: React.ReactNode;
}

export interface StepperProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  steps: StepperStep[];
  currentStep: number;
  orientation?: 'horizontal' | 'vertical';
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Futuristic neon progress stepper.
 *   i < currentStep  → complete (neon glow + checkmark)
 *   i === currentStep → current (pulse ring + gradient fill)
 *   i > currentStep  → upcoming (hollow / muted)
 */
export const Stepper = forwardRef<HTMLDivElement, StepperProps>(function Stepper(
  { className, steps, currentStep, orientation = 'horizontal', size = 'md', ...rest },
  ref
) {
  const circleSize = {
    sm: 'w-7 h-7 text-xs',
    md: 'w-9 h-9 text-sm',
    lg: 'w-11 h-11 text-base',
  }[size];

  const isVertical = orientation === 'vertical';

  return (
    <div
      ref={ref}
      role="list"
      aria-label="Progress"
      className={cn(
        'w-full',
        isVertical
          ? 'flex flex-col gap-1'
          : 'flex items-start justify-between gap-2',
        className
      )}
      {...rest}
    >
      {steps.map((step, i) => {
        const status =
          step.status ??
          (i < currentStep ? 'complete' : i === currentStep ? 'current' : 'upcoming');
        const isLast = i === steps.length - 1;

        return (
          <div
            key={i}
            role="listitem"
            className={cn(
              'relative flex min-w-0',
              isVertical ? 'flex-row gap-3 pb-6' : 'flex-col items-center flex-1'
            )}
            aria-current={status === 'current' ? 'step' : undefined}
          >
            {/* Connector line */}
            {!isLast && (
              <div
                aria-hidden
                className={cn(
                  'absolute bg-white/8 overflow-hidden',
                  isVertical
                    ? 'left-[1.125rem] top-8 w-px h-full'
                    : 'top-[1.125rem] left-[calc(50%+1.125rem)] right-[calc(50%-1.125rem)] h-px'
                )}
              >
                {status === 'complete' && (
                  <div
                    className={cn(
                      'bg-gradient-neon shadow-[0_0_8px_rgba(212,175,55,0.7)] animate-progress',
                      isVertical ? 'w-px h-full' : 'h-px w-full'
                    )}
                  />
                )}
              </div>
            )}

            {/* Step circle + labels */}
            <div className={cn('relative z-10 flex', isVertical ? 'flex-row gap-3 w-full' : 'flex-col items-center')}>
              <div
                className={cn(
                  'flex-shrink-0 rounded-full flex items-center justify-center font-semibold transition-all duration-600 ease-out-expo',
                  circleSize,
                  status === 'complete' &&
                    'bg-gradient-neon text-white shadow-glow-restaurant',
                  status === 'current' &&
                    'bg-surface-panel text-white ring-4 ring-amber-500/25 shadow-[0_0_22px_-4px_rgba(212,175,55,0.8)] border border-amber-400/60 animate-neon-pulse',
                  status === 'upcoming' &&
                    'bg-surface-muted text-ink-faint border border-white/10'
                )}
              >
                {status === 'complete' ? (
                  step.icon ?? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )
                ) : (
                  step.icon ?? i + 1
                )}
              </div>

              {/* Text block */}
              <div className={cn('min-w-0', isVertical ? 'pt-1 flex-1' : 'mt-2 text-center w-full px-1')}>
                <p
                  className={cn(
                    'font-semibold text-sm leading-tight truncate',
                    status === 'upcoming' ? 'text-ink-muted' : 'text-white'
                  )}
                >
                  {step.label}
                </p>
                {step.description && (
                  <p className="mt-0.5 text-xs text-ink-muted line-clamp-2">
                    {step.description}
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
});
