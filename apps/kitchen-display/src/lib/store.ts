'use client';

import { create } from 'zustand';
import { KitchenStatus, type KitchenOrder, type Order } from '@prolific/shared-types';

export interface KdsKitchenOrder extends KitchenOrder {
  order?: Order;
}

type StationFilter = 'ALL' | string;

interface KdsStore {
  kitchenOrders: KdsKitchenOrder[];
  branchId: string;
  station: StationFilter;
  deviceId: string;
  setBranchId: (id: string) => void;
  setStation: (station: StationFilter) => void;
  addKitchenOrder: (ko: KdsKitchenOrder) => void;
  updateKitchenOrder: (id: string, updates: Partial<KdsKitchenOrder>) => void;
  updateKitchenOrderStatus: (kitchenOrderId: string, status: KitchenStatus) => void;
  clearCompleted: () => void;
  setKitchenOrders: (orders: KdsKitchenOrder[]) => void;
  getOrdersByStatus: (status: KitchenStatus) => KdsKitchenOrder[];
}

function generateDeviceId(): string {
  if (typeof window === 'undefined') return 'kds-server-' + Math.random().toString(36).slice(2, 10);
  const stored = localStorage.getItem('kds-device-id');
  if (stored) return stored;
  const newId = 'kds-' + Math.random().toString(36).slice(2, 10);
  localStorage.setItem('kds-device-id', newId);
  return newId;
}

export const useKdsStore = create<KdsStore>((set, get) => ({
  kitchenOrders: [],
  branchId: '',
  station: 'ALL',
  deviceId: generateDeviceId(),

  setBranchId: (id) => set({ branchId: id }),

  setStation: (station) => set({ station }),

  addKitchenOrder: (ko) =>
    set((state) => {
      const exists = state.kitchenOrders.find((o) => o.id === ko.id);
      if (exists) return state;
      return { kitchenOrders: [ko, ...state.kitchenOrders] };
    }),

  updateKitchenOrder: (id, updates) =>
    set((state) => ({
      kitchenOrders: state.kitchenOrders.map((o) =>
        o.id === id ? { ...o, ...updates } : o
      ),
    })),

  updateKitchenOrderStatus: (kitchenOrderId, status) =>
    set((state) => ({
      kitchenOrders: state.kitchenOrders.map((o) =>
        o.id === kitchenOrderId ? { ...o, status } : o
      ),
    })),

  clearCompleted: () =>
    set((state) => ({
      kitchenOrders: state.kitchenOrders.filter((o) => o.status !== KitchenStatus.COMPLETED),
    })),

  setKitchenOrders: (orders) => set({ kitchenOrders: orders }),

  getOrdersByStatus: (status) => {
    const state = get();
    return state.kitchenOrders
      .filter((o) => o.status === status)
      .filter((o) => state.station === 'ALL' || o.stationId === state.station)
      .sort((a, b) => {
        const aTime = new Date(a.createdAt).getTime();
        const bTime = new Date(b.createdAt).getTime();
        return aTime - bTime;
      });
  },
}));
