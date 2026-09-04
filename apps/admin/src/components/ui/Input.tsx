'use client';

import { InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label?: string;
  error?: string;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  description?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, label, error, id, prefix, suffix, description, ...rest },
  ref
) {
  const inputId = id || rest.name;
  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={inputId}
          className="block text-sm font-medium text-slate-700 mb-1.5"
        >
          {label}
        </label>
      )}
      <div className="relative">
        {prefix && (
          <div className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400 pointer-events-none">
            {prefix}
          </div>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            'w-full rounded-xl border bg-white px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 transition',
            'border-slate-200 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100',
            error && 'border-red-300 focus:border-red-400 focus:ring-red-100',
            prefix && 'pl-10',
            suffix && 'pr-10',
            className
          )}
          {...rest}
        />
        {suffix && (
          <div className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 pointer-events-none">
            {suffix}
          </div>
        )}
      </div>
      {description && !error && <p className="mt-1.5 text-xs text-slate-500">{description}</p>}
      {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
    </div>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  description?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, label, error, id, rows = 4, description, ...rest },
  ref
) {
  const inputId = id || rest.name;
  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={inputId}
          className="block text-sm font-medium text-slate-700 mb-1.5"
        >
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={inputId}
        rows={rows}
        className={cn(
          'w-full rounded-xl border bg-white px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 transition resize-y',
          'border-slate-200 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100',
          error && 'border-red-300 focus:border-red-400 focus:ring-red-100',
          className
        )}
        {...rest}
      />
      {description && !error && (
        <p className="mt-1.5 text-xs text-slate-500">{description}</p>
      )}
      {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
    </div>
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, label, error, id, options, placeholder, ...rest },
  ref
) {
  const inputId = id || rest.name;
  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={inputId}
          className="block text-sm font-medium text-slate-700 mb-1.5"
        >
          {label}
        </label>
      )}
      <select
        ref={ref}
        id={inputId}
        className={cn(
          'w-full rounded-xl border bg-white px-4 py-2.5 text-sm text-slate-800 transition appearance-none pr-10',
          'border-slate-200 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100',
          error && 'border-red-300 focus:border-red-400 focus:ring-red-100',
          className
        )}
        {...rest}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
    </div>
  );
});
