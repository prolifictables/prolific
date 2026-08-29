'use client';

import { cn } from '@prolific/utils';
import { useCart } from '../lib/store';

interface CartBarProps {
  onClick: () => void;
  taxRatePercent?: number;
  disabled?: boolean;
}

function formatNGN(amountCents: number) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
  }).format(amountCents / 100);
}

export function CartBar({ onClick, taxRatePercent = 0, disabled }: CartBarProps) {
  const items = useCart((s) => s.items);
  const itemCount = useCart((s) => s.itemCount());
  const totals = useCart((s) => s.totals(taxRatePercent));

  if (items.length === 0) return null;

  return (
    <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] z-40 px-3 pb-4 pt-2 pointer-events-none animate-slide-up">
      {/* subtle gradient fade */}
      <div className="pointer-events-none absolute inset-x-0 -top-8 h-12 bg-gradient-to-t from-black/20 to-transparent" />
      <button
        disabled={disabled}
        onClick={onClick}
        className={cn(
          'ripple-target relative w-full pointer-events-auto overflow-hidden rounded-[1.4rem] px-4 py-3.5',
          'bg-gradient-warm text-white shadow-glow-restaurant ring-2 ring-white/20',
          'flex items-center justify-between gap-3',
          'transition-all duration-300 ease-out-expo hover:scale-[1.01] active:scale-[0.99]',
          'hover:shadow-[0_20px_45px_-10px_rgba(139,94,52,0.55)]',
          disabled && 'opacity-70 cursor-not-allowed'
        )}
      >
        {/* grain overlay */}
        <div className="pointer-events-none absolute inset-0 grain opacity-30 mix-blend-overlay" />

        <div className="flex items-center gap-3 min-w-0 relative z-10">
          <div className="relative w-12 h-12 rounded-2xl bg-white/15 backdrop-blur text-white flex items-center justify-center flex-shrink-0 ring-1 ring-white/25">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="9" cy="21" r="1" />
              <circle cx="20" cy="21" r="1" />
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
            </svg>
            {itemCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[22px] h-[22px] px-1 rounded-full bg-white text-restaurant-700 text-[11px] font-extrabold flex items-center justify-center shadow-lg ring-2 ring-restaurant-600 animate-pop">
                {itemCount > 99 ? '99+' : itemCount}
              </span>
            )}
          </div>
          <div className="min-w-0 text-left">
            <p className="text-[11px] uppercase tracking-wider font-bold text-white/75 leading-none">
              {itemCount} item{itemCount !== 1 ? 's' : ''} · Tap to view
            </p>
            <p className="mt-1 text-[18px] font-extrabold text-white truncate tracking-tight">
              {formatNGN(totals.totalCents)}
            </p>
          </div>
        </div>

        <span className="relative z-10 inline-flex items-center gap-1.5 rounded-xl bg-white text-restaurant-800 px-4 py-2.5 text-sm font-extrabold shadow-lg ring-1 ring-black/5">
          Checkout
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </span>
      </button>
    </div>
  );
}
