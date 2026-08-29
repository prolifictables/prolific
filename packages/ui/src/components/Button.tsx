import * as React from 'react';
import { cn } from '../index';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success';
type Size = 'sm' | 'md' | 'lg' | 'xl' | 'icon';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  asChild?: boolean;
}

const VARIANT_CN: Record<Variant, string> = {
  primary:
    'bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 focus-visible:outline-indigo-600 disabled:bg-indigo-300',
  secondary:
    'bg-slate-100 text-slate-900 shadow-sm hover:bg-slate-200 focus-visible:outline-slate-500',
  outline:
    'border border-slate-300 bg-white text-slate-900 hover:bg-slate-50',
  ghost:
    'bg-transparent text-slate-700 hover:bg-slate-100',
  danger:
    'bg-rose-600 text-white shadow-sm hover:bg-rose-700',
  success:
    'bg-emerald-600 text-white shadow-sm hover:bg-emerald-700',
};

const SIZE_CN: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm rounded-md',
  md: 'h-10 px-4 text-sm rounded-lg',
  lg: 'h-12 px-6 text-base rounded-xl',
  xl: 'h-14 px-8 text-lg rounded-2xl',
  icon: 'h-10 w-10 rounded-lg p-2',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', type = 'button', ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
          VARIANT_CN[variant],
          SIZE_CN[size],
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { VARIANT_CN as ButtonVariants, SIZE_CN as ButtonSizes };
