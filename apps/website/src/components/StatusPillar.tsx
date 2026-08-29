'use client';

import { cn } from '@prolific/utils';

type Step = {
  key: 'RECEIVED' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'COMPLETED';
  label: string;
  icon: (active: boolean, done: boolean) => React.ReactNode;
};

const STEPS: Step[] = [
  {
    key: 'RECEIVED',
    label: 'Order Received',
    icon: (active, done) => (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active || done ? 2.2 : 2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 3" />
      </svg>
    ),
  },
  {
    key: 'ACCEPTED',
    label: 'Accepted',
    icon: (active, done) => (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active || done ? 2.2 : 2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 12l2 2 4-4" />
        <path d="M21 12c0 5-4 9-9 9s-9-4-9-9 4-9 9-9c2.5 0 4.7 1 6.4 2.6" />
      </svg>
    ),
  },
  {
    key: 'PREPARING',
    label: 'Preparing',
    icon: (active, done) => (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={active || done ? 2.2 : 2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={active && !done ? 'animate-spin origin-center' : ''}
      >
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <path d="M3 10h18" />
        <rect x="3" y="6" width="18" height="14" rx="2" />
        <path d="M7 14h.01M12 14h.01M17 14h.01" />
      </svg>
    ),
  },
  {
    key: 'READY',
    label: 'Ready',
    icon: (active, done) => (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active || done ? 2.2 : 2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
    ),
  },
  {
    key: 'COMPLETED',
    label: 'Served',
    icon: (active, done) => (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active || done ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    ),
  },
];

const STATUS_ORDER: string[] = [
  'PENDING',
  'RECEIVED',
  'AWAITING_PAYMENT',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'SERVED',
  'COMPLETED',
];

function normalize(status: string): Step['key'] {
  switch (status) {
    case 'RECEIVED':
    case 'PENDING':
    case 'AWAITING_PAYMENT':
      return 'RECEIVED';
    case 'SERVED':
    case 'COMPLETED':
      return 'COMPLETED';
    case 'ACCEPTED':
    case 'PREPARING':
    case 'READY':
      return status as Step['key'];
    default:
      return 'RECEIVED';
  }
}

export function StatusPillar({
  status,
  paymentStatus,
}: {
  status: string;
  paymentStatus?: string;
}) {
  const current = normalize(status);
  const currentIdx = STEPS.findIndex((s) => s.key === current);

  return (
    <div className="rounded-3xl bg-white shadow-md border border-restaurant-100 p-5 relative overflow-hidden">
      {/* Decorative top gradient strip */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-1 bg-gradient-sunset" />

      {paymentStatus && paymentStatus !== 'PAID' && (
        <div className="mb-5 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3.5 text-sm flex items-start gap-3 animate-fade-in-up">
          <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center flex-shrink-0">
            <span className="text-lg">💳</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-amber-900 text-sm">Awaiting payment</p>
            <p className="text-amber-700 text-xs mt-0.5 leading-relaxed">
              Please settle your bill at the cashier, or pay from your phone at checkout.
            </p>
          </div>
        </div>
      )}

      <ol className="relative">
        {STEPS.map((step, i) => {
          const done = currentIdx > i;
          const active = currentIdx === i;
          const isLast = i === STEPS.length - 1;
          return (
            <li key={step.key} className="relative flex gap-4 pb-6 last:pb-0 animate-fade-in-up" style={{ animationDelay: `${i * 80}ms` }}>
              {/* Connector line */}
              {!isLast && (
                <span className="absolute left-[18px] top-[44px] w-0.5 h-[calc(100%-1.25rem)] overflow-hidden rounded-full bg-restaurant-100">
                  {done && (
                    <span
                      className="block w-full h-full bg-gradient-to-b from-emerald-500 to-emerald-400 animate-progress"
                    />
                  )}
                </span>
              )}

              {/* Circle */}
              <div
                className={cn(
                  'relative z-10 flex-shrink-0 w-[42px] h-[42px] rounded-full flex items-center justify-center border-0 transition-all duration-500',
                  done && 'bg-gradient-forest text-white shadow-glow-emerald',
                  active &&
                    !done &&
                    'bg-gradient-sunset text-white shadow-glow-accent ring-4 ring-accent-200/50 animate-pulse-soft',
                  !done &&
                    !active &&
                    'bg-white text-ink-faint ring-2 ring-restaurant-100'
                )}
              >
                {step.icon(active, done)}
              </div>

              {/* Label */}
              <div className="flex-1 pt-2">
                <p
                  className={cn(
                    'text-sm font-bold leading-tight',
                    (done || active) ? 'text-ink' : 'text-ink-faint'
                  )}
                >
                  {step.label}
                </p>
                <p
                  className={cn(
                    'text-xs mt-1 font-medium',
                    done && 'text-emerald-600',
                    active && !done && 'text-accent-700',
                    !done && !active && 'text-ink-muted'
                  )}
                >
                  {done && 'Completed ✓'}
                  {active && !done && 'Currently in progress…'}
                  {!done && !active && 'Pending'}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
