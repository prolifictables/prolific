'use client';

import { useEffect, useRef, useState } from 'react';
import { useCartStore } from '../../lib/cart-store';
import { useAuthStore } from '../../lib/auth-store';
import { formatCentsToNgn } from '../../lib/ui-helpers';
import TablePickerModal from './TablePickerModal';
import PaymentModal from './PaymentModal';
import TableTabDetailsModal from './TableTabDetailsModal';

type OrderType = 'DINE_IN' | 'TAKEOUT' | 'PICKUP' | 'DELIVERY';

const ORDER_TYPES: { id: OrderType; label: string; icon: string }[] = [
  { id: 'DINE_IN', label: 'Dine-in', icon: '🪑' },
  { id: 'TAKEOUT', label: 'Takeaway', icon: '🥡' },
  { id: 'PICKUP', label: 'Pickup', icon: '🛍️' },
  { id: 'DELIVERY', label: 'Delivery', icon: '🛵' },
];

export default function CartPanel() {
  const {
    lines,
    orderType,
    tableId,
    tableName,
    tableSession,
    customer,
    discountId,
    discountAmountCents,
    note,
  } = useCartStore();
  const cartActions = useCartStore((s) => s.actions);
  const { employee, branch, restaurant } = useAuthStore();

  const [taxes, setTaxes] = useState<any[]>([]);
  const [modifierMap, setModifierMap] = useState<Record<string, Record<string, string>>>({});
  const [showTablePicker, setShowTablePicker] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showTabDetails, setShowTabDetails] = useState(false);
  const [noteDraft, setNoteDraft] = useState(note || '');
  const [toast, setToast] = useState<string | null>(null);
  const orderNumberRef = useRef<string>('');

  // Load active tax definitions for totals calculation
  useEffect(() => {
    let alive = true;
    window.electronAPI?.db?.taxes
      ?.listActiveDefaults()
      .then((r: any) => {
        if (alive) setTaxes(Array.isArray(r) ? r : (r?.data as any[]) || []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Build a map of modifierId -> { optionId -> optionName } so cart lines can show
  // friendly modifier labels instead of "· option" placeholders.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!window.electronAPI?.db?.menuModifiers?.listAll) return;
        const res = await window.electronAPI.db.menuModifiers.listAll();
        const list: any[] = Array.isArray(res) ? res : ((res as any)?.data as any[]) || [];
        if (!alive) return;
        const map: Record<string, Record<string, string>> = {};
        for (const m of list) {
          const inner: Record<string, string> = {};
          for (const opt of m.options || []) {
            inner[opt.id] = opt.name;
          }
          map[m.id] = inner;
        }
        setModifierMap(map);
      } catch (e) {
        console.warn('[cart] modifiers load failed', e);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    setNoteDraft(note || '');
  }, [note]);

  const totals = cartActions.getTotals(taxes);
  const { subtotal, discount, tax, total } = totals;

  const lineCount = lines.reduce((s, l) => s + l.quantity, 0);

  useEffect(() => {
    if (!window.electronAPI?.customerDisplay) return;

    if (lines.length === 0) {
      orderNumberRef.current = '';
      window.electronAPI.customerDisplay.showIdle().catch(() => {});
      return;
    }

    if (!orderNumberRef.current) {
      orderNumberRef.current =
        '#' + (10000 + Math.floor(Math.random() * 90000)).toString();
    }

    const normalizedOrderType = orderType === 'TAKEOUT' ? 'TAKEAWAY' : orderType;
    const customerName = customer?.firstName
      ? `${customer.firstName} ${customer.lastName || ''}`.trim()
      : undefined;

    // Resolve bank details offline first: stored in SQLite settings
    // `bank_details:<branchId>` (manager editable via Admin portal → synced via
    // /public/customer-display-settings poller every 30s, and written locally
    // as soon as it's received so the POS always has a cached copy for the
    // customer display popup even if the server becomes unreachable mid-shift).
    let cancelPreview = false;
    const buildAndEmit = async () => {
      let cachedBank: any = null;
      try {
        if (branch?.id && window.electronAPI?.db?.settings?.get) {
          const key = `bank_details:${branch.id}`;
          cachedBank = (await window.electronAPI.db.settings.get(key, 'BRANCH')) || null;
        }
      } catch (_bankErr) {
        cachedBank = null;
      }

      if (cancelPreview) return;

      // Build preview lines with proper modifier resolution (no more undefined
      // modifierMap symbol). Uses the same safe pattern as PaymentModal.tsx
      // confirm-flow preview builder: per-line fetch menuModifiers.listForItemId
      // so the ActiveOrder live cart shows modifier pill names correctly, and
      // a DB read failure only drops modifiers for that one line (never aborts
      // the entire preview emit).
      const previewLines: any[] = [];
      for (const l of lines) {
        let modDisplayNames: string[] = [];
        if (l.modifiers && l.modifiers.length) {
          try {
            const fetchedMods = window.electronAPI?.db?.menuModifiers?.listForItemId
              ? await window.electronAPI.db.menuModifiers.listForItemId(l.menuItem.id)
              : [];
            const itemModDefs = Array.isArray(fetchedMods) ? fetchedMods : [];
            for (const sel of l.modifiers) {
              const modDef = itemModDefs.find((m: any) => String(m.id) === String(sel.modifierId));
              const optionNameById = new Map<string, string>();
              for (const opt of modDef?.options ?? []) {
                optionNameById.set(String(opt.id), opt.name || opt.label || String(opt.id));
              }
              for (const oid of sel.optionIds ?? []) {
                const displayName = optionNameById.get(String(oid)) || String(oid);
                modDisplayNames.push(displayName);
              }
            }
          } catch {
            // Swallow DB modifier read errors — the line still renders, just
            // without modifier pill names (this mirrors PaymentModal behavior).
          }
        }
        previewLines.push({
          qty: l.quantity,
          name: l.menuItem?.name ?? 'Item',
          modifiers: modDisplayNames,
          unitPriceCents: l.perUnitPriceCents,
          totalCents: l.subtotalCents,
        });
      }

      const preview = {
        orderNumber: orderNumberRef.current,
        table: tableName || undefined,
        orderType: normalizedOrderType,
        customerName,
        lines: previewLines,
        subtotalCents: subtotal,
        discountCents: discount,
        taxCents: tax,
        totalCents: total,
        paymentStatus: 'AWAITING_PAYMENT',
        // Inject bank details so the ActiveOrder sidebar ALWAYS shows them,
        // even for cash or card-terminal payment methods.
        bankDetails: cachedBank || undefined,
      };

      window.electronAPI?.customerDisplay?.showOrder?.(preview).catch(() => {});
    };

    const t = setTimeout(() => {
      buildAndEmit();
    }, 120);

    return () => {
      cancelPreview = true;
      clearTimeout(t);
    };
  }, [branch, customer, discount, lines, orderType, subtotal, tableName, tax, total]);

  const handleHold = async () => {
    if (lines.length === 0) return;
    try {
      const now = Date.now();
      const orderId =
        (crypto.randomUUID && crypto.randomUUID()) || `ord_${now}_${Math.random()}`;
      const orderNumber = '#' + (10000 + Math.floor(Math.random() * 90000)).toString();
      const normalizedOrderType = orderType === 'TAKEOUT' ? 'TAKEAWAY' : orderType;

      const orderRow: any = {
        id: orderId,
        branch_id: branch?.id ?? null,
        restaurant_id: restaurant?.id ?? null,
        order_number: orderNumber,
        source: 'POS',
        order_type: normalizedOrderType,
        table_id: tableId ?? null,
        table_session_id: null,
        customer_id: null,
        customer_name: tableName ?? null,
        employee_id: employee?.id ?? null,
        // Denormalized cashier name snapshot so held → later-paid receipts
        // print "Cashier: …" in header even after original creator logs out.
        cashier_name:
          (employee?.name && String(employee.name).trim()) ||
          (employee?.firstName || employee?.lastName
            ? `${String(employee.firstName || '')} ${String(employee.lastName || '')}`.trim()
            : null),
        employee_name:
          (employee?.name && String(employee.name).trim()) ||
          (employee?.firstName || employee?.lastName
            ? `${String(employee.firstName || '')} ${String(employee.lastName || '')}`.trim()
            : null),
        held_by: employee?.id ?? null,
        held_at: now,
        status: 'ON_HOLD',
        payment_status: 'UNPAID',
        subtotal_cents: totals.subtotal,
        discount_cents: totals.discount,
        tax_cents: totals.tax,
        total_cents: totals.total,
        tip_cents: totals.tip,
        change_due_cents: totals.changeDue,
        discount_id: discountId ?? null,
        note: noteDraft ? noteDraft : null,
        split_group_id: null,
        idempotency_key: orderId,
        synced: 0,
        created_at: now,
        updated_at: now,
      };

      await window.electronAPI?.db?.orders?.create(orderRow);
      for (const l of lines) {
        await window.electronAPI?.db?.orders?.addItem?.(orderId, {
          id: l.lineId,
          menu_item_id: l.menuItem.id,
          name_snapshot: l.menuItem.name,
          price_snapshot_cents: l.perUnitPriceCents,
          quantity: l.quantity,
          subtotal_cents: l.subtotalCents,
          tax_cents: 0,
          discount_cents: 0,
          total_cents: l.subtotalCents,
          special_instructions: l.notes ? String(l.notes) : null,
          preparation_status: 'NEW',
        });
      }

      if (window.electronAPI?.db?.syncQueue?.push) {
        const taxIds = taxes.map((t) => String(t.id ?? t._id ?? '')).filter(Boolean);
        const serverOrderPayload = {
          restaurantId: restaurant?.id,
          branchId: branch?.id,
          orderNumber,
          type: normalizedOrderType,
          status: 'ON_HOLD',
          paymentStatus: 'UNPAID',
          source: 'POS',
          tableId: tableId ?? undefined,
          employeeId: employee?.id,
          subtotalCents: totals.subtotal,
          discountCents: totals.discount,
          taxCents: totals.tax,
          totalCents: totals.total,
          discountId: discountId ?? undefined,
          taxIds,
          notes: noteDraft || undefined,
          idempotencyKey: orderId,
          items: lines.map((l) => ({
            menuItemId: l.menuItem.id,
            menuItemName: l.menuItem.name,
            quantity: l.quantity,
            unitPriceCents: l.perUnitPriceCents,
            subtotalCents: l.subtotalCents,
            discountCents: 0,
            taxCents: 0,
            totalCents: l.subtotalCents,
            modifierOptions: [],
            notes: l.notes || undefined,
            isVoided: false,
            preparationStatus: 'NEW',
          })),
        };
        await window.electronAPI.db.syncQueue.push({
          op_id: `order_${orderId}`,
          entity_type: 'ORDER',
          operation: 'CREATE',
          entity_id: orderId,
          payload: JSON.stringify(serverOrderPayload),
          idempotency_key: orderId,
          local_entity_version: 1,
        });
      }
      // Auto-print kitchen ticket for held orders so the kitchen starts
      // prepping immediately without waiting for the cashier to come back
      // and pay. Fire-and-forget; printer errors log only (never block UX).
      try {
        await window.electronAPI?.print?.kitchenTicket?.(orderId);
      } catch (ktErr) {
        console.warn('[cart] hold-order kitchen ticket print error (non-fatal):', ktErr);
      }
      cartActions.clear();
      orderNumberRef.current = '';
      setNoteDraft('');
      setToast('Order held — find it in History tab.');
    } catch (e) {
      console.warn('[cart] hold failed', e);
      setToast('Could not hold order.');
    } finally {
      setTimeout(() => setToast(null), 2600);
    }
  };

  return (
    <>
      <aside className="w-96 shrink-0 h-full border-l border-white/5 bg-slate-900/40 flex flex-col">
        <div className="p-5 border-b border-white/5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-white text-lg">Current Order</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {lineCount} item{lineCount === 1 ? '' : 's'} · {orderType.replace('_', ' ')}
              </p>
            </div>
            {lines.length > 0 && (
              <button
                onClick={() => {
                  cartActions.clear();
                  setNoteDraft('');
                  orderNumberRef.current = '';
                }}
                className="btn-ghost !min-h-10 !px-3 text-xs text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
              >
                🗑 Clear
              </button>
            )}
          </div>

          <div className="grid grid-cols-4 gap-1.5">
            {ORDER_TYPES.map((ot) => (
              <button
                key={ot.id}
                onClick={() => cartActions.setOrderType(ot.id)}
                className={`min-h-[3.25rem] rounded-xl text-xs font-semibold flex flex-col items-center justify-center gap-0.5 transition-all active:scale-[0.97] ring-1 ring-inset ${
                  orderType === ot.id
                    ? 'bg-gradient-neon text-black ring-amber-400/40 shadow-glow-restaurant'
                    : 'bg-white/5 text-slate-300 ring-white/10 hover:bg-white/10'
                }`}
              >
                <span className="text-lg">{ot.icon}</span>
                <span>{ot.label}</span>
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowTablePicker(true)}
            className={`w-full min-h-[3.5rem] rounded-xl px-4 flex items-center justify-between ring-1 ring-inset transition-all active:scale-[0.98] ${
              tableId
                ? 'bg-amber-500/15 text-amber-200 ring-amber-500/30 hover:bg-amber-500/25'
                : 'bg-white/5 text-slate-300 ring-white/10 hover:bg-white/10'
            }`}
          >
            <span className="flex items-center gap-2 min-w-0">
              <span className="text-xl shrink-0">{tableId ? '🪑' : '➕'}</span>
              <span className="font-semibold text-left truncate">
                {tableId
                  ? tableName
                  : orderType === 'DINE_IN'
                  ? 'Assign table…'
                  : 'Add table (optional)'}
              </span>
            </span>
            <div className="flex items-center gap-2 shrink-0 ml-2">
              {tableSession?.tabNumber && (
                <span className="chip !py-0.5 !px-2 !text-[10px] !font-bold tabular-nums !bg-emerald-500/15 !text-emerald-300 !ring-emerald-500/30">
                  Running tab • {tableSession.tabNumber}
                </span>
              )}
              {tableId && (
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    // Detach the local cart from the table — session itself
                    // persists on the table side so no data is lost.
                    (cartActions as any).detachTable?.();
                  }}
                  role="button"
                  className="min-h-8 px-2 rounded-lg bg-white/10 text-xs font-bold text-slate-300 hover:bg-rose-500/20 hover:text-rose-200 transition-colors"
                >
                  Remove
                </span>
              )}
            </div>
          </button>

          {/* When a table's running tab exists, show a status pill bar with
              total + "View tab details" CTA that opens the ledger modal. */}
          {tableId && tableSession?.sessionId && (
            <div className="rounded-2xl p-3 bg-emerald-500/5 ring-1 ring-inset ring-emerald-500/20 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-300/90">
                  Live table transactions
                </div>
                <div className="text-xs text-slate-400 mt-0.5 truncate">
                  Every menu item added is stored immediately on{' '}
                  <span className="text-slate-200 font-semibold">{tableName}</span>.
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="text-right">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">
                    Running balance
                  </div>
                  <div className="text-emerald-300 font-bold tabular-nums">
                    {formatCentsToNgn(Number(tableSession.balanceDueCents ?? tableSession.totalCents ?? 0))}
                  </div>
                </div>
                <button
                  onClick={() => setShowTabDetails(true)}
                  className="h-9 px-3 rounded-xl bg-emerald-600/25 text-emerald-200 hover:bg-emerald-600/35 ring-1 ring-inset ring-emerald-500/30 text-xs font-bold active:scale-[0.97] transition-all"
                >
                  View tab
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
          {lines.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6">
              <div className="h-24 w-24 rounded-3xl bg-gradient-to-br from-amber-400/30 via-yellow-500/20 to-copper-500/30 flex items-center justify-center text-5xl mb-4 ring-1 ring-inset ring-amber-400/20 shadow-glow-restaurant">
                🛒
              </div>
              <div className="text-white font-semibold text-lg">Cart is empty</div>
              <p className="text-slate-400 text-sm mt-1 max-w-[16rem]">
                Tap a menu tile to add items. Modifiers will open first if the item has any.
              </p>
            </div>
          ) : (
            lines.map((l) => {
              const per = l.perUnitPriceCents;
              return (
                <div
                  key={l.lineId}
                  className="card p-3 bg-slate-800/40 hover:bg-slate-800/70 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-white font-semibold leading-tight truncate">
                          {l.menuItem.name}
                        </div>
                        <div className="text-gradient-neon font-bold tabular-nums shrink-0 animate-text-glow">
                          {formatCentsToNgn(l.subtotalCents)}
                        </div>
                      </div>
                      {l.modifiers && l.modifiers.length > 0 && (
                        <div className="mt-1 text-[11px] text-slate-400 leading-tight">
                          {l.modifiers
                            .flatMap((m) =>
                              (m.optionIds || []).map((oid) => {
                                const name = modifierMap[m.modifierId]?.[oid];
                                return `· ${name || 'option'}`;
                              })
                            )
                            .join(' ')}
                        </div>
                      )}
                      {per !== l.subtotalCents && (
                        <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                          {formatCentsToNgn(per)} × {l.quantity}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <div className="flex items-center gap-1.5 bg-white/5 rounded-xl p-1 ring-1 ring-inset ring-white/10">
                        <button
                          onClick={() => cartActions.updateQty(l.lineId, l.quantity - 1)}
                          className="h-9 w-9 rounded-lg bg-white/5 text-slate-300 hover:bg-white/10 flex items-center justify-center font-bold text-lg active:scale-90 transition-transform"
                        >
                          −
                        </button>
                        <div className="min-w-[2rem] text-center text-white font-bold tabular-nums px-1">
                          {l.quantity}
                        </div>
                        <button
                          onClick={() => cartActions.updateQty(l.lineId, l.quantity + 1)}
                          className="h-9 w-9 rounded-lg bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 ring-1 ring-inset ring-amber-400/20 flex items-center justify-center font-bold text-lg active:scale-90 transition-transform"
                        >
                          +
                        </button>
                      </div>
                      <button
                        onClick={() => cartActions.removeLine(l.lineId)}
                        className="text-[11px] text-rose-300 hover:text-rose-200 font-semibold min-h-6 px-2 rounded-md hover:bg-rose-500/10"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}

          {lines.length > 0 && (
            <div className="pt-2">
              <label className="block text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-1.5 px-1">
                Order note
              </label>
              <textarea
                value={noteDraft}
                onChange={(e) => {
                  setNoteDraft(e.target.value);
                  cartActions.setNote(e.target.value);
                }}
                placeholder="Special requests, allergies, spice level…"
                rows={2}
                className="w-full rounded-xl bg-slate-900/60 px-4 py-3 text-sm text-slate-100 ring-1 ring-inset ring-white/10 outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-inset focus:ring-amber-400/40 resize-none"
              />
            </div>
          )}
        </div>

        <div className="border-t border-white/5 bg-slate-900/60 p-5 space-y-3 shrink-0">
          <div className="space-y-1.5 text-sm">
            <div className="flex items-center justify-between text-slate-300">
              <span>Subtotal</span>
              <span className="tabular-nums">{formatCentsToNgn(totals.subtotal)}</span>
            </div>
            {totals.discount > 0 && (
              <div className="flex items-center justify-between text-amber-300">
                <span>Discount</span>
                <span className="tabular-nums">−{formatCentsToNgn(totals.discount)}</span>
              </div>
            )}
            {totals.tax > 0 && (
              <div className="flex items-center justify-between text-slate-300">
                <span>Tax</span>
                <span className="tabular-nums">{formatCentsToNgn(totals.tax)}</span>
              </div>
            )}
            <div className="pt-2 border-t border-white/5 flex items-center justify-between">
              <span className="text-white font-bold text-base">Grand Total</span>
              <span className="text-gradient-neon font-black text-2xl tabular-nums animate-text-glow">
                {formatCentsToNgn(totals.total)}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <button
              onClick={handleHold}
              disabled={lines.length === 0}
              className="btn-secondary disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ⏸ Hold
            </button>
            <button
              onClick={() => setShowPayment(true)}
              disabled={lines.length === 0}
              className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed min-h-14 text-base font-bold"
            >
              💰 Charge
            </button>
          </div>
        </div>

        {toast && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 animate-slide-up">
            <div className="chip bg-slate-800 text-white ring-1 ring-white/10 shadow-glow px-5 py-3 !rounded-2xl">
              {toast}
            </div>
          </div>
        )}
      </aside>

      {showTablePicker && (
        <TablePickerModal
          onClose={() => setShowTablePicker(false)}
          onSelect={(id, name) => {
            cartActions.setTable(id, name);
            setShowTablePicker(false);
          }}
          selectedTableId={tableId}
        />
      )}

      {showPayment && (
        <PaymentModal
          totals={totals}
          taxes={taxes}
          onClose={() => setShowPayment(false)}
          onPaid={(order) => {
            // Once payment clears, the running tab should leave OPEN state and
            // move towards closed so the table is flagged for bussing on the
            // floor plan. Also clears the local cart to start fresh.
            if (tableSession?.sessionId) {
              const api = (window as any).electronAPI;
              api?.db?.tableSessions
                ?.updateStatus({
                  id: tableSession.sessionId,
                  status: 'PAID',
                  closedAt: Date.now(),
                  closedBy: employee?.id ?? employee?._id ?? null,
                  ledgerNote: `Paid · Receipt #${(order as any)?.orderNumber ?? ''}`,
                })
                .catch((e: any) => console.warn('[cart] session status update failed', e));
            }
            cartActions.clear();
            setNoteDraft('');
            setShowPayment(false);
            setToast(`✅ Thank you · Receipt ${(order as any)?.orderNumber || '#'}`);
            setTimeout(() => setToast(null), 3500);
          }}
        />
      )}

      <TableTabDetailsModal
        open={showTabDetails}
        onClose={() => setShowTabDetails(false)}
        tableId={tableId}
        tableName={tableName}
        sessionId={tableSession?.sessionId}
      />
    </>
  );
}
