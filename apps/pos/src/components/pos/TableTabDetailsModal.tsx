import React, { useEffect, useMemo, useState } from 'react';
import { formatCentsToNgn } from '../../lib/ui-helpers';

/** Visual tint for a single ledger entry, chosen by the entry_type so the
 *  timeline is scannable at a glance (matches Toast/Square tab views). */
const LEDGER_TINTS: Record<string, { icon: string; text: string; ring: string; bg: string }> = {
  OPENED: { icon: '🟢', text: 'text-emerald-300', ring: 'ring-emerald-500/30', bg: 'bg-emerald-500/10' },
  ADD_ITEM: { icon: '➕', text: 'text-emerald-200', ring: 'ring-emerald-400/30', bg: 'bg-emerald-500/5' },
  EDIT_QTY: { icon: '✏️', text: 'text-sky-300', ring: 'ring-sky-500/30', bg: 'bg-sky-500/10' },
  VOID_ITEM: { icon: '🗑️', text: 'text-rose-300', ring: 'ring-rose-500/30', bg: 'bg-rose-500/10' },
  NOTE: { icon: '📝', text: 'text-slate-200', ring: 'ring-slate-400/30', bg: 'bg-slate-500/10' },
  DISCOUNT: { icon: '🏷️', text: 'text-amber-300', ring: 'ring-amber-500/30', bg: 'bg-amber-500/10' },
  TIP: { icon: '💵', text: 'text-amber-200', ring: 'ring-amber-400/30', bg: 'bg-amber-500/5' },
  PAYMENT: { icon: '💳', text: 'text-emerald-300', ring: 'ring-emerald-500/40', bg: 'bg-emerald-500/10' },
  AWAITING_PAYMENT: { icon: '⏳', text: 'text-amber-300', ring: 'ring-amber-500/30', bg: 'bg-amber-500/10' },
  CLOSED: { icon: '✅', text: 'text-slate-300', ring: 'ring-slate-400/30', bg: 'bg-slate-500/10' },
  VOIDED: { icon: '⛔', text: 'text-rose-300', ring: 'ring-rose-500/30', bg: 'bg-rose-500/10' },
  COVERS_UPDATED: { icon: '👥', text: 'text-violet-300', ring: 'ring-violet-500/30', bg: 'bg-violet-500/10' },
  SERVER_CHANGED: { icon: '👨‍🍳', text: 'text-cyan-300', ring: 'ring-cyan-500/30', bg: 'bg-cyan-500/10' },
  TRANSFER_IN: { icon: '⬅️', text: 'text-emerald-300', ring: 'ring-emerald-500/30', bg: 'bg-emerald-500/10' },
  TRANSFER_OUT: { icon: '➡️', text: 'text-rose-300', ring: 'ring-rose-500/30', bg: 'bg-rose-500/10' },
};

interface Props {
  open: boolean;
  onClose: () => void;
  tableId?: string;
  tableName?: string;
  sessionId?: string;
}

type SessionShape = {
  id: string;
  tabNumber?: string;
  status?: string;
  covers?: number;
  openedByName?: string;
  serverName?: string;
  openedAt?: number;
  subtotalCents?: number;
  discountCents?: number;
  taxCents?: number;
  tipCents?: number;
  totalCents?: number;
  paidAmountCents?: number;
  balanceDueCents?: number;
  note?: string | null;
  currentOrderId?: string | null;
};

type LedgerEntryShape = {
  id?: number;
  entryType: string;
  label?: string | null;
  quantity?: number;
  amountDeltaCents?: number;
  amountAfterCents?: number;
  note?: string | null;
  actorName?: string | null;
  createdAt?: number;
  referenceId?: string | null;
};

const DEFAULT_SESSION: SessionShape = { id: '', status: 'OPEN' };

export default function TableTabDetailsModal({
  open,
  onClose,
  tableId,
  tableName,
  sessionId,
}: Props) {
  const [session, setSession] = useState<SessionShape>(DEFAULT_SESSION);
  const [orderItems, setOrderItems] = useState<any[]>([]);
  const [ledger, setLedger] = useState<LedgerEntryShape[]>([]);
  const [loading, setLoading] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const api = useMemo(() => {
    const a = (window as any).electronAPI;
    if (!a?.db) return null;
    return a as typeof window.electronAPI;
  }, []);

  useEffect(() => {
    if (!open || !sessionId || !api) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [sess, entries] = await Promise.all([
          api.db.tableSessions.getById(sessionId) as Promise<any>,
          api.db.tableSessionLedger.listForSession(sessionId) as Promise<any[]>,
        ]);
        if (cancelled) return;
        if (sess) {
          setSession({
            id: sess.id,
            tabNumber: sess.tabNumber ?? sess.tab_number ?? undefined,
            status: sess.status ?? undefined,
            covers: Number(sess.covers ?? 0),
            openedByName: sess.openedByName ?? sess.opened_by_name ?? undefined,
            serverName: sess.serverName ?? sess.server_name ?? undefined,
            openedAt: Number(sess.openedAt ?? sess.opened_at ?? 0) || undefined,
            subtotalCents: Number(sess.subtotalCents ?? sess.subtotal_cents ?? 0),
            discountCents: Number(sess.discountCents ?? sess.discount_cents ?? 0),
            taxCents: Number(sess.taxCents ?? sess.tax_cents ?? 0),
            tipCents: Number(sess.tipCents ?? sess.tip_cents ?? 0),
            totalCents: Number(sess.totalCents ?? sess.total_cents ?? 0),
            paidAmountCents: Number(sess.paidAmountCents ?? sess.paid_amount_cents ?? 0),
            balanceDueCents: Number(sess.balanceDueCents ?? sess.balance_due_cents ?? 0),
            note: sess.note ?? null,
            currentOrderId: sess.currentOrderId ?? sess.current_order_id ?? null,
          });
          const orderId = sess.currentOrderId ?? sess.current_order_id;
          if (orderId && api.db.orderItems?.listForOrderId) {
            const items = (await api.db.orderItems.listForOrderId(orderId)) as any[];
            setOrderItems(items);
          }
        }
        setLedger(
          entries.map((e) => ({
            id: e.id,
            entryType: e.entryType ?? e.entry_type ?? 'NOTE',
            label: e.label ?? null,
            quantity: Number(e.quantity ?? 0),
            amountDeltaCents: Number(e.amountDeltaCents ?? e.amount_delta_cents ?? 0),
            amountAfterCents: Number(e.amountAfterCents ?? e.amount_after_cents ?? 0),
            note: e.note ?? null,
            actorName: e.actorName ?? e.actor_name ?? null,
            createdAt: Number(e.createdAt ?? e.created_at ?? 0) || Date.now(),
            referenceId: e.referenceId ?? e.reference_id ?? null,
          }))
        );
      } catch (err) {
        console.error('[TableTabDetails] load failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, sessionId, api]);

  const onAddNote = async () => {
    if (!noteText.trim() || !api || !session.id) return;
    setSavingNote(true);
    try {
      await api.db.tableSessionLedger.appendNote({
        sessionId: session.id,
        note: noteText.trim(),
      });
      setNoteText('');
      // Refresh
      const entries = (await api.db.tableSessionLedger.listForSession(session.id)) as any[];
      setLedger(
        entries.map((e) => ({
          id: e.id,
          entryType: e.entryType ?? e.entry_type ?? 'NOTE',
          label: e.label ?? null,
          quantity: Number(e.quantity ?? 0),
          amountDeltaCents: Number(e.amountDeltaCents ?? e.amount_delta_cents ?? 0),
          amountAfterCents: Number(e.amountAfterCents ?? e.amount_after_cents ?? 0),
          note: e.note ?? null,
          actorName: e.actorName ?? e.actor_name ?? null,
          createdAt: Number(e.createdAt ?? e.created_at ?? 0) || Date.now(),
          referenceId: e.referenceId ?? e.reference_id ?? null,
        }))
      );
    } finally {
      setSavingNote(false);
    }
  };

  if (!open) return null;

  const statusPill = (() => {
    switch (session.status) {
      case 'OPEN':
        return { text: 'OPEN', cls: 'bg-emerald-500/20 text-emerald-300 ring-emerald-500/30' };
      case 'AWAITING_PAYMENT':
        return { text: 'AWAITING PAYMENT', cls: 'bg-amber-500/20 text-amber-200 ring-amber-500/30' };
      case 'PARTIALLY_PAID':
        return { text: 'PARTIALLY PAID', cls: 'bg-sky-500/20 text-sky-200 ring-sky-500/30' };
      case 'PAID':
        return { text: 'PAID', cls: 'bg-emerald-600/30 text-emerald-100 ring-emerald-500/40' };
      case 'CLOSED':
        return { text: 'CLOSED', cls: 'bg-slate-500/20 text-slate-200 ring-slate-400/30' };
      case 'VOIDED':
        return { text: 'VOIDED', cls: 'bg-rose-500/20 text-rose-200 ring-rose-500/30' };
      default:
        return { text: String(session.status || '—'), cls: 'bg-slate-500/20 text-slate-200 ring-slate-400/30' };
    }
  })();

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-4xl max-h-[90vh] rounded-3xl bg-gradient-card ring-1 ring-white/5 shadow-2xl card-neon overflow-hidden flex flex-col">
        {/* HEADER */}
        <div className="px-5 py-4 border-b border-white/5 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-2xl bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/30 flex items-center justify-center text-2xl shadow-glow-restaurant">
              🪑
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold text-white tracking-tight">
                  {tableName || 'Table details'}
                </h2>
                <span className={`chip !py-0.5 !px-2.5 text-[10px] font-extrabold tracking-[0.18em] ring-1 ring-inset ${statusPill.cls}`}>
                  {statusPill.text}
                </span>
                {session.tabNumber && (
                  <span className="chip !bg-slate-800/70 !text-slate-200 !ring-white/10 !py-0.5 !px-2.5 text-[10px] font-bold">
                    TAB {session.tabNumber}
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs text-slate-400 flex flex-wrap gap-x-4 gap-y-1">
                {session.openedAt && (
                  <span>
                    Opened {new Date(session.openedAt).toLocaleString()}
                  </span>
                )}
                {session.openedByName && <span>by {session.openedByName}</span>}
                {session.serverName && session.serverName !== session.openedByName && (
                  <span>• Server: <span className="text-slate-200">{session.serverName}</span></span>
                )}
                {typeof session.covers === 'number' && session.covers > 0 && (
                  <span>• {session.covers} covers</span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-9 w-9 rounded-xl bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white ring-1 ring-inset ring-white/10 flex items-center justify-center active:scale-[0.97]"
            aria-label="Close table tab details"
          >
            ✕
          </button>
        </div>

        {/* BODY: Items + Ledger */}
        <div className="grid md:grid-cols-2 gap-0 overflow-hidden divide-y md:divide-y-0 md:divide-x divide-white/5">
          {/* LEFT: Items */}
          <div className="flex flex-col min-h-0">
            <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white uppercase tracking-[0.16em]">
                Items on tab
              </h3>
              <span className="text-xs text-slate-400">
                {orderItems.length} line{orderItems.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="p-4 overflow-y-auto flex-1 space-y-2">
              {loading ? (
                <div className="text-slate-400 text-sm text-center py-8">Loading…</div>
              ) : orderItems.length === 0 ? (
                <div className="text-center py-10">
                  <div className="h-16 w-16 mx-auto rounded-2xl bg-slate-800/40 flex items-center justify-center text-3xl ring-1 ring-inset ring-white/5">
                    🍽️
                  </div>
                  <p className="mt-3 text-slate-300 font-semibold">No items yet</p>
                  <p className="text-slate-500 text-sm mt-1 max-w-[18rem] mx-auto">
                    Menu items added to this table will appear here as running transactions the moment they're placed.
                  </p>
                </div>
              ) : (
                orderItems.map((it: any) => {
                  const qty = Number(it.quantity ?? it.qty ?? 0);
                  const unit = Number(it.price_snapshot_cents ?? it.priceSnapshotCents ?? 0);
                  const sub = Number(it.subtotal_cents ?? it.subtotalCents ?? 0);
                  return (
                    <div
                      key={String(it.id ?? `${it.name_snapshot}-${Math.random()}`)}
                      className="rounded-2xl p-3 bg-slate-900/40 ring-1 ring-inset ring-white/5 flex items-start justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="chip !bg-emerald-500/10 !text-emerald-300 !ring-emerald-500/20 !text-[11px] !font-bold tabular-nums">
                            ×{qty}
                          </span>
                          <span className="font-semibold text-white text-sm truncate">
                            {it.name_snapshot || it.name || 'Item'}
                          </span>
                        </div>
                        {it.special_instructions && (
                          <div className="mt-1 text-[11px] text-slate-400 leading-snug line-clamp-2">
                            📝 {it.special_instructions}
                          </div>
                        )}
                        {typeof it.preparation_status === 'string' && it.preparation_status && (
                          <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-sky-300">
                            {it.preparation_status}
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs text-slate-400 tabular-nums">
                          {unit > 0 ? formatCentsToNgn(unit) : '—'}
                        </div>
                        <div className="text-emerald-400 font-bold tabular-nums">
                          {formatCentsToNgn(sub)}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}

              {/* Totals block */}
              <div className="rounded-2xl p-4 ring-1 ring-inset ring-white/5 bg-slate-950/40 mt-2">
                <TotalsRow label="Subtotal" value={Number(session.subtotalCents ?? 0)} />
                {(session.discountCents ?? 0) > 0 && (
                  <TotalsRow label="Discount" value={-Number(session.discountCents ?? 0)} negative />
                )}
                <TotalsRow label="Tax" value={Number(session.taxCents ?? 0)} />
                {(session.tipCents ?? 0) > 0 && (
                  <TotalsRow label="Tip" value={Number(session.tipCents ?? 0)} />
                )}
                <div className="my-2 h-px bg-white/5" />
                <TotalsRow label="Grand Total" value={Number(session.totalCents ?? 0)} bold />
                {(session.paidAmountCents ?? 0) > 0 && (
                  <TotalsRow
                    label="Paid"
                    value={-Number(session.paidAmountCents ?? 0)}
                    negative
                  />
                )}
                <div className="pt-2 flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-200">Balance Due</span>
                  <span className="text-lg font-extrabold text-amber-300 tabular-nums">
                    {formatCentsToNgn(Number(session.balanceDueCents ?? 0))}
                  </span>
                </div>
                {session.note && (
                  <div className="mt-3 pt-3 border-t border-white/5 text-xs text-slate-400">
                    📝 {session.note}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT: Ledger */}
          <div className="flex flex-col min-h-0">
            <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white uppercase tracking-[0.16em]">
                Transaction Log
              </h3>
              <span className="text-xs text-slate-400 tabular-nums">
                {ledger.length} entr{ledger.length === 1 ? 'y' : 'ies'}
              </span>
            </div>

            <div className="px-4 py-3 border-b border-white/5 flex gap-2">
              <input
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add a staff note (optional reason, status, etc.)"
                className="flex-1 min-h-[2.5rem] rounded-xl bg-slate-900/60 px-3 text-sm text-slate-100 ring-1 ring-inset ring-white/10 placeholder:text-slate-500 outline-none focus:ring-amber-500/30 focus:bg-slate-900/80 transition-colors"
              />
              <button
                onClick={onAddNote}
                disabled={!noteText.trim() || savingNote}
                className="px-4 rounded-xl bg-amber-500/20 text-amber-200 ring-1 ring-inset ring-amber-500/30 hover:bg-amber-500/30 text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.97] transition-all"
              >
                {savingNote ? 'Saving…' : 'Save Note'}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
              {loading && ledger.length === 0 ? (
                <div className="text-slate-400 text-sm text-center py-8">Loading…</div>
              ) : ledger.length === 0 ? (
                <div className="text-center py-10 text-slate-500 text-sm">
                  No activity yet. Menu additions, voids, notes & payments appear here automatically.
                </div>
              ) : (
                <ol className="relative border-l-2 border-white/5 ml-3 space-y-4">
                  {ledger.map((e) => {
                    const tint = LEDGER_TINTS[e.entryType] || LEDGER_TINTS.NOTE;
                    return (
                      <li key={`${e.id ?? `${e.createdAt}-${e.label}`}`} className="relative pl-5">
                        <span
                          className={`absolute -left-[9px] top-0 h-4 w-4 rounded-full ring-2 ring-slate-950 flex items-center justify-center text-[10px] ${tint.ring} ${tint.bg}`}
                          title={e.entryType}
                        >
                          <span className="translate-y-[1px]">{tint.icon}</span>
                        </span>
                        <div
                          className={`rounded-xl p-3 ring-1 ring-inset ${tint.ring} ${tint.bg}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`text-xs font-bold uppercase tracking-[0.14em] ${tint.text}`}>
                                  {e.entryType.replace('_', ' ')}
                                </span>
                                <span className="text-xs text-slate-400 tabular-nums">
                                  {new Date(e.createdAt!).toLocaleString()}
                                </span>
                              </div>
                              <div className="mt-0.5 font-semibold text-sm text-slate-100 break-words">
                                {e.label || '—'}
                              </div>
                              {e.note && (
                                <div className="mt-1 text-[11px] text-slate-300/90 leading-snug">
                                  {e.note}
                                </div>
                              )}
                              {e.actorName && (
                                <div className="mt-1 text-[11px] text-slate-400">
                                  — {String(e.actorName)}
                                </div>
                              )}
                            </div>
                            <div className="text-right shrink-0">
                              {e.amountDeltaCents !== 0 && (
                                <div
                                  className={`text-sm font-semibold tabular-nums ${
                                    (e.amountDeltaCents ?? 0) > 0
                                      ? 'text-emerald-300'
                                      : 'text-rose-300'
                                  }`}
                                >
                                  {(e.amountDeltaCents ?? 0) > 0 ? '+' : ''}
                                  {formatCentsToNgn(e.amountDeltaCents ?? 0)}
                                </div>
                              )}
                              <div className="text-[11px] text-slate-400 tabular-nums mt-0.5">
                                Balance {formatCentsToNgn(e.amountAfterCents ?? 0)}
                              </div>
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>
        </div>

        {/* FOOTER */}
        <div className="px-5 py-3 border-t border-white/5 bg-slate-950/40 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-400">
            Data is stored locally on device and queued for next cloud sync.
            {tableId && (
              <>
                {' '}• Table ID <code className="text-slate-300">{tableId}</code>
              </>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-5 h-10 rounded-xl bg-emerald-600/80 hover:bg-emerald-600 text-white text-sm font-bold ring-1 ring-inset ring-emerald-400/30 shadow-emerald-500/20 active:scale-[0.98] transition-all"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function TotalsRow({
  label,
  value,
  bold,
  negative,
}: {
  label: string;
  value: number;
  bold?: boolean;
  negative?: boolean;
}) {
  const text =
    (negative && value > 0 ? -Math.abs(value) : negative ? value : value) || value;
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className={bold ? 'text-sm font-semibold text-slate-100' : 'text-sm text-slate-300'}>
        {label}
      </span>
      <span
        className={`tabular-nums ${
          bold ? 'font-bold text-white' : 'text-slate-200'
        } ${negative ? (text < 0 ? 'text-amber-300' : '') : ''}`}
      >
        {formatCentsToNgn(Math.abs(text))}
      </span>
    </div>
  );
}
