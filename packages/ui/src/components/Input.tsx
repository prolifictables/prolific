import * as React from 'react';
import { cn } from '../index';

export type InputSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZE_CN: Record<InputSize, string> = {
  sm: 'h-9 px-3 text-sm rounded-md',
  md: 'h-10 px-4 text-sm rounded-lg',
  lg: 'h-12 px-4 text-base rounded-xl',
  xl: 'h-14 px-5 text-lg rounded-2xl',
};

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: InputSize;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, size = 'md', leadingIcon, trailingIcon, type, ...props }, ref) => {
    return (
      <div className={cn('relative flex w-full items-center', className)}>
        {leadingIcon ? (
          <div className="pointer-events-none absolute left-3 flex items-center text-slate-500">
            {leadingIcon}
          </div>
        ) : null}
        <input
          ref={ref}
          type={type}
          className={cn(
            'flex w-full rounded-lg border border-slate-300 bg-white text-slate-900 shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
            SIZE_CN[size],
            leadingIcon ? 'pl-10' : '',
            trailingIcon ? 'pr-10' : '',
          )}
          {...props}
        />
        {trailingIcon ? (
          <div className="pointer-events-none absolute right-3 flex items-center text-slate-500">
            {trailingIcon}
          </div>
        ) : null}
      </div>
    );
  },
);
Input.displayName = 'Input';

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[80px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export interface SelectOption {
  label: string;
  value: string;
  disabled?: boolean;
}

export interface SelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  options?: SelectOption[];
  size?: InputSize;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, size = 'md', options, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'flex h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        SIZE_CN[size],
        className,
      )}
      {...props}
    >
      {options?.length ? (
        options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))
      ) : (
        children
      )}
    </select>
  ),
);
Select.displayName = 'Select';
