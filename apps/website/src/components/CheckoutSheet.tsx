'use client';

import { useState } from 'react';
import { cn } from '@prolific/utils';
import { useCart, useSession } from '../lib/store';
import { apiPost } from '../lib/api';
import { Button, IconButton } from './ui/Button';
import { Input } from './ui/Input';
import { Badge } from './ui/Badge';
import { Alert } from './ui/Alert';
import { Stepper } from './ui/Stepper';

interface CheckoutSheetProps {
  open: boolean;
  onClose: () => void;
  defaultTax: { rate?: number; name?: string } | null;
  onOrderSubmitted: (order: any, orderId: string) => void;
  mode?: 'QR' | 'DIRECT';
  directBranchId?: string;
}

type PayIntent = 'PAY_AT_POS' | 'PAY_ONLINE';
type Provider = 'PAYSTACK' | 'FLUTTERWAVE';
type Step = 0 | 1 | 2; // 0: method, 1: info, 2: confirm

function formatNGN(amountCents: number) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
  }).format(amountCents / 100);
}

export function CheckoutSheet({
  open,
  onClose,
  defaultTax,
  onOrderSubmitted,
  mode = 'QR',
  directBranchId,
}: CheckoutSheetProps) {
  const [payIntent, setPayIntent] = useState<PayIntent>('PAY_AT_POS');
  const [provider, setProvider] = useState<Provider>('PAYSTACK');
  const [customerName, setCustomerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>(0);

  const session = useSession((s) => s.session);
  const token = useSession((s) => s.token);
  const guestToken = useSession((s) => s.guestToken);
  const orderType = useCart((s) => s.orderType);

  const items = useCart((s) => s.items);
  const note = useCart((s) => s.note);
  const clearCart = useCart((s) => s.clear);
  const totals = useCart.getState().totals(defaultTax?.rate ?? 0);
  const tax = defaultTax?.rate ?? 0;

  const subtotal = totals.subtotalCents;
  const taxCents = Math.round(subtotal * (tax / 100));
  const total = subtotal + taxCents;

  const handleSubmit = async () => {
    if (mode === 'QR') {
      if (!session?.id || !token || !guestToken) {
        setError('Session not ready — please reload and scan QR again.');
        return;
      }
    } else {
      if (!directBranchId) {
        setError('Branch not selected — please reload and choose a location.');
        return;
      }
    }
    setError(null);
    setSubmitting(true);
    try {
      const bodyItems = items.map((it) => ({
        menuItemId: it.menuItemId,
        quantity: it.quantity,
        specialInstructions: it.specialInstructions || undefined,
        selectedModifierOptions: it.selectedModifierOptions,
      }));
      const res =
        mode === 'QR'
          ? await apiPost<any>(`/public/table-sessions/${session!.id}/orders`, {
              qrToken: token,
              guestToken,
              items: bodyItems,
              orderType,
              notes: note || undefined,
              displayName: customerName || undefined,
              customerInfo:
                customerName || email || phone
                  ? { name: customerName, email, phone }
                  : undefined,
              payIntent,
              onlineProvider: payIntent === 'PAY_ONLINE' ? provider : undefined,
            })
          : await apiPost<any>(`/public/orders`, {
              branchId: directBranchId,
              items: bodyItems,
              orderType,
              notes: note || undefined,
              displayName: customerName || undefined,
              customerInfo:
                customerName || email || phone
                  ? { name: customerName, email, phone }
                  : undefined,
              payIntent,
              onlineProvider: payIntent === 'PAY_ONLINE' ? provider : undefined,
            });

      const orderId = res.order?.id || res.order?._id || '';
      if (typeof window !== 'undefined') {
        localStorage.setItem('lastOrderId', orderId);
        const route =
          mode === 'QR' && token ? `/t/${token}/orders/${orderId}` : `/orders/${orderId}`;
        localStorage.setItem('lastOrderRoute', route);
      }

      if (payIntent === 'PAY_ONLINE' && res.paymentIntent?.checkoutUrl) {
        window.location.assign(res.paymentIntent.checkoutUrl);
        return;
      }

      clearCart();
      onOrderSubmitted(res.order, orderId);
    } catch (e: any) {
      setError(e.message || 'Failed to submit order. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const steps: { label: string; description?: string }[] = [
    { label: 'Payment', description: 'Method' },
    { label: 'Details', description: 'Optional' },
    { label: 'Confirm', description: 'Place' },
  ];

  // Navigate forward
  const goNext = () => {
    if (step === 0) {
      setStep(1);
    } else if (step === 1) {
      setStep(2);
    } else {
      handleSubmit();
    }
  };
  const goBack = () => {
    if (step > 0) setStep((step - 1) as Step);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div
        className="absolute inset-0 bg-black/65 backdrop-blur-md animate-fade-in"
        onClick={onClose}
      />
      <div className="relative w-full max-w-[480px] bg-gradient-to-b from-surface-panel to-surface-elevated border-t border-white/10 shadow-[0_-20px_60px_-15px_rgba(212,175,55,0.35)] rounded-t-[2rem] max-h-[94vh] overflow-hidden flex flex-col animate-slide-up">
        {/* Grabber */}
        <div className="pt-3 pb-1 flex justify-center pointer-events-none">
          <span className="inline-block w-12 h-1.5 rounded-full bg-white/15" />
        </div>

        {/* Header */}
        <div className="px-5 pt-1 pb-3 flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <Badge variant="neon" size="sm" className="mb-1.5" dot>
              Secure checkout
            </Badge>
            <h3 className="font-display text-[21px] leading-tight font-bold text-white tracking-tight">
              {step === 0 && 'Choose Payment'}
              {step === 1 && 'Your details'}
              {step === 2 && 'Confirm Order'}
            </h3>
            <p className="text-[12.5px] text-ink-muted mt-0.5">
              Total due:{' '}
              <span className="font-extrabold text-gradient-neon">{formatNGN(total)}</span>
            </p>
          </div>
          <IconButton variant="ghost" size="md" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </IconButton>
        </div>

        {/* Stepper */}
        <div className="px-5 pb-2">
          <Stepper steps={steps} currentStep={step} size="sm" />
        </div>

        <div className="hairline mx-5" />

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 scrollbar-thin">
          {error && <Alert tone="danger" onClose={() => setError(null)}>{error}</Alert>}

          {step === 0 && (
            <div className="space-y-3 animate-fade-in-up">
              {/* Pay at POS */}
              <button
                onClick={() => setPayIntent('PAY_AT_POS')}
                className={cn(
                  'ripple-target relative w-full text-left rounded-[1.2rem] p-4.5 border-2 transition-all duration-300 ease-out-expo overflow-hidden',
                  payIntent === 'PAY_AT_POS'
                    ? 'border-amber-400/40 bg-gradient-card shadow-glow-restaurant ring-2 ring-amber-500/20'
                    : 'border-white/6 bg-surface-muted hover:border-white/10 hover:bg-surface-elevated'
                )}
              >
                {payIntent === 'PAY_AT_POS' && (
                  <div className="absolute -top-10 -right-8 blob w-32 h-32 bg-amber-500/20 blur-2xl" />
                )}
                <div className="relative flex items-start gap-3.5">
                  <div
                    className={cn(
                      'w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 text-2xl shadow-sm',
                      payIntent === 'PAY_AT_POS'
                        ? 'bg-gradient-neon text-white ring-2 ring-white/25 shadow-glow-restaurant'
                        : 'bg-white/5 border border-white/10'
                    )}
                  >
                    💵
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="font-extrabold text-white text-[15.5px] tracking-tight">
                        Pay at Counter
                      </h4>
                      {payIntent === 'PAY_AT_POS' && <Badge size="xs" variant="neon">Selected</Badge>}
                    </div>
                    <p className="text-[12.5px] text-ink-muted mt-1 leading-relaxed">
                      Your order will be sent to the kitchen. Pay in person with cash or POS when served.
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <Badge size="xs" variant="soft">No fees</Badge>
                      <Badge size="xs" variant="neon-lime" dot>Instant</Badge>
                    </div>
                  </div>
                </div>
              </button>

              {/* Pay online */}
              <button
                onClick={() => setPayIntent('PAY_ONLINE')}
                className={cn(
                  'ripple-target relative w-full text-left rounded-[1.2rem] p-4.5 border-2 transition-all duration-300 ease-out-expo overflow-hidden',
                  payIntent === 'PAY_ONLINE'
                    ? 'border-pink-400/40 bg-gradient-card shadow-glow-accent ring-2 ring-pink-500/20'
                    : 'border-white/6 bg-surface-muted hover:border-white/10 hover:bg-surface-elevated'
                )}
              >
                {payIntent === 'PAY_ONLINE' && (
                  <div className="absolute -top-10 -right-8 blob w-32 h-32 bg-pink-500/20 blur-2xl" />
                )}
                <div className="relative flex items-start gap-3.5">
                  <div
                    className={cn(
                      'w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 text-2xl shadow-sm',
                      payIntent === 'PAY_ONLINE'
                        ? 'bg-[linear-gradient(120deg,#EA580C_0%,#CD7F32_100%)] text-white ring-2 ring-white/25 shadow-glow-accent'
                        : 'bg-white/5 border border-white/10'
                    )}
                  >
                    💳
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="font-extrabold text-white text-[15.5px] tracking-tight">
                        Pay Online
                      </h4>
                      {payIntent === 'PAY_ONLINE' && <Badge size="xs" variant="neon-pink">Selected</Badge>}
                    </div>
                    <p className="text-[12.5px] text-ink-muted mt-1 leading-relaxed">
                      Pay securely with your card or bank transfer. Skip the counter line.
                    </p>

                    {payIntent === 'PAY_ONLINE' && (
                      <div className="mt-3 grid grid-cols-2 gap-2.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setProvider('PAYSTACK');
                          }}
                          className={cn(
                            'ripple-target relative overflow-hidden rounded-[0.95rem] py-3 px-3 text-sm font-extrabold border transition-all duration-300',
                            provider === 'PAYSTACK'
                              ? 'bg-[#0AA5DB] text-white border-[#0AA5DB]/60 shadow-[0_0_24px_-6px_rgba(10,165,219,0.7)] scale-[1.02]'
                              : 'bg-surface-panel text-white border-white/10 hover:bg-white/5'
                          )}
                        >
                          <span className="flex items-center justify-center gap-2">
                            <span className={cn('inline-block w-2 h-2 rounded-full', provider === 'PAYSTACK' ? 'bg-white' : 'bg-[#0AA5DB]')} />
                            Paystack
                          </span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setProvider('FLUTTERWAVE');
                          }}
                          className={cn(
                            'ripple-target relative overflow-hidden rounded-[0.95rem] py-3 px-3 text-sm font-extrabold border transition-all duration-300',
                            provider === 'FLUTTERWAVE'
                              ? 'bg-[#F5A623] text-white border-[#F5A623]/60 shadow-[0_0_24px_-6px_rgba(245,166,35,0.7)] scale-[1.02]'
                              : 'bg-surface-panel text-white border-white/10 hover:bg-white/5'
                          )}
                        >
                          <span className="flex items-center justify-center gap-2">
                            <span className={cn('inline-block w-2 h-2 rounded-full', provider === 'FLUTTERWAVE' ? 'bg-white' : 'bg-[#F5A623]')} />
                            Flutterwave
                          </span>
                        </button>
                      </div>
                    )}

                    <div className="mt-2.5 flex items-center gap-2">
                      <Badge size="xs" variant="neon-pink">🔒 Secure</Badge>
                      <Badge size="xs" variant="soft">3-D Secure</Badge>
                    </div>
                  </div>
                </div>
              </button>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3.5 animate-fade-in-up-200">
              <div className="rounded-[1.15rem] bg-gradient-card p-4 border border-white/6 shadow-sm relative overflow-hidden">
                <div className="absolute -top-12 -right-10 blob w-32 h-32 bg-amber-500/15 blur-2xl" />
                <div className="relative flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-gradient-neon text-white flex items-center justify-center shadow-glow-restaurant shrink-0">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-white text-[14.5px] leading-tight">
                      Guest information
                    </p>
                    <p className="text-[12px] text-ink-muted mt-0.5 leading-relaxed">
                      Optional — helps us notify you when it&apos;s ready and send receipts.
                    </p>
                  </div>
                </div>
              </div>
              <Input
                label="Your Name"
                placeholder="e.g., Tunde"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                maxLength={40}
              />
              <Input
                label="Email (for receipt)"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={80}
              />
              <Input
                label="Phone Number"
                placeholder="080..."
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={15}
              />
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4 animate-fade-in-up-300">
              {/* Order summary */}
              <div className="relative overflow-hidden rounded-[1.25rem] border border-white/6 bg-gradient-card shadow-md">
                <div className="absolute -top-16 right-0 blob w-44 h-44 bg-amber-500/15 blur-3xl" />
                <div className="relative px-5 pt-5 pb-4 border-b border-white/6 flex items-center justify-between">
                  <div>
                    <p className="text-[11px] uppercase tracking-widest font-bold text-ink-muted">
                      Order Summary
                    </p>
                    <h4 className="mt-1 font-extrabold text-[17px] text-white tracking-tight">
                      {items.length} item{items.length !== 1 ? 's' : ''}
                    </h4>
                  </div>
                  <Badge variant="neon" size="sm" dot>
                    Ready
                  </Badge>
                </div>
                <div className="relative px-5 py-3 space-y-1.5 text-[13.5px] max-h-[28vh] overflow-y-auto scrollbar-thin">
                  {items.map((it, i) => (
                    <div
                      key={it.key}
                      className={cn(
                        'flex items-baseline justify-between gap-3 py-2 border-b last:border-0 border-white/5',
                        i < 4 && `animate-fade-in-up-${i === 0 ? '' : (i * 100)}`
                      )}
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-white truncate leading-tight">
                          <span className="inline-block min-w-[1.25rem] text-ink-muted tabular-nums font-bold">
                            {it.quantity}×
                          </span>{' '}
                          {it.name}
                        </p>
                        {it.specialInstructions && (
                          <p className="text-[11px] text-ink-soft italic mt-0.5 truncate">
                            + “{it.specialInstructions}”
                          </p>
                        )}
                      </div>
                      <span className="font-bold text-white tabular-nums shrink-0">
                        {formatNGN(it.perUnitTotalCents * it.quantity)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="relative px-5 py-4 border-t border-white/10 bg-surface-panel/60 backdrop-blur-sm space-y-2">
                  <div className="flex justify-between text-[13.5px] text-ink-soft">
                    <span>Subtotal</span>
                    <span className="font-semibold tabular-nums text-white">{formatNGN(subtotal)}</span>
                  </div>
                  {tax > 0 && (
                    <div className="flex justify-between text-[13.5px] text-ink-soft">
                      <span>
                        Tax ({defaultTax?.name || 'VAT'} · {tax}%)
                      </span>
                      <span className="font-semibold tabular-nums text-white">{formatNGN(taxCents)}</span>
                    </div>
                  )}
                  <div className="rule my-2" />
                  <div className="flex items-baseline justify-between">
                    <span className="text-[11px] uppercase tracking-widest font-bold text-ink-muted">
                      Amount due
                    </span>
                    <span className="font-display text-[26px] font-extrabold text-gradient-neon tracking-tight tabular-nums">
                      {formatNGN(total)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Method summary */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="rounded-[1rem] bg-surface-muted border border-white/6 p-3 shadow-sm">
                  <p className="text-[10.5px] uppercase tracking-widest font-bold text-ink-muted">Method</p>
                  <p className="mt-1 font-extrabold text-white text-[14px] leading-tight">
                    {payIntent === 'PAY_AT_POS' ? 'Counter' : 'Online'}
                    {payIntent === 'PAY_ONLINE' && (
                      <>
                        {' '}
                        <span className="text-ink-soft font-semibold">
                          · {provider === 'PAYSTACK' ? 'Paystack' : 'Flutterwave'}
                        </span>
                      </>
                    )}
                  </p>
                </div>
                <div className="rounded-[1rem] bg-surface-muted border border-white/6 p-3 shadow-sm">
                  <p className="text-[10.5px] uppercase tracking-widest font-bold text-ink-muted">
                    Order type
                  </p>
                  <p className="mt-1 font-extrabold text-white text-[14px] leading-tight capitalize">
                    {orderType.toLowerCase().replace('_', ' ')}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-white/10 bg-surface-panel/80 backdrop-blur-xl p-4 pb-6 pt-3 space-y-3">
          {/* amount display when not step 2 */}
          {step !== 2 && (
            <div className="flex items-center justify-between px-1">
              <span className="text-[12px] text-ink-muted font-semibold">Amount due</span>
              <span className="font-display text-[22px] font-extrabold text-gradient-neon tracking-tight tabular-nums">
                {formatNGN(total)}
              </span>
            </div>
          )}
          <div className="flex gap-2.5">
            {step > 0 && (
              <Button variant="soft" size="xl" onClick={goBack}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="19" y1="12" x2="5" y2="12" />
                  <polyline points="12 19 5 12 12 5" />
                </svg>
                Back
              </Button>
            )}
            <Button
              variant="neon"
              size="xl"
              fullWidth
              loading={submitting}
              onClick={goNext}
              disabled={items.length === 0}
              rightIcon={
                step < 2 ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                ) : undefined
              }
            >
              {step === 0 && 'Continue'}
              {step === 1 && 'Review & Place'}
              {step === 2 &&
                (payIntent === 'PAY_AT_POS' ? 'Submit Order' : `Pay ${formatNGN(total)}`)}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
