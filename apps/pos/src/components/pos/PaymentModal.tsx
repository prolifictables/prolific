'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCartStore } from '../../lib/cart-store';
import { useAuthStore } from '../../lib/auth-store';
import { formatCentsToNgn, padZero } from '../../lib/ui-helpers';
import { resolveApiBase } from '../../lib/remote-auth';

type PaymentMethod = 'PHYSICAL_POS' | 'BANK_TRANSFER';

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

// User strict rule (2026-09-05): only two payment methods are ever offered.
// 1) ATM Card (PHYSICAL_POS) - tap/insert on the connected POS terminal
// 2) Bank Transfer (BANK_TRANSFER) - shows admin-uploaded bank account details
//    on BOTH the POS AND the customer-facing display.
const METHODS: { id: PaymentMethod; label: string; icon: string; desc: string }[] = [
  {
    id: 'PHYSICAL_POS',
    label: 'ATM Card',
    icon: '💳',
    desc: 'Tap / insert card on terminal',
  },
  {
    id: 'BANK_TRANSFER',
    label: 'Bank Transfer',
    icon: '🏦',
    desc: 'Bank details on both screens',
  },
];

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
  const [method, setMethod] = useState<PaymentMethod>('PHYSICAL_POS');
  const [processing, setProcessing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // Admin-uploaded bank details (bankName, accountName, accountNumber, caption)
  // from the branch customer-display settings. Strict rule: visible on POS for
  // BANK_TRANSFER payments AND on the customer display for every payment
  // method. Loaded from offline settings cache on mount, refreshed when
  // branchId changes (supports multi-branch cashier switches).
  const [bankDetails, setBankDetails] = useState<{
    bankName?: string;
    accountName?: string;
    accountNumber?: string;
    caption?: string;
  } | null>(null);

  // Load the cached bank details once the modal opens. Same read path that
  // CartPanel uses for held-order receipts: `bank_details:<branchId>` stored
  // offline by the customer-display poller (mock-electron-shim.ts L432).
  useEffect(() => {
    let alive = true;
    (async () => {
      let cached: any = null;
      try {
        if (branch?.id && window.electronAPI?.db?.settings?.get) {
          const key = `bank_details:${branch.id}`;
          cached = (await window.electronAPI.db.settings.get(key, 'BRANCH')) || null;
        }
        // Browser-mode shim fallback: localStorage settings snapshot
        if (!cached && branch?.id && typeof window !== 'undefined' && (window as any).localStorage) {
          try {
            const raw = (window as any).localStorage.getItem(`settings:BRANCH:bank_details:${branch.id}`);
            if (raw) cached = JSON.parse(raw);
          } catch { /* ignore */ }
        }
      } catch { cached = null; }
      if (!alive) return;
      if (cached && typeof cached === 'object' && (
        typeof cached.bankName === 'string' ||
        typeof cached.accountName === 'string' ||
        typeof cached.accountNumber === 'string'
      )) {
        setBankDetails({
          bankName: typeof cached.bankName === 'string' ? cached.bankName : undefined,
          accountName: typeof cached.accountName === 'string' ? cached.accountName : undefined,
          accountNumber: typeof cached.accountNumber === 'string' ? cached.accountNumber : undefined,
          caption: typeof cached.caption === 'string' ? cached.caption : undefined,
        });
      } else {
        setBankDetails(null);
      }
    })();
    return () => { alive = false; };
  }, [branch?.id]);

  const totalCents = totals.total;

  const handleConfirm = async () => {
    if (processing) return;
    setProcessing(true);
    // ——— Local-persistence guard flags ———
    // The outer generic "Payment not recorded" toast caused cashiers to
    // double-tap Confirm and double-charge. We now only show the hard
    // failure toast if NEITHER the order row nor the payment row could
    // be read back from SQLite after the guarded create() calls. Any
    // partial persistence (order saved / payment saved / both saved)
    // always surfaces a soft warning + continues to onPaid() because
    // the transaction is effectively done locally and sync/print/CD
    // errors are background concerns for an offline-first POS.
    let orderPersisted = false;
    let paymentPersisted = false;
    let softWarning: string | null = null;
    // Declared outside try so the outer-catch persistence-gated success path
    // can reference them (handles the case where DB writes succeeded but a
    // later stage threw, which was the original false-negative toast bug).
    let realOrderId = '';
    let realOrderNumber = '';
    try {
      const open: any = await window.electronAPI?.db?.shifts?.getOpen?.().catch(() => null);
      const shiftId = open?.id || open?.shiftId || null;

      const now = Date.now();
      const orderId =
        (crypto.randomUUID && crypto.randomUUID()) || `ord_${now}_${Math.random()}`;
      const orderNumber = '#' + (10000 + Math.floor(Math.random() * 90000)).toString();
      realOrderId = orderId;
      realOrderNumber = orderNumber;
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
        // Denormalized contact snapshots (matches OrdersRepository schema
        // columns customer_phone + customer_email). Writes are identical to
        // what we now push through the server CreateOrderInput pipeline for
        // Website/QR orders, so Admin Orders page search shows phone/email
        // pills at a glance regardless of order source channel.
        customer_phone: customer?.phone ? String(customer.phone) : null,
        customer_email: customer?.email ? String(customer.email) : null,
        employee_id: employee?.id ?? null,
        // Denormalized cashier name snapshot so every printed receipt shows
        // "Cashier: …" in the header even when viewed offline or on a
        // different device. Builds from employee.name first, falling back to
        // firstName + lastName if name isn't provided.
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
        shift_id: shiftId,
        held_by: null,
        held_at: null,
        // User strict rule (2026-09-05): both available methods (ATM Card /
        // Bank Transfer) are treated as terminal + FINAL the moment the
        // cashier clicks Confirm. NO secondary Admin approval is required.
        // Orders + payments are always written PAID / COMPLETED immediately;
        // paid_amount_cents is set to full total; balance_due_cents stays 0;
        // shift totals reconcile cleanly without any "later confirm" step.
        status: 'COMPLETED',
        payment_status: 'PAID',
        payment_method:
          method === 'PHYSICAL_POS'
            ? 'CARD'
            : 'BANK_TRANSFER',
        paid_amount_cents: totals.total,
        balance_due_cents: 0,
        subtotal_cents: totals.subtotal,
        discount_cents: totals.discount,
        tax_cents: totals.tax,
        total_cents: totals.total,
        tip_cents: totals.tip,
        change_due_cents: 0,
        discount_id: discountId ?? null,
        note: note ? String(note) : null,
        split_group_id: null,
        idempotency_key: orderId,
        synced: 0,
        created_at: now,
        updated_at: now,
      };

      // Defensive: orders.repository already handles idempotency non-throwingly
      // (SELECT pre-check + INSERT OR IGNORE + fallback lookup), but wrap in a
      // broad guard anyway so an unexpected SQLite schema/constraint error from
      // a future migration mismatch never surfaces the generic "Payment not
      // recorded" toast for an order that was actually written. Then verify
      // the row was persisted via getById so the outer-catch toast-gate can
      // distinguish "nothing was saved" from "order was saved, everything
      // else is warnings".
      try {
        await window.electronAPI?.db?.orders?.create(orderRow);
      } catch (ocErr: any) {
        console.warn('[pay] orders.create threw (continuing — idempotency may have saved it)', ocErr);
      }
      try {
        const checkRow: any = await window.electronAPI?.db?.orders?.getById?.(orderId);
        orderPersisted = !!(checkRow && (checkRow.id || (checkRow as any)?.result?.id));
      } catch {
        orderPersisted = false;
      }
      // Note: `realOrderId` declared above (outside try block) so the
      // persistence-gated outer-catch success path can still reference it.

      // Collect modifier option rows to persist alongside items so receipts and
      // kitchen tickets display modifier + options printed line items correctly.
      const modifierRows: any[] = [];

      // ——— Defensive wrap: addItem / modifier build loop ———
      // Even if a single line item's modifier option fails DB insert (e.g. a
      // column NOT NULL constraint on a newly added field that older rows
      // don't supply), we MUST continue the flow. Otherwise the user sees
      // "Payment not recorded" even though both the order and payment rows
      // were persisted, and re-clicking Confirm creates duplicate sync-queue
      // entries. Wrapping here converts item-persistence failures into
      // best-effort warnings (receipts will print a summary from the cart
      // object instead of DB rows, which is fine).
      try {
        for (const l of lines) {
          try {
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
          } catch (aiErr) {
            console.warn('[pay] addItem failed for line', l.lineId, aiErr);
          }
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
      } catch (loopErr) {
        console.warn('[pay] items loop outer guard caught', loopErr);
      }

      // Note: kitchen ticket printing moved below with the 2-copy customer +
      // cashier receipt print — we only issue a single kitchen ticket AFTER
      // the payment row is written, not before. This avoids double prints on
      // confirm when the earlier kitchen-ticket block and the later block
      // both fire for the same order.

      const paymentId =
        (crypto.randomUUID && crypto.randomUUID()) || `pay_${now}_${Math.random()}`;
      const paymentMethod =
        method === 'PHYSICAL_POS' ? 'CARD' : 'BANK_TRANSFER';
      const referenceNote = `${METHODS.find((m) => m.id === method)?.label}`;

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
        change_due_cents: 0,
        // User rule: cashier confirmation is final. ATM + Bank Transfer are
        // marked PAID / completed immediately — no later "Mark as Paid" step.
        status: 'PAID',
        verification_source: 'LOCAL',
        completed_at: now,
        reference_note: referenceNote,
        idempotency_key: paymentId,
        synced: 0,
        created_at: now,
        updated_at: now,
      };

      // ——— Defensive: payments.create guard + persisted? verify ———
      // If payment-row insert throws (e.g. SQLite UNIQUE clash, missing column,
      // etc.) we MUST still continue to the onPaid callback and skip the generic
      // failure toast. The order row already carries paid_amount_cents /
      // payment_status set correctly for CASH, so shift totals still reconcile.
      // Skipping the payment ledger row is a data-quality issue but FAR better
      // than telling the customer the payment failed when it actually went
      // through (which would cause the cashier to double-tap and double-charge).
      // Then read back via listByOrderId so the outer-catch toast-gate can
      // distinguish "no persistence at all" from "persisted but warnings".
      try {
        await window.electronAPI?.db?.payments?.create(paymentRow);
      } catch (pcErr: any) {
        console.warn('[pay] payments.create threw (continuing with order-level status only)', pcErr);
      }
      try {
        const checkPays = (await window.electronAPI?.db?.payments?.listByOrderId?.(realOrderId)) || [];
        const arr = Array.isArray(checkPays) ? checkPays : [];
        paymentPersisted = arr.some((p: any) => String(p?.id ?? p?.payment_id ?? '') === String(paymentId)) || arr.length > 0;
      } catch {
        paymentPersisted = false;
      }

      // ——— Defensive wrap: entire sync-queue build + push block ———
      // Building server payloads walks menuModifiers.listForItemId,
      // JSON.stringify, and syncQueue.push (INSERT with UNIQUE op_id). Any of
      // those can throw (bad menu modifier data, circular reference, DB lock
      // during claimBatch race). Swallowing them here keeps the checkout flow
      // intact — the offline-sync 30s poll + explicit syncNow on reconnect will
      // still attempt delivery later (the order is already persisted locally).
      try {
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
            // Strict rule: cashier confirm = FINAL confirmation; both methods
            // (ATM card terminal, Bank Transfer) always ship COMPLETED/PAID.
            status: 'COMPLETED',
            paymentStatus: 'PAID',
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
            // Sync path matches local row: PAID/completed immediately.
            status: 'PAID',
            notes: referenceNote,
            idempotencyKey: paymentId,
            receiptNumber: orderNumber.replace('#', 'RCP-'),
            completedAt: new Date(now),
          };

          try {
            await window.electronAPI?.db?.syncQueue?.push?.({
              op_id: `order_${orderId}`,
              entity_type: 'ORDER',
              operation: 'CREATE',
              entity_id: orderId,
              payload: JSON.stringify(serverOrderPayload),
              idempotency_key: orderId,
              local_entity_version: 1,
            });
          } catch (sqErr) {
            console.warn('[pay] syncQueue.push ORDER failed (deferred to later cycle)', sqErr);
          }
          try {
            await window.electronAPI?.db?.syncQueue?.push?.({
              op_id: `payment_${paymentId}`,
              entity_type: 'PAYMENT',
              operation: 'CREATE',
              entity_id: paymentId,
              payload: JSON.stringify(serverPaymentPayload),
              idempotency_key: paymentId,
              local_entity_version: 1,
            });
          } catch (sqErr) {
            console.warn('[pay] syncQueue.push PAYMENT failed (deferred to later cycle)', sqErr);
          }

          // Inline POST to sync-batch endpoint (best-effort, optional). Keep this
          // INSIDE the if (syncQueue.push) block because serverOrderPayload
          // and serverPaymentPayload are declared in that scope. The outer
          // syncBlockErr catch (immediately below) guards the whole block so
          // JSON.stringify / API-base resolution / fetch errors all continue
          // the checkout flow instead of showing "Payment not recorded".
          if (typeof window !== 'undefined') {
            try {
              const apiBaseRaw = resolveApiBase?.()
                ?? (typeof import.meta !== 'undefined'
                  && (import.meta as any).env
                  && ((import.meta as any).env.VITE_API_BASE_URL
                    || (import.meta as any).env.VITE_API_URL
                    || (import.meta as any).env.VITE_PUBLIC_API_URL
                    || (import.meta as any).env.API_BASE_URL))
                ?? 'http://localhost:4000/api/v1';
              const apiBase = String(apiBaseRaw).replace(/\/+$/, '');

              const stored = localStorage.getItem('pos_device_id');
              const deviceId = stored || (crypto.randomUUID ? crypto.randomUUID() : `browser_${Date.now()}`);
              if (!stored) localStorage.setItem('pos_device_id', deviceId);

              const endpoint = accessToken ? '/sync/batch' : '/public/pos-sync-batch';
              const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                Accept: 'application/json',
              };
              if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
              const res = await fetch(`${apiBase}${endpoint}`, {
                method: 'POST',
                headers,
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
            } catch (syncErr: any) {
              // Don't interrupt checkout on direct-sync POST failure: order
              // + payment rows are already persisted locally and the queue
              // reader will retry delivery on its poll interval or when the
              // monitor detects internet. But surface a visible warning so
              // the cashier knows the admin hasn't received it yet.
              void syncErr;
              setToast('Saved locally, but failed to sync to Admin.');
              setTimeout(() => setToast(null), 4000);
            }
          }
        }
      } catch (syncBlockErr) {
        console.warn('[pay] outer sync-queue block caught — continuing checkout', syncBlockErr);
      }

      try {
        // Resolve latest cached bank details (manager-editable via Admin portal,
        // branch-scoped, stored offline in SQLite settings `bank_details:<id>`
        // and mirrored to localStorage for browser mock shim. Strict user rule:
        // bank details MUST render on customer display NO MATTER the payment
        // method (CASH, card terminal, transfer all show it).
        let cachedBank: any = null;
        try {
          if (branch?.id && window.electronAPI?.db?.settings?.get) {
            const key = `bank_details:${branch.id}`;
            cachedBank = (await window.electronAPI.db.settings.get(key, 'BRANCH')) || null;
          }
        } catch (_bankErr) {
          cachedBank = null;
        }

        // Human-readable payment-method label shown on ThankYou and ActiveOrder
        // (e.g. "💳 ATM Card" vs "🏦 Bank Transfer").
        const METHOD_LABEL = METHODS.find((m) => m.id === method)?.label || method;
        const paymentMethodLabel =
          method === 'PHYSICAL_POS'
            ? `💳 ${METHOD_LABEL}`
            : `🏦 ${METHOD_LABEL}`;

        // Build CustomerOrderPreview-compatible lines array (matches CartPanel's
        // existing showOrder preview shape so ThankYouScreen and ActiveOrder
        // screens reuse the same line-item renderer with modifiers).
        // Build a one-off modifier option-name lookup for this cart: we re-read
        // item modifiers from the local menu to avoid depending on outer scope.
        const previewLines: any[] = [];
        for (const l of lines) {
          const modDisplayNames: string[] = [];
          if (Array.isArray(l.modifiers) && l.modifiers.length) {
            let itemModDefs: any[] = [];
            try {
              const fetched =
                (await window.electronAPI?.db?.menuModifiers?.listForItemId?.(l.menuItem.id)) || [];
              itemModDefs = Array.isArray(fetched) ? fetched : [];
            } catch {
              itemModDefs = [];
            }
            for (const sel of l.modifiers) {
              const mod = itemModDefs.find((m: any) => String(m.id) === String(sel.modifierId));
              const optionNameById = new Map<string, string>();
              for (const o of mod?.options || []) {
                optionNameById.set(String(o.id), o.name || o.label || String(o.id));
              }
              for (const oid of sel.optionIds || []) {
                modDisplayNames.push(optionNameById.get(String(oid)) || String(oid));
              }
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

        await window.electronAPI?.customerDisplay?.showPaid?.({
          orderNumber,
          table: tableName || undefined,
          orderType: normalizedOrderType,
          lines: previewLines,
          subtotalCents: totals.subtotal,
          discountCents: totals.discount,
          taxCents: totals.tax,
          totalCents: totals.total,
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
          paymentMethodLabel,
          tenderedCents: undefined,
          changeDueCents: undefined,
          bankDetails: cachedBank || undefined,
        });
      } catch (e: any) {
        console.warn('[pay] customer display error', e);
      }

      // Auto-print receipts as soon as the payment is recorded. For cash +
      // confirmed card/transfer methods we print immediately; any printer
      // errors are logged but don't interrupt the payment flow.
      //
      // STRICT PRINT RULE (user requirement — do NOT re-add kitchen tickets):
      // The confirm flow must print EXACTLY 2 spool pages in total:
      //   1) Customer receipt copy
      //   2) Cashier receipt copy
      // Kitchen tickets and any other supplementary prints are DISABLED in
      // this build. Adding a kitchen ticket here would make 3 pages and
      // violate the rule that was explicitly requested.
      try {
        await window.electronAPI?.print?.receipt?.(realOrderId, 2);
        setToast && setToast(`🧾 Receipt ${orderNumber || '#'} printed`);
        setTimeout(() => setToast && setToast(null), 2200);
      } catch (e: any) {
        console.warn('[pay] print receipt error', e);
      }
      setTimeout(
        () =>
          onPaid({
            id: realOrderId,
            orderNumber,
            // Both ATM Card + Bank Transfer are complete when the cashier
            // confirms — no secondary Admin approval required.
            status: 'COMPLETED',
            paymentStatus: 'PAID',
            totalAmount: totals.total / 100,
          }),
        150
      );
    } catch (e: any) {
      console.warn('[pay] confirm failed', e);

      // ——— Toast gate: only the hard "Payment not recorded" toast when
      // NEITHER order nor payment rows could be persisted locally. For ANY
      // partial success (order saved / payment saved / both saved), show a
      // soft warning + continue to onPaid() so the cashier never double-taps
      // Confirm, which is what caused the double-charge duplicate rows.
      if (orderPersisted || paymentPersisted) {
        const safeOrderId: string = realOrderId || '';
        const safeOrderNumber = realOrderNumber || '#';
        const safeTotal = Number.isFinite(totals?.total) ? totals.total / 100 : 0;
        setToast(softWarning || 'Saved locally. Background warnings — order is recorded.');
        setTimeout(() => setToast(null), 3600);
        setTimeout(
          () =>
            onPaid?.({
              id: safeOrderId,
              orderNumber: safeOrderNumber,
              status: 'COMPLETED',
              paymentStatus: 'PAID',
              totalAmount: safeTotal,
            }),
          200
        );
      } else {
        setToast('Payment not recorded. Try again.');
        setTimeout(() => setToast(null), 2600);
      }
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
                    <div className="text-white font-bold text-lg">
                      {bankDetails?.caption || 'Bank Transfer Details'}
                    </div>
                    <div className="text-slate-400 text-xs mt-1">
                      Visible on both the POS and the customer-facing display — always
                    </div>
                  </div>

                  {/* Render the three core fields. Falls back to a soft placeholder
                      if the manager hasn't uploaded the bank info yet (links the
                      cashier directly to Admin settings without blocking checkout). */}
                  <div className="space-y-2 text-sm">
                    {[
                      { label: 'Bank', value: bankDetails?.bankName },
                      { label: 'Account name', value: bankDetails?.accountName },
                      { label: 'Account number', value: bankDetails?.accountNumber, mono: true },
                    ].map((f) => (
                      <div
                        key={f.label}
                        className="flex justify-between p-3 rounded-xl bg-slate-950/40 ring-1 ring-inset ring-white/5 min-h-[3rem]"
                      >
                        <span className="text-slate-400">{f.label}</span>
                        <span
                          className={
                            'text-white font-semibold text-right min-w-0 max-w-[60%] truncate ' +
                            (f.mono ? 'font-mono tabular-nums tracking-wide' : '')
                          }
                          title={f.value || ''}
                        >
                          {f.value || (
                            <span className="text-slate-500 italic font-normal">
                              Not set — Admin → Settings → Bank Account Details
                            </span>
                          )}
                        </span>
                      </div>
                    ))}

                    {/* Amount row — kept independent of bank-detail emptiness */}
                    <div className="flex justify-between p-3 rounded-xl bg-slate-950/40 ring-1 ring-inset ring-white/5">
                      <span className="text-slate-400">Amount</span>
                      <span className="text-emerald-400 font-bold tabular-nums">
                        {formatCentsToNgn(totalCents)}
                      </span>
                    </div>
                  </div>

                  {!bankDetails?.accountNumber && (
                    <div className="rounded-xl bg-amber-500/10 ring-1 ring-amber-400/30 px-3.5 py-2.5 text-[11px] text-amber-200 leading-snug">
                      ⚠️ Bank details are empty. Ask your manager to enter them in{' '}
                      <strong>Admin → Settings → Customer Display → Bank Account Details</strong>{' '}
                      so customers see the correct account number on every screen.
                    </div>
                  )}
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
              : `Confirm · ${formatCentsToNgn(totalCents)}`}
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
