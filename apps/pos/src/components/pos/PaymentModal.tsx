'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCartStore } from '../../lib/cart-store';
import { useAuthStore } from '../../lib/auth-store';
import { formatCentsToNgn, padZero } from '../../lib/ui-helpers';

type PaymentMethod = 'CASH' | 'PHYSICAL_POS' | 'BANK_TRANSFER' | 'SPLIT_BILL' | 'ONLINE';

interface PaymentModalProps {
  totals: {
    subtotal: number;
    discount: number;
    tax: number;
    total: number;
    tip: number;
    changeDue: number;
  };
  taxes: any[];
  onClose: () => void;
  onPaid: (order: any) => void;
}

const METHODS: { id: PaymentMethod; label: string; icon: string; desc: string }[] = [
  { id: 'CASH', label: 'Cash', icon: '💵', desc: 'Notes & coins' },
  { id: 'PHYSICAL_POS', label: 'POS Terminal', icon: '💳', desc: 'Card terminal tap' },
  { id: 'BANK_TRANSFER', label: 'Bank Transfer', icon: '🏦', desc: 'Notify customer' },
  { id: 'SPLIT_BILL', label: 'Split Bill', icon: '✂️', desc: 'Divide among seats' },
  { id: 'ONLINE', label: 'Online Link', icon: '🔗', desc: 'Paystack / Flutterwave' },
];

const NUM_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];

export default function PaymentModal({ totals, taxes, onClose, onPaid }: PaymentModalProps) {
  const {
    lines,
    orderType,
    tableId,
    tableName,
    customer,
    discountId,
    discountAmountCents,
    note,
  } = useCartStore();
  const { employee, branch, restaurant } = useAuthStore();
  const accessToken = useAuthStore((s) => s.accessToken);
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [tenderedRaw, setTenderedRaw] = useState<string>('');
  const [processing, setProcessing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const totalCents = totals.total;

  const tenderedCents = useMemo(() => {
    if (!tenderedRaw) return 0;
    const cleaned = tenderedRaw.replace(/[^0-9.]/g, '');
    const num = parseFloat(cleaned);
    if (isNaN(num)) return 0;
    return Math.round(num * 100);
  }, [tenderedRaw]);

  const changeCents = Math.max(0, tenderedCents - totalCents);
  const remaining = Math.max(0, totalCents - tenderedCents);

  useEffect(() => {
    if (method === 'CASH' && !tenderedRaw) {
      const rounded = Math.ceil(totalCents / 100) * 100;
      const defaultVal = rounded >= totalCents ? rounded : totalCents;
      setTenderedRaw((defaultVal / 100).toFixed(2));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, totalCents]);

  const appendKey = (k: string) => {
    if (k === '⌫') {
      setTenderedRaw((p) => p.slice(0, -1));
      return;
    }
    if (k === '.') {
      setTenderedRaw((p) => (p.includes('.') ? p : p + '.'));
      return;
    }
    setTenderedRaw((p) => {
      if (p.includes('.') && p.split('.')[1]?.length >= 2) return p;
      if (p === '0') return k;
      return p + k;
    });
  };

  const handleConfirm = async () => {
    if (processing) return;
    if (method === 'CASH' && tenderedCents < totalCents) {
      setToast('Insufficient cash tendered.');
      setTimeout(() => setToast(null), 2500);
      return;
    }
    setProcessing(true);
    try {
      const open: any = await window.electronAPI?.db?.shifts?.getOpen?.();
      const shiftId = open?.id || open?.shiftId || null;

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
        customer_id: customer?.id ?? null,
        customer_name: customer?.firstName
          ? `${customer.firstName} ${customer.lastName || ''}`.trim()
          : null,
        employee_id: employee?.id ?? null,
        shift_id: shiftId,
        held_by: null,
        held_at: null,
        status: method === 'CASH' ? 'COMPLETED' : 'AWAITING_PAYMENT',
        payment_status: method === 'CASH' ? 'PAID' : 'PENDING',
        subtotal_cents: totals.subtotal,
        discount_cents: totals.discount,
        tax_cents: totals.tax,
        total_cents: totals.total,
        tip_cents: totals.tip,
        change_due_cents: method === 'CASH' ? changeCents : 0,
        discount_id: discountId ?? null,
        note: note ? String(note) : null,
        split_group_id: null,
        idempotency_key: orderId,
        synced: 0,
        created_at: now,
        updated_at: now,
      };

      await window.electronAPI?.db?.orders?.create(orderRow);
      const realOrderId = orderId;

      // Collect modifier option rows to persist alongside items so receipts and
      // kitchen tickets display modifier + options printed line items correctly.
      const modifierRows: any[] = [];

      for (const l of lines) {
        await window.electronAPI?.db?.orders?.addItem?.(realOrderId, {
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
        // Resolve modifier and option display names (cart stores {modifierId, optionIds[]}
        // only). Use same API as the sync code below (listForItemId) so we have the
        // full schema; fallback gracefully if not available.
        if (Array.isArray(l.modifiers) && l.modifiers.length) {
          let itemModDefs: any[] | null = null;
          try {
            const fetched: any =
              (await window.electronAPI?.db?.menuModifiers?.listForItemId?.(l.menuItem.id)) || [];
            itemModDefs = Array.isArray(fetched) ? fetched : null;
          } catch (_e) {
            itemModDefs = null;
          }
          for (const sel of l.modifiers) {
            const mod = itemModDefs?.find((m: any) => String(m.id) === String(sel.modifierId));
            const modName = (mod?.name || mod?.modifierName || String(sel.modifierId)) as string;
            if (Array.isArray(sel.optionIds)) {
              for (const oid of sel.optionIds) {
                const option = (mod?.options || []).find((o: any) => String(o.id) === String(oid));
                modifierRows.push({
                  id: `moid_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
                  order_item_id: l.lineId,
                  modifier_id: sel.modifierId || null,
                  modifier_name: modName || null,
                  option_id: oid || null,
                  option_name: (option?.name || option?.label || String(oid)) as string,
                  price_delta_cents: Number(option?.priceDeltaCents || option?.priceDelta || 0),
                });
              }
            }
          }
        }
      }
      if (modifierRows.length) {
        try {
          await window.electronAPI?.db?.orderItemModifierOptions?.bulkInsert?.(modifierRows);
        } catch (e) {
          console.warn('[pay] persist modifiers insert failed', e);
        }
      }

      // Auto-print a kitchen ticket immediately after the order is written. Failures
      // are non-blocking: we don't fail the payment.
      try {
        await window.electronAPI?.print?.kitchenTicket?.(realOrderId);
        setToast && setToast('🖨️ Kitchen ticket printed');
        setTimeout(() => setToast && setToast(null), 2000);
      } catch (e) {
        console.warn('[pay] kitchen ticket print error (ok to ignore)', e);
      }

      const paymentId =
        (crypto.randomUUID && crypto.randomUUID()) || `pay_${now}_${Math.random()}`;
      const paymentMethod =
        method === 'PHYSICAL_POS'
          ? 'CARD'
          : method === 'BANK_TRANSFER'
            ? 'BANK_TRANSFER'
            : method === 'ONLINE'
              ? 'ONLINE_PAYSTACK'
              : 'CASH';
      const referenceNote =
        method === 'CASH'
          ? `Tendered ${formatCentsToNgn(tenderedCents)} · Change ${formatCentsToNgn(changeCents)}`
          : `${METHODS.find((m) => m.id === method)?.label}`;

      const paymentRow: any = {
        id: paymentId,
        order_id: realOrderId,
        employee_id: employee?.id ?? null,
        shift_id: shiftId,
        branch_id: branch?.id ?? null,
        restaurant_id: restaurant?.id ?? null,
        method: paymentMethod,
        provider: paymentMethod === 'CARD' ? 'pos_card' : null,
        transaction_reference: null,
        amount_cents: totals.total,
        tip_cents: totals.tip,
        change_due_cents: method === 'CASH' ? changeCents : 0,
        status: method === 'CASH' ? 'PAID' : 'PENDING',
        verification_source: 'LOCAL',
        completed_at: method === 'CASH' ? now : null,
        reference_note: referenceNote,
        idempotency_key: paymentId,
        synced: 0,
        created_at: now,
        updated_at: now,
      };

      await window.electronAPI?.db?.payments?.create(paymentRow);

      if (window.electronAPI?.db?.syncQueue?.push) {
        const taxIds = taxes.map((t) => String(t.id ?? t._id ?? '')).filter(Boolean);
        const serverItems = await Promise.all(
          lines.map(async (l) => {
            try {
              const modifiers = (await window.electronAPI?.db?.menuModifiers?.listForItemId?.(l.menuItem.id)) as any[];
              const modById = new Map<string, any>();
              for (const m of modifiers || []) modById.set(String(m.id), m);
              const modifierOptions: any[] = [];
              for (const sel of l.modifiers || []) {
                const mod = modById.get(String((sel as any).modifierId));
                const options = Array.isArray(mod?.options) ? mod.options : [];
                const optById = new Map<string, any>();
                for (const o of options) optById.set(String(o.id), o);
                for (const optId of (sel as any).optionIds || []) {
                  const opt = optById.get(String(optId));
                  modifierOptions.push({
                    modifierId: String((sel as any).modifierId),
                    optionId: String(optId),
                    name: opt?.name != null ? String(opt.name) : String(optId),
                    priceDeltaCents:
                      typeof opt?.price_delta_cents === 'number'
                        ? opt.price_delta_cents
                        : typeof opt?.priceDeltaCents === 'number'
                          ? opt.priceDeltaCents
                          : 0,
                  });
                }
              }
              return {
                menuItemId: l.menuItem.id,
                menuItemName: l.menuItem.name,
                quantity: l.quantity,
                unitPriceCents: l.perUnitPriceCents,
                subtotalCents: l.subtotalCents,
                discountCents: 0,
                taxCents: 0,
                totalCents: l.subtotalCents,
                modifierOptions,
                notes: l.notes || undefined,
                isVoided: false,
                preparationStatus: 'NEW',
              };
            } catch {
              return {
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
              };
            }
          })
        );

        const serverOrderPayload = {
          restaurantId: restaurant?.id,
          branchId: branch?.id,
          orderNumber,
          type: normalizedOrderType,
          status: method === 'CASH' ? 'COMPLETED' : 'AWAITING_PAYMENT',
          paymentStatus: method === 'CASH' ? 'PAID' : 'PENDING',
          source: 'POS',
          tableId: tableId ?? undefined,
          customerId: customer?.id,
          employeeId: employee?.id,
          shiftId: shiftId || undefined,
          subtotalCents: totals.subtotal,
          discountCents: totals.discount,
          taxCents: totals.tax,
          totalCents: totals.total,
          discountId: discountId ?? undefined,
          taxIds,
          notes: note || undefined,
          idempotencyKey: orderId,
          items: serverItems,
        };

        const serverPaymentPayload = {
          restaurantId: restaurant?.id,
          branchId: branch?.id,
          orderId: realOrderId,
          employeeId: employee?.id,
          shiftId: shiftId || undefined,
          amountCents: totals.total,
          currency: (restaurant?.currency as any) || 'NGN',
          method: paymentMethod,
          verificationSource: 'LOCAL',
          status: method === 'CASH' ? 'PAID' : 'PENDING',
          notes: referenceNote,
          idempotencyKey: paymentId,
          receiptNumber: orderNumber.replace('#', 'RCP-'),
          completedAt: method === 'CASH' ? new Date(now) : undefined,
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
        await window.electronAPI.db.syncQueue.push({
          op_id: `payment_${paymentId}`,
          entity_type: 'PAYMENT',
          operation: 'CREATE',
          entity_id: paymentId,
          payload: JSON.stringify(serverPaymentPayload),
          idempotency_key: paymentId,
          local_entity_version: 1,
        });

        if (!window.electronAPI?.sync?.requestNow && accessToken && branch?.id && typeof window !== 'undefined') {
          try {
            const apiBase =
              (typeof import.meta !== 'undefined' &&
                (import.meta as any).env &&
                ((import.meta as any).env.VITE_API_BASE_URL ||
                  (import.meta as any).env.VITE_API_URL ||
                  (import.meta as any).env.VITE_PUBLIC_API_URL ||
                  (import.meta as any).env.API_BASE_URL)) ||
              'http://localhost:4000/api/v1';
            const stored = localStorage.getItem('pos_device_id');
            const deviceId = stored || (crypto.randomUUID ? crypto.randomUUID() : `browser_${Date.now()}`);
            if (!stored) localStorage.setItem('pos_device_id', deviceId);
            const res = await fetch(`${String(apiBase).replace(/\/+$/, '')}/sync/batch`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
              },
              body: JSON.stringify({
                deviceId,
                commands: [
                  {
                    idempotencyKey: orderId,
                    entityType: 'ORDER',
                    operation: 'CREATE',
                    entityId: orderId,
                    localEntityVersion: 1,
                    payload: serverOrderPayload,
                  },
                  {
                    idempotencyKey: paymentId,
                    entityType: 'PAYMENT',
                    operation: 'CREATE',
                    entityId: paymentId,
                    localEntityVersion: 1,
                    payload: serverPaymentPayload,
                  },
                ],
              }),
            });
            if (!res.ok) {
              const raw = await res.text().catch(() => '');
              throw new Error(`Sync failed (${res.status}): ${raw || res.statusText}`);
            }
          } catch {
            setToast('Saved locally, but failed to sync to Admin.');
            setTimeout(() => setToast(null), 4000);
          }
        }
      }

      try {
        await window.electronAPI?.customerDisplay?.showPaid?.({
          orderNumber,
          totalAmount: totals.total / 100,
          items: lines.map((l) => ({
            id: l.lineId,
            menuItemId: l.menuItem.id,
            name: l.menuItem.name,
            unitPrice: l.perUnitPriceCents / 100,
            quantity: l.quantity,
            selectedModifiers: l.modifiers,
            specialInstructions: l.notes,
            subtotal: l.subtotalCents / 100,
            totalAmount: l.subtotalCents / 100,
            kitchenStatus: 'NEW',
          })),
          paymentMethod: method,
          tendered: tenderedCents / 100,
          change: changeCents / 100,
        });
      } catch (e) {
        console.warn('[pay] customer display error', e);
      }

      // Auto-print receipts as soon as the payment is recorded. For cash +
      // confirmed card/transfer methods we print immediately; any printer
      // errors are logged but don't interrupt the payment flow.
      try {
        await window.electronAPI?.print?.receipt?.(realOrderId, 2);
        setToast && setToast(`🧾 Receipt ${orderNumber || '#'} printed`);
        setTimeout(() => setToast && setToast(null), 2200);
      } catch (e) {
        console.warn('[pay] print receipt error', e);
      }

      setTimeout(
        () =>
          onPaid({
            id: realOrderId,
            orderNumber,
            status: method === 'CASH' ? 'COMPLETED' : 'AWAITING_PAYMENT',
            paymentStatus: method === 'CASH' ? 'PAID' : 'PENDING',
            totalAmount: totals.total / 100,
          }),
        150
      );
    } catch (e) {
      console.warn('[pay] confirm failed', e);
      setToast('Payment not recorded. Try again.');
      setTimeout(() => setToast(null), 2600);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm animate-slide-up">
      <div className="w-full sm:max-w-4xl max-h-[96vh] bg-slate-900 border border-amber-400/20 sm:rounded-3xl rounded-t-3xl shadow-glow-restaurant flex flex-col neon-border">
        <div className="p-6 border-b border-white/5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-white">Accept Payment</h2>
            <p className="text-sm text-slate-400 mt-0.5">
              {lines.length} line · Order #{Date.now().toString().slice(-6)}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={processing}
            className="btn-ghost !min-h-10 !w-10 !px-0 text-xl"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="grid md:grid-cols-2 gap-6 p-6">
            <div className="space-y-4">
              <div className="card p-5 space-y-2 text-sm">
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
                    <span>Tax ({taxes?.map((t) => `${t.rate}%`).join(', ') || 'VAT'})</span>
                    <span className="tabular-nums">{formatCentsToNgn(totals.tax)}</span>
                  </div>
                )}
                <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                  <span className="text-white font-bold text-base">Total</span>
                  <span className="text-gradient-neon font-black text-3xl tabular-nums animate-text-glow">
                    {formatCentsToNgn(totalCents)}
                  </span>
                </div>
              </div>

              <div>
                <div className="text-xs uppercase tracking-wider text-slate-500 font-bold mb-2 px-1">
                  Payment Method
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {METHODS.map((m) => {
                    const active = method === m.id;
                    return (
                      <button
                        key={m.id}
                        onClick={() => setMethod(m.id)}
                        className={`rounded-2xl p-3 text-left ring-1 ring-inset transition-all active:scale-[0.98] ${
                          active
                            ? 'bg-amber-500/15 ring-amber-400/40 text-white shadow-glow-restaurant'
                            : 'bg-white/5 ring-white/10 text-slate-200 hover:bg-white/10'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">{m.icon}</span>
                          <div>
                            <div className="font-bold text-sm">{m.label}</div>
                            <div className="text-[10px] text-slate-400">{m.desc}</div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              {method === 'CASH' && (
                <>
                  <div className="card p-5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-400 font-medium">
                        Amount Tendered
                      </span>
                      <div className="flex gap-1.5 flex-wrap">
                        {[totalCents, Math.ceil(totalCents / 500) * 500, Math.ceil(totalCents / 1000) * 1000]
                          .map((v, i) => (
                            <button
                              key={i}
                              onClick={() => setTenderedRaw((v / 100).toFixed(2))}
                              className="chip !py-1 hover:bg-amber-500/15 hover:text-amber-200 transition-colors text-xs font-bold ring-1 ring-inset ring-white/10"
                            >
                              {v === totalCents ? 'Exact' : formatCentsToNgn(v)}
                            </button>
                          ))}
                      </div>
                    </div>
                    <div className="min-h-16 rounded-2xl bg-slate-950/50 ring-1 ring-inset ring-amber-400/20 flex items-center justify-end px-5">
                      <div className="text-3xl font-black tabular-nums text-gradient-neon animate-text-glow tracking-tight">
                        {formatCentsToNgn(tenderedCents)}
                      </div>
                    </div>
                    {changeCents > 0 && (
                      <div className="min-h-12 rounded-2xl bg-emerald-500/10 ring-1 ring-inset ring-emerald-500/25 flex items-center justify-between px-5 shadow-glow-emerald">
                        <span className="text-emerald-300 text-sm font-semibold">Change</span>
                        <span className="text-emerald-300 font-black text-xl tabular-nums">
                          +{formatCentsToNgn(changeCents)}
                        </span>
                      </div>
                    )}
                    {remaining > 0 && (
                      <div className="min-h-12 rounded-2xl bg-rose-500/10 ring-1 ring-inset ring-rose-500/25 flex items-center justify-between px-5">
                        <span className="text-rose-300 text-sm font-semibold">Short</span>
                        <span className="text-rose-400 font-black text-xl tabular-nums">
                          −{formatCentsToNgn(remaining)}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {NUM_KEYS.map((k) => (
                      <button
                        key={k}
                        onClick={() => appendKey(k)}
                        className={`min-h-[4.5rem] rounded-2xl font-black text-2xl transition-all active:scale-[0.96] ${
                          k === '⌫'
                            ? 'bg-rose-500/10 text-rose-300 ring-1 ring-inset ring-rose-500/20 hover:bg-rose-500/20'
                            : 'bg-white/5 text-white ring-1 ring-inset ring-white/10 hover:bg-white/10'
                        }`}
                      >
                        {k}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {method === 'PHYSICAL_POS' && (
                <div className="card p-6 text-center space-y-4">
                  <div className="text-6xl">💳</div>
                  <div>
                    <div className="text-white font-bold text-lg">Tap or insert card</div>
                    <div className="text-slate-400 text-sm mt-1">
                      On the connected POS terminal, process {formatCentsToNgn(totalCents)}
                    </div>
                  </div>
                  <button
                    onClick={() => console.log('[pay] terminal triggered')}
                    className="btn-secondary w-full"
                  >
                    📟 Trigger Terminal
                  </button>
                </div>
              )}

              {method === 'BANK_TRANSFER' && (
                <div className="card p-6 space-y-4">
                  <div className="text-center">
                    <div className="text-5xl mb-2">🏦</div>
                    <div className="text-white font-bold text-lg">Bank Transfer Details</div>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between p-3 rounded-xl bg-slate-950/40 ring-1 ring-inset ring-white/5">
                      <span className="text-slate-400">Bank</span>
                      <span className="text-white font-semibold">{branch?.name || 'Prolofic'} MFB</span>
                    </div>
                    <div className="flex justify-between p-3 rounded-xl bg-slate-950/40 ring-1 ring-inset ring-white/5">
                      <span className="text-slate-400">Account</span>
                      <span className="text-white font-mono font-semibold">0012345678</span>
                    </div>
                    <div className="flex justify-between p-3 rounded-xl bg-slate-950/40 ring-1 ring-inset ring-white/5">
                      <span className="text-slate-400">Amount</span>
                      <span className="text-emerald-400 font-bold tabular-nums">
                        {formatCentsToNgn(totalCents)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {method === 'SPLIT_BILL' && (
                <div className="card p-6 text-center space-y-3">
                  <div className="text-5xl">✂️</div>
                  <div className="text-white font-bold text-lg">Split Bill</div>
                  <p className="text-slate-400 text-sm">
                    Record {formatCentsToNgn(totalCents)} as split payment. Use the receipt
                    for per-seat breakdowns at the table.
                  </p>
                </div>
              )}

              {method === 'ONLINE' && (
                <div className="card p-6 text-center space-y-4">
                  <div className="text-5xl">🔗</div>
                  <div>
                    <div className="text-white font-bold text-lg">Online Payment Link</div>
                    <p className="text-slate-400 text-sm mt-1">
                      Customer pays via Paystack/Flutterwave checkout
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => console.log('[pay] generate paystack link')}
                      className="btn-secondary"
                    >
                      Paystack
                    </button>
                    <button
                      onClick={() => console.log('[pay] generate flutterwave link')}
                      className="btn-secondary"
                    >
                      Flutterwave
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-white/5 flex flex-col sm:flex-row gap-3">
          <button onClick={onClose} disabled={processing} className="btn-secondary sm:flex-1">
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={processing}
            className="btn-success sm:flex-[2] text-lg font-bold min-h-14 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {processing
              ? 'Processing…'
              : `Confirm · ${formatCentsToNgn(
                  method === 'CASH' ? totalCents : totalCents
                )}`}
          </button>
        </div>

        {toast && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 animate-slide-up">
            <div className="chip bg-rose-500/20 text-rose-200 ring-1 ring-rose-500/30 shadow-glow px-5 py-3 !rounded-2xl">
              {toast}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
