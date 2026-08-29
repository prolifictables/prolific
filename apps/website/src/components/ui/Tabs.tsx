'use client';

import {
  createContext,
  useContext,
  useId,
  useMemo,
  useState,
  Children,
  isValidElement,
  HTMLAttributes,
  forwardRef,
} from 'react';
import { cn } from '@prolific/utils';

/* -------------------------------------------------------------------------- */
/*                                  Context                                   */
/* -------------------------------------------------------------------------- */

interface TabsContextValue {
  value: string;
  setValue: (v: string) => void;
  baseId: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('Tabs.* components must be used within a <Tabs>');
  return ctx;
}

/* -------------------------------------------------------------------------- */
/*                               Root <Tabs>                                  */
/* -------------------------------------------------------------------------- */

export interface TabsProps extends HTMLAttributes<HTMLDivElement> {
  /** Controlled: currently active tab value */
  value?: string;
  /** Uncontrolled: default active tab value */
  defaultValue?: string;
  /** Callback fired when active tab changes */
  onValueChange?: (value: string) => void;
}

export const Tabs = forwardRef<HTMLDivElement, TabsProps>(function Tabs(
  { className, value, defaultValue, onValueChange, children, ...rest },
  ref
) {
  const autoId = useId();
  const [internal, setInternal] = useState(defaultValue ?? '');

  const currentValue = value ?? internal;
  const setValue = (v: string) => {
    if (value === undefined) setInternal(v);
    onValueChange?.(v);
  };

  const ctx = useMemo<TabsContextValue>(
    () => ({ value: currentValue, setValue, baseId: autoId }),
    [currentValue, autoId]
  );

  return (
    <TabsContext.Provider value={ctx}>
      <div ref={ref} className={cn('w-full flex flex-col gap-3', className)} {...rest}>
        {children}
      </div>
    </TabsContext.Provider>
  );
});

/* -------------------------------------------------------------------------- */
/*                                <TabsList>                                  */
/* -------------------------------------------------------------------------- */

interface TabsListProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'underline' | 'pills';
  fit?: 'content' | 'fill';
}

export const TabsList = forwardRef<HTMLDivElement, TabsListProps>(function TabsList(
  { className, variant = 'underline', fit = 'content', children, ...rest },
  ref
) {
  return (
    <div
      ref={ref}
      role="tablist"
      className={cn(
        'flex relative',
        fit === 'fill' && 'w-full [&>*]:flex-1',
        variant === 'underline' &&
          'gap-4 border-b border-white/6 overflow-x-auto scrollbar-hide',
        variant === 'pills' &&
          'gap-1 p-1 rounded-2xl bg-white/[0.03] border border-white/6',
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
});

/* -------------------------------------------------------------------------- */
/*                               <TabsTrigger>                                */
/* -------------------------------------------------------------------------- */

interface TabsTriggerProps extends HTMLAttributes<HTMLButtonElement> {
  value: string;
  disabled?: boolean;
}

export const TabsTrigger = forwardRef<HTMLButtonElement, TabsTriggerProps>(
  function TabsTrigger({ className, value, disabled, children, ...rest }, ref) {
    const { value: active, setValue, baseId } = useTabsContext();
    const isActive = active === value;

    return (
      <button
        ref={ref}
        id={`${baseId}-trigger-${value}`}
        role="tab"
        type="button"
        aria-selected={isActive}
        aria-controls={`${baseId}-panel-${value}`}
        tabIndex={isActive ? 0 : -1}
        disabled={disabled}
        onClick={() => setValue(value)}
        data-state={isActive ? 'active' : 'inactive'}
        className={cn(
          // Common — inline-flex, tap target, transition
          'relative inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed select-none',
          // Underline variant default
          'text-ink-muted hover:text-white',
          isActive && 'text-white',
          // Animated neon underline
          'after:content-[""] after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-gradient-neon after:shadow-[0_0_10px_rgba(212,175,55,0.7)] after:transition-all after:duration-500',
          isActive ? 'after:scale-x-100' : 'after:scale-x-0',
          className
        )}
        {...rest}
      >
        {children}
      </button>
    );
  }
);

/* -------------------------------------------------------------------------- */
/*                               <TabsContent>                                */
/* -------------------------------------------------------------------------- */

interface TabsContentProps extends HTMLAttributes<HTMLDivElement> {
  value: string;
  keepMounted?: boolean;
}

export const TabsContent = forwardRef<HTMLDivElement, TabsContentProps>(
  function TabsContent({ className, value, keepMounted = false, children, ...rest }, ref) {
    const { value: active, baseId } = useTabsContext();
    const isActive = active === value;

    if (!isActive && !keepMounted) return null;

    return (
      <div
        ref={ref}
        id={`${baseId}-panel-${value}`}
        role="tabpanel"
        tabIndex={0}
        aria-labelledby={`${baseId}-trigger-${value}`}
        hidden={!isActive}
        className={cn(
          'w-full outline-none',
          isActive && 'animate-fade-in-up',
          className
        )}
        {...rest}
      >
        {isActive || keepMounted ? children : null}
      </div>
    );
  }
);
