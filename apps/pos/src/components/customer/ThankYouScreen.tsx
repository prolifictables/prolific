'use client';

import { useEffect, useState } from 'react';
import type { CustomerBranding, CustomerOrderPreview, CustomerBankDetails } from '../../vite-env';
import { formatCentsToNgn as formatMoney } from '../../lib/ui-helpers';
import { POWERED_BY_LABEL, APP_VERSION } from '../../lib/app-meta';

interface Props {
  branding: CustomerBranding;
  order?: CustomerOrderPreview;
  onAutoNavigate: () => void;
}

function BankDetailsBlock({ bank, caption = 'Bank details for transfers' }: { bank?: CustomerBankDetails; caption?: string }) {
  if (!bank) return null;
  const rows: { label: string; value?: string }[] = [
    { label: 'Bank', value: bank.bankName },
    { label: 'Account name', value: bank.accountName },
    { label: 'Account number', value: bank.accountNumber },
  ].filter((r) => typeof r.value === 'string' && r.value.trim().length > 0);
  if (rows.length === 0) return null;
  return (
    <div className="rounded-3xl bg-white shadow-2xl p-8 text-left">
      <div className="text-xs uppercase tracking-widest text-slate-400 font-black mb-3">
        {bank.caption || caption}
      </div>
      <div className="space-y-2.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-6">
            <div className="text-sm font-semibold text-slate-500">{r.label}</div>
            <div className="text-base font-black text-slate-900 tabular-nums tracking-tight">
              {r.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ThankYouScreen({ branding, order, onAutoNavigate }: Props) {
  const [fadingOut, setFadingOut] = useState(false);
  const [countdown, setCountdown] = useState(14);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(timer);
          setFadingOut(true);
          setTimeout(onAutoNavigate, 600);
          return 0;
        }
        return c - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [onAutoNavigate]);

  const lineItems = (order?.lines || []).filter((l) => l.qty > 0);
  const bank = order?.bankDetails || branding?.bankDetails;
  const totalQty = lineItems.reduce((s, l) => s + l.qty, 0);

  return (
    <div
      className={`absolute inset-0 w-full h-full overflow-hidden bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-700 flex items-center justify-center transition-opacity duration-700 ${
        fadingOut ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(255,255,255,0.15),_transparent_60%)]" />
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {Array.from({ length: 20 }).map((_, i) => (
          <div
            key={i}
            className="absolute text-5xl animate-pulse-soft"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 2}s`,
              opacity: 0.15,
            }}
          >
            {['✨', '🎉', '💫', '⭐', '🌟'][Math.floor(Math.random() * 5)]}
          </div>
        ))}
      </div>

      <div className="relative z-10 w-full max-w-5xl mx-6 my-8 flex flex-col gap-6 items-stretch">
        <div className="bg-white rounded-[2.5rem] shadow-2xl p-10 text-center animate-slide-up">
          <div className="flex justify-center mb-6">
            <div className="relative">
              <div className="absolute inset-0 bg-emerald-400 rounded-full blur-3xl opacity-40 animate-pulse-soft" />
              <div className="relative h-28 w-28 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-2xl ring-8 ring-emerald-100">
                <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
            </div>
          </div>

          <h1 className="text-black font-black tracking-tight mb-2" style={{ fontSize: '3.75rem', lineHeight: 1 }}>
            Thank You!
          </h1>

          <p className="text-xl text-slate-600 font-semibold mb-6">
            Your order is preparing — listen for your number!
          </p>

          {order && (
            <div className="rounded-3xl bg-slate-50 p-7 mb-6 text-left space-y-5">
              <div className="grid grid-cols-3 gap-5">
                <div>
                  <div className="text-xs uppercase tracking-widest text-slate-400 font-black mb-1.5">
                    Order Number
                  </div>
                  <div className="text-4xl font-black text-slate-900 tabular-nums">
                    #{order.orderNumber}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-widest text-slate-400 font-black mb-1.5">
                    Items
                  </div>
                  <div className="text-4xl font-black text-amber-600 tabular-nums">
                    {totalQty}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-widest text-slate-400 font-black mb-1.5">
                    {order.paymentMethodLabel ? 'Payment' : 'Status'}
                  </div>
                  <div className="text-xl font-black text-emerald-700 tabular-nums truncate">
                    {order.paymentMethodLabel || 'Paid'}
                  </div>
                </div>
              </div>

              {lineItems.length > 0 && (
                <>
                  <div className="h-px bg-slate-200" />
                  <div>
                    <div className="text-xs uppercase tracking-widest text-slate-400 font-black mb-2">
                      Items Ordered
                    </div>
                    <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                      {lineItems.map((l, i) => (
                        <div
                          key={`${String(order.orderNumber)}-${i}`}
                          className="flex items-start justify-between gap-3 py-2 px-3 rounded-2xl hover:bg-white"
                        >
                          <div className="flex items-start gap-3 min-w-0 flex-1">
                            <div className="h-9 w-9 rounded-xl bg-amber-500/15 flex items-center justify-center flex-shrink-0">
                              <span className="text-sm font-black text-amber-500 tabular-nums">
                                ×{l.qty}
                              </span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-bold text-slate-900 leading-tight break-words">
                                {l.name}
                              </div>
                              {Array.isArray(l.modifiers) && l.modifiers.length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {l.modifiers.map((m, mi) => (
                                    <span
                                      key={mi}
                                      className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 text-[11px] font-semibold"
                                    >
                                      + {m}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <div className="font-black text-slate-900 tabular-nums">
                              {formatMoney(l.totalCents)}
                            </div>
                            {l.qty > 1 && (
                              <div className="text-[11px] text-slate-500 tabular-nums mt-0.5">
                                {formatMoney(l.unitPriceCents)} each
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div className="h-px bg-slate-200" />

              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-widest text-slate-400 font-black mb-1">
                    Total Paid
                  </div>
                  <div className="text-3xl font-black text-emerald-600 tabular-nums">
                    {formatMoney(order.totalCents)}
                  </div>
                  {typeof order.tenderedCents === 'number' && order.tenderedCents > 0 && (
                    <div className="text-sm font-semibold text-slate-500 mt-1 tabular-nums">
                      Tendered {formatMoney(order.tenderedCents)}
                      {typeof order.changeDueCents === 'number' && order.changeDueCents > 0 && (
                        <> · Change {formatMoney(order.changeDueCents)}</>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3 px-5 py-3 rounded-2xl bg-emerald-50 ring-1 ring-emerald-200">
                  <span className="h-3 w-3 rounded-full bg-emerald-500 animate-pulse-soft" />
                  <span className="font-black text-emerald-700 text-lg">
                    {order.orderStatus === 'READY'
                      ? 'Ready to pick up!'
                      : order.orderStatus === 'PREPARING'
                        ? 'Cooking now...'
                        : order.orderStatus === 'SERVED'
                          ? 'Served'
                          : 'In kitchen'}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-center gap-3 px-5 py-4 rounded-3xl bg-slate-50">
            <div className="h-12 w-12 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
              <div className="relative">
                <span className="absolute inset-0 rounded-full bg-amber-400/30 animate-ping" />
                <span className="relative text-2xl">🔔</span>
              </div>
            </div>
            <div className="text-left">
              <div className="font-black text-slate-800 text-lg">
                We&apos;ll call your number when ready
              </div>
              <div className="text-sm text-slate-500 font-semibold">
                Returning to promotions in{' '}
                <span className="font-black text-amber-600 text-base tabular-nums">
                  {countdown}s
                </span>
              </div>
            </div>
          </div>

          <div className="mt-6 h-2 w-full rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 transition-all duration-1000 ease-linear rounded-full"
              style={{ width: `${((14 - countdown) / 14) * 100}%` }}
            />
          </div>
        </div>

        {(order?.table || branding?.branchName || bank) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-3xl bg-white/95 shadow-2xl p-8 text-left">
              <div className="flex items-start justify-between gap-6">
                <div>
                  <div className="text-xs uppercase tracking-widest text-slate-400 font-black mb-2">
                    Branch
                  </div>
                  <div className="text-xl font-black text-slate-800">
                    {branding.branchName || 'Port Harcourt'}
                  </div>
                  <div className="text-lg font-semibold text-slate-500 mt-0.5">
                    {branding.name || 'Prolific Tables'}
                  </div>
                </div>
                {order?.table && (
                  <div>
                    <div className="text-xs uppercase tracking-widest text-slate-400 font-black mb-1.5">
                      Table
                    </div>
                    <div className="text-3xl font-black text-amber-600 tabular-nums">
                      {order.table}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <BankDetailsBlock bank={bank} caption="Bank details — always available" />
          </div>
        )}
      </div>

      <div className="absolute bottom-0 inset-x-0 z-20 px-10 py-4 border-t border-white/10 bg-gradient-to-t from-black/30 to-transparent backdrop-blur-sm flex items-center justify-between gap-3 text-sm">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 ring-1 ring-inset ring-white/15">
          <span className="font-black text-emerald-200 tracking-[0.18em] uppercase text-xs">
            Prolific POS v{APP_VERSION}
          </span>
        </div>
        <div className="font-semibold text-white/90">
          {POWERED_BY_LABEL}
        </div>
      </div>
    </div>
  );
}
