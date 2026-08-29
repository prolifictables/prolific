'use client';

import { create } from 'zustand';
import { apiGet, apiPost } from './api';

export type SelectedModifierOption = {
  modifierId: string;
  optionId: string;
};

export type CartItem = {
  key: string;
  menuItemId: string;
  name: string;
  priceCents: number;
  quantity: number;
  imageUrl?: string;
  specialInstructions?: string;
  selectedModifierOptions: SelectedModifierOption[];
  perUnitTotalCents: number;
};

type SessionState = {
  token: string | null;
  table: any;
  branch: any;
  restaurant: any;
  session: any;
  guestToken: string | null;
  loading: boolean;
  error: string | null;
  initFromToken: (qrToken: string, initialResolvedQr?: any) => Promise<void>;
  invalidateSession: () => void;
};

type CartState = {
  items: CartItem[];
  orderType: 'DINE_IN' | 'TAKEAWAY' | 'PICKUP' | 'DELIVERY';
  note: string;
  addItem: (spec: Omit<CartItem, 'key'> & { modifierNames?: { modifierId: string; optionNames: string[] }[] }) => void;
  removeItem: (key: string) => void;
  setQty: (key: string, qty: number) => void;
  clear: () => void;
  setOrderType: (t: CartState['orderType']) => void;
  setNote: (note: string) => void;
  totals: (taxRatePercent?: number) => {
    subtotalCents: number;
    taxCents: number;
    discountCents: number;
    totalCents: number;
  };
  itemCount: () => number;
};

export const useSession = create<SessionState>((set, get) => ({
  token: null,
  table: null,
  branch: null,
  restaurant: null,
  session: null,
  guestToken: null,
  loading: false,
  error: null,
  initFromToken: async (qrToken, initialResolvedQr) => {
    set({ loading: true, error: null, token: qrToken });
    try {
      let resolved: any;
      if (initialResolvedQr) {
        resolved = initialResolvedQr;
      } else {
        resolved = await apiGet<any>(`/public/qr/${qrToken}`);
      }
      const joinRes = await apiPost<any>('/public/table-sessions/join', {
        qrToken,
      });
      set({
        table: resolved.table,
        branch: resolved.branch,
        restaurant: resolved.restaurant,
        session: joinRes.session,
        guestToken: joinRes.guestToken,
        loading: false,
      });
      if (typeof window !== 'undefined') {
        localStorage.setItem('lastToken', qrToken);
      }
    } catch (e: any) {
      set({ error: e.message || 'Failed to initialize session', loading: false });
      throw e;
    }
  },
  invalidateSession: () => {
    set({
      token: null,
      table: null,
      branch: null,
      restaurant: null,
      session: null,
      guestToken: null,
      error: null,
      loading: false,
    });
  },
}));

function cartKey(
  menuItemId: string,
  modifiers: SelectedModifierOption[]
): string {
  const sorted = [...modifiers].sort((a, b) =>
    `${a.modifierId}:${a.optionId}`.localeCompare(`${b.modifierId}:${b.optionId}`)
  );
  return `${menuItemId}|${sorted.map((m) => `${m.modifierId}:${m.optionId}`).join(',')}`;
}

export const useCart = create<CartState>((set, get) => ({
  items: [],
  orderType: 'DINE_IN',
  note: '',
  addItem: (spec) => {
    const key = cartKey(spec.menuItemId, spec.selectedModifierOptions);
    set((state) => {
      const existingIdx = state.items.findIndex((i) => i.key === key);
      if (existingIdx >= 0) {
        const newItems = [...state.items];
        newItems[existingIdx] = {
          ...newItems[existingIdx],
          quantity: Math.min(99, newItems[existingIdx].quantity + spec.quantity),
          specialInstructions: spec.specialInstructions || newItems[existingIdx].specialInstructions,
        };
        return { items: newItems };
      }
      return {
        items: [
          ...state.items,
          {
            key,
            menuItemId: spec.menuItemId,
            name: spec.name,
            priceCents: spec.priceCents,
            quantity: Math.max(1, Math.min(99, spec.quantity)),
            imageUrl: spec.imageUrl,
            specialInstructions: spec.specialInstructions,
            selectedModifierOptions: spec.selectedModifierOptions,
            perUnitTotalCents: spec.perUnitTotalCents,
          },
        ],
      };
    });
  },
  removeItem: (key) => set((s) => ({ items: s.items.filter((i) => i.key !== key) })),
  setQty: (key, qty) => {
    const safe = Math.max(1, Math.min(99, qty));
    set((s) => ({
      items: s.items.map((i) => (i.key === key ? { ...i, quantity: safe } : i)),
    }));
  },
  clear: () => set({ items: [], note: '' }),
  setOrderType: (t) => set({ orderType: t }),
  setNote: (note) => set({ note: note.slice(0, 200) }),
  itemCount: () => get().items.reduce((s, i) => s + i.quantity, 0),
  totals: (taxRatePercent = 0) => {
    const subtotal = get().items.reduce(
      (s, i) => s + i.perUnitTotalCents * i.quantity,
      0
    );
    const tax = Math.round(subtotal * (taxRatePercent / 100));
    return {
      subtotalCents: subtotal,
      taxCents: tax,
      discountCents: 0,
      totalCents: subtotal + tax,
    };
  },
}));
