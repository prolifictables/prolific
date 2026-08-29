'use client';

import { useEffect, useState } from 'react';
import type { CustomerBranding, CustomerOrderPreview } from '../../vite-env';
import { formatCentsToNgn } from '../../lib/ui-helpers';

type PillarKey = 'RECEIVED' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'SERVED';

const PILLAR_STEPS: {
  key: PillarKey;
  label: string;
}[] = [
  { key: 'RECEIVED', label: 'Received' },
  { key: 'ACCEPTED', label: 'Accepted' },
  { key: 'PREPARING', label: 'Preparing' },
  { key: 'READY', label: 'Ready' },
  { key: 'SERVED', label: 'Served' },
];

function normalizeStatus(status?: string): PillarKey {
  switch ((status || '').toUpperCase()) {
    case 'RECEIVED':
    case 'PENDING':
    case 'AWAITING_PAYMENT':
    case 'NEW':
      return 'RECEIVED';
    case 'ACCEPTED':
      return 'ACCEPTED';
    case 'PREPARING':
    case 'COOKING':
    case 'IN_PROGRESS':
      return 'PREPARING';
    case 'READY':
    case 'READY_FOR_PICKUP':
      return 'READY';
    case 'SERVED':
    case 'COMPLETED':
    case 'DELIVERED':
      return 'SERVED';
    default:
      return 'RECEIVED';
  }
}

function StatusPillar({ orderStatus }: { orderStatus?: string }) {
  const current = normalizeStatus(orderStatus);
  const currentIdx = PILLAR_STEPS.findIndex((s) => s.key === current);

  return (
    <ol className="flex items-center justify-between gap-2 w-full">
      {PILLAR_STEPS.map((step, i) => {
        const done = currentIdx > i;
        const active = currentIdx === i;
        const isLast = i === PILLAR_STEPS.length - 1;

        return (
          <li key={step.key} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-2 min-w-0">
              <div
                className={`relative z-10 flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center border-3 transition-all ${
                  done
                    ? 'bg-emerald-500 text-white border-emerald-500 shadow-lg'
                    : active
                      ? 'bg-accent-500 text-white border-accent-500 shadow-lg animate-pulse-soft'
                      : 'bg-navy-700/60 text-navy-300/60 border-navy-600/40'
                }`}
                style={{ borderWidth: '3px' }}
              >
                {done ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : active ? (
                  <span className="text-sm font-black">{i + 1}</span>
                ) : (
                  <span className="text-sm font-bold opacity-60">{i + 1}</span>
                )}
              </div>
              <span
                className={`text-xs font-bold whitespace-nowrap ${
                  done || active ? 'text-white' : 'text-navy-300/50'
                }`}
              >
                {step.label}
              </span>
            </div>
            {!isLast && (
              <div
                className={`flex-1 h-1.5 mx-2 rounded-full transition-all duration-500 ${
                  done ? 'bg-emerald-500' : 'bg-navy-700/40'
                }`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

interface Props {
  branding: CustomerBranding;
  order: CustomerOrderPreview;
}

export default function ActiveOrderScreen({ branding, order }: Props) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const isPaid = order.paymentStatus?.toUpperCase() === 'PAID';
  const isAwaitingPayment = order.paymentStatus?.toUpperCase() === 'AWAITING_PAYMENT';
  const orderTypeLabel = order.orderType === 'DINE_IN'
    ? 'Dine-in'
    : order.orderType === 'TAKEAWAY'
      ? 'Takeaway'
      : order.orderType === 'DELIVERY'
        ? 'Delivery'
        : order.orderType || 'Dine-in';

  return (
    <div className="absolute inset-0 w-full h-full overflow-hidden flex flex-col bg-slate-950 text-white">
      <header className="flex items-center justify-between px-10 py-5 bg-navy-900 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-amber-500 flex items-center justify-center shadow-lg">
            <span className="text-2xl font-black text-navy-900">
              {branding.name?.charAt(0) || 'P'}
            </span>
          </div>
          <div>
            <div className="text-xs uppercase tracking-widest text-navy-300/60 font-bold">
              {branding.branchName || 'Port Harcourt'}
            </div>
            <div className="text-xl font-black text-white tracking-tight">
              {branding.name || 'Prolific Tables'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {order.table && (
            <div className="px-5 py-2.5 rounded-2xl bg-navy-700/60 ring-1 ring-white/10">
              <span className="text-xs uppercase tracking-widest text-navy-300/70 font-bold">
                Table
              </span>
              <span className="ml-2 text-2xl font-black text-amber-400 tabular-nums">
                {order.table}
              </span>
            </div>
          )}

          <div className="px-5 py-2.5 rounded-2xl bg-white/10 ring-1 ring-white/15">
            <span className="text-xs uppercase tracking-widest text-white/60 font-bold">
              {orderTypeLabel}
            </span>
          </div>

          <div className="px-6 py-3 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg">
            <div className="text-[10px] uppercase tracking-widest text-navy-900/70 font-black text-center leading-none">
              Order
            </div>
            <div className="text-3xl font-black text-navy-900 tabular-nums leading-none mt-1">
              #{order.orderNumber}
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="px-12 pt-10 pb-6 shrink-0">
          <h2 className="text-4xl font-black tracking-tight">
            Hi {order.customerName || 'Guest'}! 👋
          </h2>
          <p className="text-lg text-white/60 font-medium mt-2">
            Here&apos;s your order summary — we&apos;re on it!
          </p>
        </div>

        <div className="flex-1 flex gap-8 px-12 pb-8 min-h-0 overflow-hidden">
          <div className="flex-1 rounded-3xl bg-white/5 ring-1 ring-white/10 flex flex-col min-h-0 overflow-hidden">
            <div className="px-8 py-5 border-b border-white/5 shrink-0">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-black">Your Order</h3>
                <span className="text-sm text-white/50 font-semibold">
                  {order.lines.reduce((s, l) => s + l.qty, 0)} items
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-8 py-4 space-y-2">
              {order.lines.map((line, i) => (
                <div
                  key={i}
                  className="p-5 rounded-2xl bg-white/[0.03] hover:bg-white/[0.06] transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4 flex-1 min-w-0">
                      <div className="h-11 w-11 rounded-xl bg-amber-500/15 flex items-center justify-center flex-shrink-0">
                        <span className="text-lg font-black text-amber-400 tabular-nums">
                          ×{line.qty}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-lg font-bold text-white leading-tight">
                          {line.name}
                        </div>
                        {line.modifiers?.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {line.modifiers.map((m, mi) => (
                              <span
                                key={mi}
                                className="px-2.5 py-1 rounded-lg bg-navy-700/50 text-navy-200/90 text-xs font-semibold"
                              >
                                + {m}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-xl font-black text-amber-300 tabular-nums">
                        {formatCentsToNgn(line.totalCents)}
                      </div>
                      {line.qty > 1 && (
                        <div className="text-xs text-white/40 font-medium mt-1 tabular-nums">
                          {formatCentsToNgn(line.unitPriceCents)} each
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {!isPaid ? (
              <div className="border-t border-white/5 shrink-0">
                <div className="px-8 py-6 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-white/60 font-semibold text-lg">Subtotal</span>
                    <span className="font-bold text-xl tabular-nums">
                      {formatCentsToNgn(order.subtotalCents)}
                    </span>
                  </div>
                  {order.discountCents > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-emerald-300 font-semibold text-lg">Discount</span>
                      <span className="font-bold text-xl text-emerald-300 tabular-nums">
                        −{formatCentsToNgn(order.discountCents)}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-white/60 font-semibold text-lg">Tax</span>
                    <span className="font-bold text-xl tabular-nums">
                      {formatCentsToNgn(order.taxCents)}
                    </span>
                  </div>
                  <div className="h-px bg-white/10 my-2" />
                  <div className="flex items-center justify-between">
                    <span className="text-2xl font-black text-white">Grand Total</span>
                    <span className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-500 tabular-nums">
                      {formatCentsToNgn(order.totalCents)}
                    </span>
                  </div>
                </div>

                {isAwaitingPayment && (
                  <div className="mx-8 mb-6 p-5 rounded-2xl bg-amber-500/15 ring-1 ring-amber-400/40 flex items-center gap-4">
                    <div className="h-14 w-14 rounded-2xl bg-amber-500/25 flex items-center justify-center flex-shrink-0">
                      <span className="text-3xl">💳</span>
                    </div>
                    <div>
                      <div className="text-xl font-black text-amber-300">
                        Awaiting payment at counter
                      </div>
                      <div className="text-sm text-amber-200/70 font-medium mt-1">
                        Please see our friendly cashier to settle your bill
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="shrink-0">
                <div className="mx-8 my-6 p-8 rounded-3xl bg-emerald-500/15 ring-2 ring-emerald-400/50 flex items-center gap-6">
                  <div className="h-20 w-20 rounded-3xl bg-emerald-500 flex items-center justify-center flex-shrink-0 shadow-lg">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-4xl font-black text-emerald-300">
                      Paid ✅ Thank you!
                    </div>
                    <div className="text-lg text-emerald-200/70 font-semibold mt-2">
                      Your order total of{' '}
                      <span className="font-black text-emerald-200">
                        {formatCentsToNgn(order.totalCents)}
                      </span>{' '}
                      has been received
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="w-80 shrink-0 flex flex-col gap-6">
            <div className="rounded-3xl bg-white/5 ring-1 ring-white/10 p-7">
              <h3 className="text-lg font-black mb-5 flex items-center gap-2">
                <span className="text-xl">📊</span> Order Status
              </h3>
              <StatusPillar orderStatus={order.orderStatus} />
            </div>

            <div className="rounded-3xl bg-gradient-to-br from-navy-800/80 to-navy-900/80 ring-1 ring-white/10 p-7 flex-1 flex flex-col">
              <div className="text-xs uppercase tracking-widest text-navy-300/60 font-bold mb-2">
                Receipt Ref
              </div>
              <div className="text-2xl font-black text-amber-400 font-mono mb-6">
                R-{order.orderNumber}-{now.getDate()}
                {String(now.getMonth() + 1).padStart(2, '0')}
              </div>

              <div className="mt-auto">
                <div className="text-xs uppercase tracking-widest text-navy-300/60 font-bold mb-3">
                  Need help?
                </div>
                <div className="text-white/70 font-semibold text-sm">
                  Wave at any of our staff — we&apos;re happy to help!
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="flex items-center justify-between px-10 py-4 border-t border-white/5 bg-navy-900/70 shrink-0">
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 ring-1 ring-emerald-400/30">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse-soft" />
            <span className="font-bold text-emerald-300 text-sm">
              📶 {branding.wifi || 'ProlificTables_Guest'}
            </span>
          </div>
        </div>
        <div className="text-xl font-mono font-bold text-white/70 tabular-nums">
          {now.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
          })}
        </div>
      </footer>
    </div>
  );
}
