'use client';

import { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes, forwardRef } from 'react';
import { cn } from '@prolific/utils';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  /** Leading icon rendered inside the input wrapper (not focusable) */
  leftIcon?: ReactNode;
  /** Trailing slot rendered inside the input wrapper (e.g., clear button) */
  rightSlot?: ReactNode;
  /** When true, renders a subtle (required) hint next to the label */
  required?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, label, error, id, leftIcon, rightSlot, required, ...rest },
  ref
) {
  const inputId = id || rest.name;
  const hasLeft = !!leftIcon;
  const hasRight = !!rightSlot;
  return (
    <div className="w-full">
      {label && (
        <div className="flex items-baseline justify-between mb-1.5">
          <label
            htmlFor={inputId}
            className="text-[13px] font-semibold text-ink tracking-tight"
          >
            {label}
            {required && <span className="ml-0.5 text-pink-400 font-extrabold">*</span>}
          </label>
          {rest.maxLength && typeof rest.value === 'string' && (
            <span className="text-[11px] text-ink-muted font-medium tabular-nums">
              {rest.value.length}/{rest.maxLength}
            </span>
          )}
        </div>
      )}
      <div
        className={cn(
          'group relative rounded-[1rem] bg-surface-sunken border transition-all duration-200 ease-out-expo shadow-inner-soft',
          'flex items-center overflow-hidden',
          error
            ? 'border-red-500/50 focus-within:border-red-400 focus-within:ring-4 focus-within:ring-red-500/15 focus-within:shadow-[0_0_22px_-6px_rgba(239,68,68,0.55)]'
            : 'border-white/6 focus-within:border-amber-400/50 focus-within:ring-4 focus-within:ring-amber-500/15 focus-within:shadow-[0_0_26px_-8px_rgba(212,175,55,0.65)]',
          className
        )}
      >
        {hasLeft && (
          <div className="pl-4 pr-2 text-ink-muted group-focus-within:text-amber-300 transition-colors flex items-center shrink-0">
            {leftIcon}
          </div>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            'w-full min-w-0 bg-transparent py-[13px] text-[14.5px] text-white placeholder:text-ink-muted placeholder:font-normal',
            'outline-none',
            hasLeft ? 'pl-0 pr-2' : 'pl-4 pr-2',
            hasRight ? '!pr-1' : 'pr-4'
          )}
          {...rest}
        />
        {hasRight && (
          <div className="pr-2 pl-1 flex items-center shrink-0">{rightSlot}</div>
        )}
      </div>
      {error && (
        <p className="mt-1.5 text-[11.5px] text-red-400 font-medium flex items-start gap-1.5">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {error}
        </p>
      )}
    </div>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  required?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, label, error, id, required, ...rest },
  ref
) {
  const inputId = id || rest.name;
  return (
    <div className="w-full">
      {label && (
        <div className="flex items-baseline justify-between mb-1.5">
          <label
            htmlFor={inputId}
            className="text-[13px] font-semibold text-ink tracking-tight"
          >
            {label}
            {required && <span className="ml-0.5 text-pink-400 font-extrabold">*</span>}
          </label>
          {rest.maxLength && typeof rest.value === 'string' && (
            <span className="text-[11px] text-ink-muted font-medium tabular-nums">
              {rest.value.length}/{rest.maxLength}
            </span>
          )}
        </div>
      )}
      <textarea
        ref={ref}
        id={inputId}
        className={cn(
          'w-full rounded-[1rem] border bg-surface-sunken px-4 py-[12px] text-[14.5px] text-white placeholder:text-ink-muted placeholder:font-normal transition resize-none shadow-inner-soft',
          'border-white/6 focus:border-amber-400/50 focus:outline-none focus:ring-4 focus:ring-amber-500/15 focus:shadow-[0_0_26px_-8px_rgba(212,175,55,0.65)]',
          error && 'border-red-500/50 focus:border-red-400 focus:ring-red-500/15',
          className
        )}
        {...rest}
      />
      {error && (
        <p className="mt-1.5 text-[11.5px] text-red-400 font-medium">{error}</p>
      )}
    </div>
  );
});
