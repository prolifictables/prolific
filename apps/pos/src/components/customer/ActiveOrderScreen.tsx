'use client';

import { useEffect, useState } from 'react';
import type { CustomerBranding, CustomerOrderPreview, CustomerBankDetails } from '../../vite-env';
import { formatCentsToNgn } from '../../lib/ui-helpers';
import { POWERED_BY_LABEL, APP_VERSION } from '../../lib/app-meta';

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
                className={`text-[10px] font-black tracking-wide leading-none text-center ${
                  done
                    ? 'text-emerald-300'
                    : active
                      ? 'text-white'
                      : 'text-navy-300/50'
                }`}
              >
                {step.label}
              </span>
            </div>
            {i < PILLAR_STEPS.length - 1 && (
              <div
                className={`w-full h-[3px] rounded-full ml-2 transition-colors ${
                  done ? 'bg-emerald-500/80' : 'bg-navy-700/50'
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

// Manager-editable bank details block — always rendered (strict rule).
function BankDetailsPanel({ bank }: { bank?: CustomerBankDetails }) {
  if (!bank) return null;
  const rows: { label: string; value?: string; mono?: boolean }[] = [
    { label: 'Bank', value: bank.bankName },
    { label: 'Account name', value: bank.accountName },
    { label: 'Account number', value: bank.accountNumber, mono: true },
  ].filter((r): r is { label: string; value: string; mono?: boolean } =>
    typeof (r as any).value === 'string' && (r as any).value.trim().length > 0
  );
  if (rows.length === 0) return null;
  return (
    <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 p-4 space-y-2">
      {bank.caption && (
        <div className="text-[11px] uppercase tracking-widest font-black text-amber-400/90 mb-1">
          {bank.caption}
        </div>
      )}
      <div className="text-[11px] uppercase tracking-widest text-navy-300/60 font-bold mb-2">
        Bank Account Details
      </div>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex justify-between items-center gap-3 p-2.5 rounded-xl bg-slate-950/40 ring-1 ring-inset ring-white/5 min-h-[2.5rem]"
          >
            <span className="text-[11px] text-navy-300/70 font-semibold shrink-0">
              {r.label}
            </span>
            <span
              className={
                'text-right text-[13px] font-black text-white min-w-0 max-w-[60%] truncate ' +
                (r.mono ? 'font-mono tabular-nums tracking-wider' : '')
              }
              title={r.value}
            >
              {r.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ActiveOrderScreen({ branding, order }: Props) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  const isPaid = (order.paymentStatus || '').toUpperCase() === 'PAID';
  const isAwaitingPayment = (order.paymentStatus || '').toUpperCase() === 'AWAITING_PAYMENT';
  const orderTypeLabel = order.orderType === 'DINE_IN'
    ? 'Dine-in'
    : order.orderType === 'TAKEAWAY'
      ? 'Takeaway'
      : order.orderType === 'DELIVERY'
        ? 'Delivery'
        : order.orderType || 'Dine-in';

  // -----------------------------------------------------------------------
  // Layout: CSS Grid with 3 rows (header / main / footer) and 2 columns
  // (left = orders list + totals; right = status pillar + bank details + help).
  // The grid algorithm assigns DEFINITE pixel heights to every grid track, so
  // nested `flex: 1` + `overflow-y-auto` inside grid cells always receives a
  // computed height. This avoids the "indefinite cross-axis stretched flex
  // child height → nested overflow collapses to 0px" that previously hid the
  // order list behind the Grand Total card (the exact failure mode reported
  // in the screenshot).
  // -----------------------------------------------------------------------
  return (
    <div
      className="absolute inset-0 w-full h-full grid gap-0 text-white overflow-hidden"
      style={{
        gridTemplateRows: 'auto 1fr auto',
        gridTemplateColumns: '1fr 330px',
        backgroundColor: '#020617',
      }}
    >
      {/* ============ ROW 1 — HEADER (spans both columns) ============ */}
      <header
        style={{ gridColumn: '1 / span 2' }}
        className="flex items-center justify-between px-8 py-4 bg-navy-900 border-b border-white/5"
      >
        <div className="flex items-center gap-4">
          <div className="h-10 w-10 rounded-2xl bg-amber-500 flex items-center justify-center shadow-lg">
            <span className="text-xl font-black text-navy-900">
              {branding.name?.charAt(0) || 'P'}
            </span>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-navy-300/60 font-bold">
              {branding.branchName || 'Port Harcourt'}
            </div>
            <div className="text-lg font-black text-white tracking-tight">
              {branding.name || 'Prolific Tables'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {order.table && (
            <div className="px-4 py-2 rounded-2xl bg-navy-700/60 ring-1 ring-white/10">
              <span className="text-[10px] uppercase tracking-widest text-navy-300/70 font-bold">
                Table
              </span>
              <span className="ml-2 text-xl font-black text-amber-400 tabular-nums">
                {order.table}
              </span>
            </div>
          )}

          <div className="px-4 py-2 rounded-2xl bg-white/10 ring-1 ring-white/15">
            <span className="text-[10px] uppercase tracking-widest text-white/60 font-bold">
              {orderTypeLabel}
            </span>
          </div>

          <div className="px-5 py-2.5 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg">
            <div className="text-[9px] uppercase tracking-widest text-navy-900/70 font-black text-center leading-none">
              Order
            </div>
            <div className="text-2xl font-black text-navy-900 tabular-nums leading-none mt-1">
              #{order.orderNumber}
            </div>
          </div>
        </div>
      </header>

      {/* ============ ROW 2, COL 1 — GREETING + ORDER LIST + TOTALS ============ */}
      <main
        style={{ gridColumn: '1 / 2', gridRow: '2 / 3', minHeight: 0 }}
        className="flex flex-col px-10 pt-5 pb-3 gap-3 overflow-hidden"
      >
        <div className="shrink-0">
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight leading-tight">
            Hi {order.customerName || 'Guest'}! 👋
          </h2>
          <p className="text-sm text-white/60 font-medium mt-1 leading-snug">
            Here&apos;s your order summary — we&apos;re on it!
          </p>
        </div>

        {/* Order list container: DEFINITE height via outer grid cell, so
            inner overflow-y-scroll is guaranteed to receive a real pixel
            height. Order lines are always visible to the customer. */}
        <div
          className="rounded-2xl bg-white/5 ring-1 ring-white/10 flex flex-col overflow-hidden"
          style={{ flex: '1 1 auto', minHeight: 0 }}
        >
          <div className="px-6 py-3 border-b border-white/5 shrink-0 flex items-center justify-between">
            <h3 className="text-[15px] font-black">Your Order</h3>
            <span className="text-xs text-white/50 font-semibold tabular-nums">
              {order.lines.reduce((s, l) => s + (Number(l.qty) || 0), 0)} items
            </span>
          </div>

          <div
            className="flex-1 min-h-0 overflow-y-auto px-5 py-2.5 space-y-1.5"
            style={{ scrollbarWidth: 'thin' }}
          >
            {order.lines.length === 0 ? (
              <div className="py-10 text-center">
                <div className="text-3xl mb-2">🧾</div>
                <div className="text-sm text-white/60 font-semibold">
                  No items yet — your cashier is adding them now.
                </div>
              </div>
            ) : (
              order.lines.map((line, i) => (
                <div
                  key={i}
                  className="p-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="h-9 w-9 rounded-lg bg-amber-500/15 flex items-center justify-center flex-shrink-0">
                        <span className="text-[13px] font-black text-amber-400 tabular-nums">
                          ×{line.qty}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-bold text-white leading-tight break-words">
                          {line.name}
                        </div>
                        {line.modifiers?.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {line.modifiers.map((m, mi) => (
                              <span
                                key={mi}
                                className="px-2 py-0.5 rounded-lg bg-navy-700/50 text-navy-200/90 text-[11px] font-semibold"
                              >
                                + {typeof m === 'string' ? m : (m as any).name || String(m)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-[15px] font-black text-amber-300 tabular-nums">
                        {formatCentsToNgn(Number(line.totalCents) || 0)}
                      </div>
                      {Number(line.qty) > 1 && (
                        <div className="text-[10px] text-white/40 font-medium mt-0.5 tabular-nums">
                          {formatCentsToNgn(Number(line.unitPriceCents) || 0)} each
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Grand totals (shrink-0, always pinned below the scrollable list) */}
          {!isPaid ? (
            <div className="border-t border-white/5 shrink-0">
              <div className="px-6 py-3.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-white/60 font-semibold text-[13px]">Subtotal</span>
                  <span className="font-bold text-[15px] tabular-nums">
                    {formatCentsToNgn(Number(order.subtotalCents) || 0)}
                  </span>
                </div>
                {(Number(order.discountCents) || 0) > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-emerald-300 font-semibold text-[13px]">Discount</span>
                    <span className="font-bold text-[15px] text-emerald-300 tabular-nums">
                      −{formatCentsToNgn(Number(order.discountCents) || 0)}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-white/60 font-semibold text-[13px]">Tax</span>
                  <span className="font-bold text-[15px] tabular-nums">
                    {formatCentsToNgn(Number(order.taxCents) || 0)}
                  </span>
                </div>
                <div className="h-px bg-white/10 my-1" />
                <div className="flex items-center justify-between">
                  <span className="text-[18px] font-black text-white">Grand Total</span>
                  <span className="text-[34px] font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-500 tabular-nums leading-none">
                    {formatCentsToNgn(Number(order.totalCents) || 0)}
                  </span>
                </div>
              </div>

              {isAwaitingPayment && (
                <div className="mx-5 mb-3 p-3.5 rounded-xl bg-amber-500/15 ring-1 ring-amber-400/40 flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-amber-500/25 flex items-center justify-center flex-shrink-0">
                    <span className="text-xl">💳</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-black text-amber-300 leading-snug">
                      Awaiting payment at counter
                    </div>
                    <div className="text-[11px] text-amber-200/70 font-medium mt-0.5 leading-snug">
                      Please see our friendly cashier to settle your bill
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="shrink-0">
              <div className="mx-5 my-3 p-4 rounded-xl bg-emerald-500/15 ring-2 ring-emerald-400/50 flex items-center gap-4">
                <div className="h-14 w-14 rounded-2xl bg-emerald-500 flex items-center justify-center flex-shrink-0 shadow-lg">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[20px] font-black text-emerald-300 leading-tight">
                    Paid ✅ Thank you!
                  </div>
                  <div className="text-[13px] text-emerald-200/70 font-semibold mt-1 leading-snug">
                    Your order total of{' '}
                    <span className="font-black text-emerald-200">
                      {formatCentsToNgn(Number(order.totalCents) || 0)}
                    </span>{' '}
                    has been received
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ============ ROW 2, COL 2 — STATUS PILLAR + BANK DETAILS (scrollable) ============ */}
      <aside
        style={{ gridColumn: '2 / 3', gridRow: '2 / 3', minHeight: 0 }}
        className="flex flex-col px-4 pt-5 pb-3 pr-8 gap-3 overflow-hidden"
      >
        <div className="rounded-2xl bg-white/5 ring-1 ring-white/10 p-4 shrink-0">
          <h3 className="text-[14px] font-black mb-3 flex items-center gap-2">
            <span className="text-lg">📊</span> Order Status
          </h3>
          <StatusPillar orderStatus={order.orderStatus} />
        </div>

        <div
          className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1"
          style={{ scrollbarWidth: 'thin' }}
        >
          <div className="rounded-2xl bg-gradient-to-br from-navy-800/80 to-navy-900/80 ring-1 ring-white/10 p-4 flex flex-col gap-3 shrink-0">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-navy-300/60 font-bold mb-1.5">
                Receipt Ref
              </div>
              <div className="text-[17px] font-black text-amber-400 font-mono">
                R-{order.orderNumber}-{now.getDate()}
                {String(now.getMonth() + 1).padStart(2, '0')}
              </div>
            </div>

            {/* Strict rule: bank details ALWAYS rendered (visible no matter the
                payment method selected by the cashier). */}
            <BankDetailsPanel bank={order.bankDetails || (branding as any).bankDetails} />

            <div>
              <div className="text-[10px] uppercase tracking-widest text-navy-300/60 font-bold mb-1.5">
                Need help?
              </div>
              <div className="text-white/70 font-semibold text-[12px] leading-snug">
                Wave at any of our staff — we&apos;re happy to help!
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* ============ ROW 3 — FOOTER (spans both columns) ============ */}
      <footer
        style={{ gridColumn: '1 / span 2' }}
        className="flex items-center justify-between px-8 py-2.5 border-t border-white/5 bg-navy-900/70"
      >
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 ring-1 ring-emerald-400/30">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse-soft" />
            <span className="font-bold text-emerald-300 text-[11px]">
              📶 {branding.wifi || 'ProlificTables_Guest'}
            </span>
          </div>
        </div>
        <div className="text-right">
          <div className="font-black text-white/90 tracking-wide text-[11px]">
            {POWERED_BY_LABEL}
          </div>
          <div className="text-[10px] text-navy-300/70 font-semibold mt-0.5 tabular-nums">
            Prolific POS v{APP_VERSION}
          </div>
        </div>
      </footer>
    </div>
  );
}
