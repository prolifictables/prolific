import { create } from 'zustand';
import { CashierCartLine } from './types';

type OrderType = 'DINE_IN' | 'TAKEOUT' | 'PICKUP' | 'DELIVERY';

/** Professional "running tab" for a table. Every time a table is assigned,
 *  a matching persisted table-session is opened (or reused) so menu items
 *  are stored as transactions on the table the instant they're added — no
 *  need to explicitly Hold or Charge before the data is durable. */
interface TableSessionAttachment {
  sessionId: string;
  tabNumber?: string;
  totalCents?: number;
  balanceDueCents?: number;
  status?: string;
  openedAt?: number;
  serverName?: string;
}

interface CartState {
  lines: CashierCartLine[];
  orderType: OrderType;
  tableId?: string;
  tableName?: string;
  /** Attachment to the persisted running-tab session — populated after the
   *  first successful `setTable` call. When present, every cart mutation
   *  syncs to the table's session in SQLite/mock shim. */
  tableSession?: TableSessionAttachment;
  customer: any | null;
  discountId?: string;
  discountAmountCents: number;
  note?: string;
  idempotencyKey?: string;
  actions: {
    addItem: (
      menuItem: any,
      qty?: number,
      modifiers?: { modifierId: string; optionIds: string[] }[]
    ) => void;
    removeLine: (lineId: string) => void;
    updateQty: (lineId: string, qty: number) => void;
    setOrderType: (t: OrderType) => void;
    setTable: (id: string, name: string) => Promise<TableSessionAttachment | undefined>;
    detachTable: () => void;
    setCustomer: (c: any | null) => void;
    setDiscount: (discountId: string, amountFixedCents: number) => void;
    clear: () => void;
    setNote: (n: string) => void;
    /** Persist the current in-memory cart as the snapshot of items on the
     *  attached running-tab session. Idempotent: safe to call on every edit. */
    flushToTableSession: () => Promise<TableSessionAttachment | undefined>;
    getTotals: (
      taxes: any[]
    ) => {
      subtotal: number;
      discount: number;
      tax: number;
      total: number;
      tip: number;
      changeDue: number;
    };
  };
}

const generateLineId = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const modifiersMatch = (
  a: { modifierId: string; optionIds: string[] }[],
  b: { modifierId: string; optionIds: string[] }[]
): boolean => {
  if (a.length !== b.length) return false;
  const aSorted = [...a].sort((x, y) => x.modifierId.localeCompare(y.modifierId));
  const bSorted = [...b].sort((x, y) => x.modifierId.localeCompare(y.modifierId));
  return aSorted.every((am, i) => {
    const bm = bSorted[i];
    if (am.modifierId !== bm.modifierId) return false;
    const aOpts = [...am.optionIds].sort();
    const bOpts = [...bm.optionIds].sort();
    if (aOpts.length !== bOpts.length) return false;
    return aOpts.every((o, j) => o === bOpts[j]);
  });
};

const calcModifierDeltaCents = (menuItem: any, modifiers: { modifierId: string; optionIds: string[] }[]): number => {
  let delta = 0;
  const itemModifiers = menuItem.modifiers || [];
  for (const sel of modifiers) {
    const mod = itemModifiers.find((m: any) => m.id === sel.modifierId || m.modifierId === sel.modifierId);
    if (mod) {
      const options = (mod.options || []).filter((o: any) => sel.optionIds.includes(o.id));
      for (const opt of options) {
        const d =
          typeof opt.priceDelta === 'number'
            ? opt.priceDelta
            : typeof opt.price_delta_cents === 'number'
              ? opt.price_delta_cents
              : 0;
        delta += d;
      }
    }
  }
  return delta;
};

const calcPerUnitCents = (menuItem: any, modifiers: { modifierId: string; optionIds: string[] }[]): number => {
  const base =
    typeof menuItem.price === 'number'
      ? menuItem.price
      : typeof menuItem.price_cents === 'number'
        ? menuItem.price_cents
        : 0;
  return base + calcModifierDeltaCents(menuItem, modifiers);
};

export const useCartStore = create<CartState>((set, get) => ({
  lines: [],
  orderType: 'DINE_IN',
  tableId: undefined,
  tableName: undefined,
  tableSession: undefined,
  customer: null,
  discountId: undefined,
  discountAmountCents: 0,
  note: undefined,
  idempotencyKey: undefined,
  actions: {
    addItem: (menuItem, qty = 1, modifiers = []) => {
      const { lines } = get();
      const itemId = menuItem.id || menuItem._id;
      const existing = lines.find(
        (l) =>
          (l.menuItem.id || l.menuItem._id) === itemId &&
          modifiersMatch(l.modifiers, modifiers)
      );
      if (existing) {
        const newQty = existing.quantity + qty;
        const perUnit = existing.perUnitPriceCents;
        set({
          lines: lines.map((l) =>
            l.lineId === existing.lineId
              ? { ...l, quantity: newQty, subtotalCents: perUnit * newQty }
              : l
          ),
        });
      } else {
        const perUnit = calcPerUnitCents(menuItem, modifiers);
        const newLine: CashierCartLine = {
          lineId: generateLineId(),
          menuItem,
          quantity: qty,
          modifiers,
          perUnitPriceCents: perUnit,
          subtotalCents: perUnit * qty,
        };
        set({ lines: [...lines, newLine] });
      }
      // Fire-and-forget: if a table running-tab is attached, persist cart
      // snapshot immediately so items become a durable table transaction.
      void get().actions.flushToTableSession();
    },
    removeLine: (lineId) => {
      set({ lines: get().lines.filter((l) => l.lineId !== lineId) });
      void get().actions.flushToTableSession();
    },
    updateQty: (lineId, qty) => {
      if (qty <= 0) {
        get().actions.removeLine(lineId);
        return;
      }
      set({
        lines: get().lines.map((l) =>
          l.lineId === lineId
            ? { ...l, quantity: qty, subtotalCents: l.perUnitPriceCents * qty }
            : l
        ),
      });
      void get().actions.flushToTableSession();
    },
    setOrderType: (t) => set({ orderType: t }),
    setTable: async (id, name) => {
      set({ tableId: id, tableName: name });
      const api =
        typeof window !== 'undefined' &&
        (window as any).electronAPI &&
        (window as any).electronAPI.db &&
        (window as any).electronAPI.db.tableSessions;
      if (!api) return undefined;
      try {
        const result = await api.openOrGet({ tableId: id, tableName: name });
        const sess = result?.session;
        if (!sess) return undefined;
        const attachment: TableSessionAttachment = {
          sessionId: sess.id,
          tabNumber: sess.tabNumber ?? sess.tab_number ?? undefined,
          totalCents: Number(sess.totalCents ?? sess.total_cents ?? 0),
          balanceDueCents: Number(sess.balanceDueCents ?? sess.balance_due_cents ?? 0),
          status: sess.status ?? undefined,
          openedAt: Number(sess.openedAt ?? sess.opened_at ?? 0) || undefined,
          serverName: sess.serverName ?? sess.server_name ?? undefined,
        };
        set({ tableSession: attachment });
        // Sync any items that were already in the cart over to the session.
        void get().actions.flushToTableSession();
        return attachment;
      } catch (err) {
        console.error('[cart-store] setTable failed to open session:', err);
        return undefined;
      }
    },
    detachTable: () => {
      set({
        tableId: undefined,
        tableName: undefined,
        tableSession: undefined,
      });
    },
    setCustomer: (c) => set({ customer: c }),
    setDiscount: (discountId, amountFixedCents) => {
      set({ discountId, discountAmountCents: amountFixedCents });
      void get().actions.flushToTableSession();
    },
    clear: () => {
      set({
        lines: [],
        tableId: undefined,
        tableName: undefined,
        tableSession: undefined,
        customer: null,
        discountId: undefined,
        discountAmountCents: 0,
        note: undefined,
        idempotencyKey: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      });
    },
    setNote: (n) => {
      set({ note: n });
      void get().actions.flushToTableSession();
    },
    flushToTableSession: async () => {
      const snapshot = get();
      if (!snapshot.tableSession?.sessionId) return undefined;
      const api =
        typeof window !== 'undefined' &&
        (window as any).electronAPI &&
        (window as any).electronAPI.db &&
        (window as any).electronAPI.db.tableSessions;
      if (!api) return snapshot.tableSession;
      const items = snapshot.lines.map((l) => ({
        id: l.lineId,
        lineId: l.lineId,
        menuItemId: l.menuItem?.id ?? l.menuItem?._id ?? '',
        name: l.menuItem?.name ?? l.menuItem?.title ?? 'Item',
        unitPriceCents: Number(l.perUnitPriceCents ?? 0),
        quantity: Number(l.quantity ?? 0),
        subtotalCents: Number(l.subtotalCents ?? 0),
        specialInstructions: (l as any).notes ?? (l as any).note ?? undefined,
      }));
      try {
        const sess: any = await api.replaceCartItems({
          sessionId: snapshot.tableSession.sessionId,
          items,
          taxes: undefined,
          discountCents: Number(snapshot.discountAmountCents ?? 0),
          note: snapshot.note ?? null,
        });
        const attachment: TableSessionAttachment = {
          sessionId: snapshot.tableSession.sessionId,
          tabNumber: sess?.tabNumber ?? sess?.tab_number ?? snapshot.tableSession.tabNumber,
          totalCents: Number(sess?.totalCents ?? sess?.total_cents ?? snapshot.tableSession.totalCents ?? 0),
          balanceDueCents: Number(
            sess?.balanceDueCents ?? sess?.balance_due_cents ?? snapshot.tableSession.balanceDueCents ?? 0
          ),
          status: sess?.status ?? snapshot.tableSession.status,
          openedAt: Number(sess?.openedAt ?? sess?.opened_at ?? snapshot.tableSession.openedAt) || undefined,
          serverName: sess?.serverName ?? sess?.server_name ?? snapshot.tableSession.serverName,
        };
        set({ tableSession: attachment });
        return attachment;
      } catch (err) {
        console.error('[cart-store] flushToTableSession error:', err);
        return snapshot.tableSession;
      }
    },
    getTotals: (taxes) => {
      const { lines, discountAmountCents } = get();
      const subtotal = lines.reduce((sum, l) => sum + l.subtotalCents, 0);
      const discount = Math.min(discountAmountCents, subtotal);
      const taxableBase = subtotal - discount;
      let tax = 0;
      for (const t of taxes || []) {
        const rate = t.rate || 0;
        if (t.isIncludedInPrice) continue;
        tax += Math.round(taxableBase * (rate / 100));
      }
      const total = taxableBase + tax;
      return {
        subtotal,
        discount,
        tax,
        total,
        tip: 0,
        changeDue: 0,
      };
    },
  },
}));
