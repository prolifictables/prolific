'use client';

import { cn } from '@prolific/utils';
import { useCart } from '../lib/store';
import { Badge } from './ui/Badge';
import { Button, IconButton } from './ui/Button';
import { Textarea } from './ui/Input';
import { EmptyCart } from './ui/EmptyState';
import { Progress } from './ui/Progress';

interface CartSheetProps {
  open: boolean;
  onClose: () => void;
  onCheckout: () => void;
  defaultTax: { rate?: number; name?: string } | null;
  modifiersMap?: Record<string, { id: string; name: string; options: Record<string, string> }>;
}

type OrderTypeKey = 'DINE_IN' | 'TAKEAWAY' | 'PICKUP' | 'DELIVERY';

const ORDER_TYPE_LABELS: Record<OrderTypeKey, { label: string; icon: string; desc: string }> = {
  DINE_IN: { label: 'Dine-In', icon: '🍽️', desc: 'Eat here at your table' },
  TAKEAWAY: { label: 'Takeaway', icon: '🥡', desc: 'Bag it up to go' },
  PICKUP: { label: 'Pickup', icon: '🛍️', desc: 'Collect at counter' },
  DELIVERY: { label: 'Delivery', icon: '🛵', desc: 'Delivered to your door' },
};

function formatNGN(amountCents: number) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
  }).format(amountCents / 100);
}

export function CartSheet({
  open,
  onClose,
  onCheckout,
  defaultTax,
  modifiersMap = {},
}: CartSheetProps) {
  const items = useCart((s) => s.items);
  const removeItem = useCart((s) => s.removeItem);
  const setQty = useCart((s) => s.setQty);
  const clear = useCart((s) => s.clear);
  const orderType = useCart((s) => s.orderType) as OrderTypeKey;
  const setOrderType = useCart((s) => s.setOrderType);
  const note = useCart((s) => s.note);
  const setNote = useCart((s) => s.setNote);

  const taxRate = defaultTax?.rate ?? 0;
  const totals = useCart.getState().totals(taxRate);

  const subtotalCents = totals.subtotalCents;
  const taxCents = totals.taxCents;
  const finalTotalCents = totals.totalCents;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div
        className="absolute inset-0 bg-black/65 backdrop-blur-md animate-fade-in"
        onClick={onClose}
      />
      <div className="relative w-full max-w-[480px] bg-gradient-to-b from-surface-panel to-surface-elevated border-t border-white/10 shadow-[0_-20px_60px_-15px_rgba(212,175,55,0.35)] rounded-t-[2rem] max-h-[92vh] overflow-hidden flex flex-col animate-slide-up">
        {/* Grabber */}
        <div className="pt-3 pb-1 flex justify-center pointer-events-none">
          <span className="inline-block w-12 h-1.5 rounded-full bg-white/15" />
        </div>

        {/* Header */}
        <div className="px-5 pt-2 pb-3 flex items-center justify-between">
          <div>
            <h3 className="font-display text-[22px] leading-tight font-bold text-white tracking-tight">
              Your Order
            </h3>
            <p className="text-[12.5px] text-ink-muted mt-0.5">
              Review before checkout
              {items.length > 0 && (
                <span className="ml-1 text-ink-faint">· {items.length} item{items.length !== 1 ? 's' : ''}</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {items.length > 0 && (
              <button
                onClick={() => clear()}
                className="w-10 h-10 rounded-2xl bg-red-500/10 text-red-400 flex items-center justify-center hover:bg-red-500/15 active:scale-95 transition-all border border-red-500/20"
                aria-label="Clear all items"
                title="Clear all"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
              </button>
            )}
            <IconButton variant="ghost" size="md" onClick={onClose} aria-label="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </IconButton>
          </div>
        </div>

        <div className="hairline mx-5" />

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {items.length === 0 ? (
            <div className="py-16 px-5">
              <EmptyCart compact />
            </div>
          ) : (
            <div className="px-5 py-4 space-y-4">
              {/* Items list */}
              <div className="space-y-3">
                {items.map((item, idx) => {
                  const stagger = idx < 8 ? idx % 4 : 3;
                  const animClass = [
                    'animate-fade-in-up',
                    '',
                    'animate-fade-in-up-200',
                    'animate-fade-in-up-300',
                    'animate-fade-in-up-400',
                  ][stagger];
                  const modifierBadges: string[] = [];
                  item.selectedModifierOptions.forEach((sm) => {
                    const mod = modifiersMap[sm.modifierId];
                    if (mod) {
                      const optName = mod.options[sm.optionId] || sm.optionId;
                      modifierBadges.push(optName);
                    }
                  });
                  return (
                    <div
                      key={item.key}
                      className={cn(
                        'relative group flex gap-3.5 p-3.5 rounded-[1.25rem] bg-surface-muted/70 border border-white/5',
                        'hover:shadow-lg hover:-translate-y-0.5 hover:border-amber-400/25 transition-all duration-300 ease-out-expo',
                        animClass
                      )}
                    >
                      <div className="w-20 h-20 rounded-2xl bg-surface-panel overflow-hidden flex-shrink-0 ring-1 ring-white/10">
                        {item.imageUrl ? (
                          <img
                            src={item.imageUrl}
                            alt={item.name}
                            className="w-full h-full object-cover transition-transform duration-400 group-hover:scale-110"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-3xl bg-gradient-neon/20">
                            🍲
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="font-bold text-[14.5px] text-white leading-tight">
                            {item.name}
                          </h4>
                          <button
                            onClick={() => removeItem(item.key)}
                            className="w-8 h-8 flex-shrink-0 rounded-xl text-ink-muted hover:text-red-400 hover:bg-red-500/10 flex items-center justify-center transition-all active:scale-90 border border-transparent hover:border-red-500/20"
                            aria-label="Remove"
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </div>

                        {modifierBadges.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {modifierBadges.map((b, i) => (
                              <Badge key={i} variant="neon" size="xs">
                                {b}
                              </Badge>
                            ))}
                          </div>
                        )}

                        {item.specialInstructions && (
                          <p className="mt-1.5 text-[11.5px] text-ink-soft italic leading-snug">
                            <span className="not-italic text-ink-muted font-semibold">Note: </span>
                            “{item.specialInstructions}”
                          </p>
                        )}

                        <div className="mt-3 flex items-center justify-between">
                          <div className="inline-flex items-center rounded-2xl bg-surface-panel ring-1 ring-white/10 overflow-hidden">
                            <button
                              onClick={() => setQty(item.key, item.quantity - 1)}
                              disabled={item.quantity <= 1}
                              className="w-9 h-9 flex items-center justify-center text-ink-muted hover:text-amber-300 hover:bg-amber-500/10 disabled:opacity-30 disabled:hover:bg-transparent transition-all text-lg font-bold"
                              aria-label="Decrease quantity"
                            >
                              −
                            </button>
                            <span className="w-8 text-center text-[14px] font-bold text-white tabular-nums">
                              {item.quantity}
                            </span>
                            <button
                              onClick={() => setQty(item.key, item.quantity + 1)}
                              disabled={item.quantity >= 99}
                              className="w-9 h-9 flex items-center justify-center text-ink-muted hover:text-amber-300 hover:bg-amber-500/10 disabled:opacity-30 disabled:hover:bg-transparent transition-all text-lg font-bold"
                              aria-label="Increase quantity"
                            >
                              +
                            </button>
                          </div>
                          <span className="font-extrabold text-gradient-neon text-[15px] tracking-tight tabular-nums">
                            {formatNGN(item.perUnitTotalCents * item.quantity)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Order Type Tiles */}
              <div className="pt-2">
                <p className="text-[12px] font-bold text-ink-soft uppercase tracking-wider mb-2 px-1">
                  Order Type
                </p>
                <div className="grid grid-cols-2 gap-2.5">
                  {(['DINE_IN', 'TAKEAWAY', 'PICKUP', 'DELIVERY'] as OrderTypeKey[]).map((k) => {
                    const ot = ORDER_TYPE_LABELS[k];
                    const active = orderType === k;
                    return (
                      <button
                        key={k}
                        onClick={() => setOrderType(k)}
                        className={cn(
                          'ripple-target flex flex-col items-start gap-0.5 p-3.5 rounded-[1.1rem] text-left transition-all duration-300 ease-out-expo',
                          active
                            ? 'bg-gradient-neon text-white shadow-glow-restaurant ring-2 ring-white/15 scale-[1.02]'
                            : 'bg-surface-muted text-ink-soft border border-white/6 hover:border-white/10 hover:bg-surface-elevated'
                        )}
                      >
                        <div
                          className={cn(
                            'w-9 h-9 rounded-xl flex items-center justify-center text-lg mb-0.5 transition',
                            active ? 'bg-white/20' : 'bg-white/5'
                          )}
                        >
                          {ot.icon}
                        </div>
                        <div
                          className={cn(
                            'text-[13px] font-extrabold leading-tight',
                            active ? 'text-white' : 'text-white'
                          )}
                        >
                          {ot.label}
                        </div>
                        <div
                          className={cn(
                            'text-[11px] leading-snug mt-0.5',
                            active ? 'text-white/85' : 'text-ink-muted'
                          )}
                        >
                          {ot.desc}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Note to kitchen */}
              <div className="pt-1">
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, 200))}
                  rows={2}
                  maxLength={200}
                  placeholder="e.g., No onions please, extra spicy on the side"
                  label="Add a note to kitchen"
                />
              </div>

              {/* Totals card */}
              <div className="pt-1">
                <div className="relative overflow-hidden rounded-[1.4rem] p-5 bg-gradient-card border border-white/6 shadow-md">
                  <div className="absolute -top-8 -right-8 blob w-28 h-28 bg-amber-500/15 blur-2xl" />
                  <div className="relative">
                    <div className="space-y-2.5 text-[14px]">
                      <div className="flex justify-between items-center text-ink-soft">
                        <span>Subtotal</span>
                        <span className="font-semibold tabular-nums text-white">
                          {formatNGN(subtotalCents)}
                        </span>
                      </div>
                      {taxRate > 0 && (
                        <div className="flex justify-between items-center text-ink-soft">
                          <span>Tax ({defaultTax?.name || 'VAT'} · {taxRate}%)</span>
                          <span className="font-semibold tabular-nums text-white">
                            {formatNGN(taxCents)}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="rule my-3.5" />

                    <div className="flex items-baseline justify-between">
                      <div>
                        <p className="text-[11px] uppercase tracking-widest font-bold text-ink-muted">
                          Total due
                        </p>
                        <Progress
                          value={Math.min(100, Math.round(subtotalCents / 8000))}
                          tone="neon"
                          size="sm"
                          static
                          className="mt-2 w-32"
                        />
                      </div>
                      <span className="font-display text-[28px] font-extrabold text-gradient-neon tracking-tight tabular-nums">
                        {formatNGN(finalTotalCents)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer CTA */}
        {items.length > 0 && (
          <div className="border-t border-white/10 bg-surface-panel/80 backdrop-blur-xl p-4 pb-6 pt-3">
            <Button
              variant="neon"
              size="xl"
              fullWidth
              rightIcon={
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              }
              onClick={onCheckout}
            >
              Continue to Checkout
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
