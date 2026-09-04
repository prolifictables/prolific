/// <reference types="vite/client" />

export type CustomerScreenName = 'idle' | 'order' | 'thankyou';

// Single promo slide shown on the left-hand 70% of the customer idle screen.
// bg is a Tailwind gradient-from-via-to class name (e.g. 'from-amber-500 via-orange-500 to-rose-500').
export interface CustomerPromo {
  emoji: string;
  title: string;
  subtitle: string;
  bg: string;
}

// Single "Today's Specials" card on the right-hand top of the idle screen.
// price is stored as whole NAIRA (multiply by 100 when converting to cents for formatPrice).
export interface CustomerSpecial {
  emoji: string;
  name: string;
  price: number;
}

export interface CustomerBranding {
  name: string;
  tagline: string;
  logoUrl?: string;
  wifi?: string;
  openingHours?: string;
  branchName?: string;
}

export interface CustomerOrderLine {
  qty: number;
  name: string;
  modifiers: string[];
  unitPriceCents: number;
  totalCents: number;
}

export interface CustomerOrderPreview {
  orderNumber: string;
  table?: string;
  orderType?: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY' | string;
  customerName?: string;
  lines: CustomerOrderLine[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  paymentStatus?: 'PAID' | 'AWAITING_PAYMENT' | 'REFUNDED' | string;
  orderStatus?: 'RECEIVED' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'SERVED' | string;
  paidAt?: number;
}

export interface CustomerStatePayload {
  screen?: CustomerScreenName;
  branding?: CustomerBranding;
  orderPreview?: CustomerOrderPreview;
  promos?: CustomerPromo[];
  specials?: CustomerSpecial[];
}

declare global {
  interface Window {
    electronAPI?: {
      getVersions: () => Promise<{
        node: string;
        chrome: string;
        electron: string;
      }>;
      getDeviceId: () => Promise<{ deviceId: string; deviceKey: string }>;
      getConnectionStatus: () => Promise<unknown>;
      db: {
        runMigrations: () => Promise<unknown>;
        employees: {
          findAll: () => Promise<unknown>;
          findByPin: (pin: string, branchId?: string) => Promise<unknown>;
          count: () => Promise<unknown>;
          applySnapshot: (employees: unknown) => Promise<unknown>;
          upsertWithPin: (employee: unknown, pin: string) => Promise<unknown>;
        };
        menuCategories: {
          listAll: () => Promise<unknown>;
          upsert: (row: unknown) => Promise<unknown>;
          deleteById: (id: string) => Promise<unknown>;
        };
        menuItems: {
          list: (filters?: unknown) => Promise<unknown>;
          findById: (id: string) => Promise<unknown>;
          search: (query: string) => Promise<unknown>;
          listByCategory: (categoryId: string) => Promise<unknown>;
          upsert: (row: unknown) => Promise<unknown>;
          deleteById: (id: string) => Promise<unknown>;
        };
        menuModifiers: {
          listForItemId: (itemId: string) => Promise<unknown>;
          listByIds: (ids: string[]) => Promise<unknown>;
          listAll: (branchId?: string) => Promise<unknown>;
          listOptionsByModifierIds: (ids: string[]) => Promise<unknown>;
          upsert: (payload: { modifier: unknown; options: unknown }) => Promise<unknown>;
          deleteById: (id: string) => Promise<unknown>;
        };
        menu: {
          applySnapshot: (snapshot: unknown) => Promise<unknown>;
        };
        taxes: {
          listActiveDefaults: () => Promise<unknown>;
        };
        discounts: {
          listActive: () => Promise<unknown>;
        };
        tables: {
          list: () => Promise<unknown>;
          listAll: () => Promise<unknown>;
          applySnapshot: (tables: unknown) => Promise<unknown>;
        };
        diningTables: {
          listAll: () => Promise<unknown>;
        };
        customers: {
          list: (filters?: unknown) => Promise<unknown>;
          create: (data: unknown) => Promise<unknown>;
          findOrCreate: (data: unknown) => Promise<unknown>;
        };
        orders: {
          create: (draft: unknown) => Promise<unknown>;
          updateStatus: (id: string, status: unknown) => Promise<unknown>;
          updatePaymentStatus: (
            id: string,
            payload: {
              paymentStatus?: unknown;
              method: unknown;
              paidAmountCents?: number;
              note?: string;
              employeeId?: string;
              employeeName?: string;
              shiftId?: string;
              referenceId?: string;
            }
          ) => Promise<{ order: unknown; payment: unknown } | null>;
          listRecent: (limit?: number) => Promise<unknown>;
          getById: (id: string) => Promise<unknown>;
          listHeld: () => Promise<unknown>;
          setHeld: (
            id: string,
            held: boolean,
            reason?: string
          ) => Promise<unknown>;
          listByTableId: (tableId: string) => Promise<unknown>;
          addItem: (orderId: string, item: unknown) => Promise<unknown>;
          removeItem: (orderId: string, itemId: string) => Promise<unknown>;
          list: (filters?: unknown) => Promise<unknown>;
        };
        orderItems: {
          listForOrderId: (orderId: string) => Promise<unknown>;
        };
        orderItemModifierOptions: {
          bulkInsert: (rows: unknown[]) => Promise<unknown>;
          listForOrderId: (orderId: string) => Promise<unknown>;
        };
        payments: {
          create: (payment: unknown) => Promise<unknown>;
          listByOrderId: (orderId: string) => Promise<unknown>;
          listByShiftId: (shiftId: string) => Promise<unknown>;
          getShiftTotals: (shiftId: string) => Promise<{
            cash: number; card: number; other: number; total: number; tip: number;
            counts: { cash: number; card: number; other: number; total: number };
            perMethod: Array<{ method: string; amount: number; tip: number; count: number }>;
            orders: {
              paidOrderCount: number; voidedOrderCount: number; refundedOrderCount: number;
              paidItemQty: number;
              subtotalCents: number; discountCents: number; taxCents: number; totalPaidCents: number;
            };
            payouts: { totalPayoutCents: number; payoutCount: number };
            cashAdjustments: { totalPaidInCents: number; totalPaidOutCents: number; count: number };
          }>;
        };
        shifts: {
          open: (data: unknown) => Promise<unknown>;
          close: (data: unknown) => Promise<unknown>;
          getOpen: (filter?: { deviceId?: string; employeeId?: string; branchId?: string; restaurantId?: string }) => Promise<unknown>;
          listByEmployee: (employeeId: string) => Promise<unknown>;
          listByDate: (date: unknown) => Promise<unknown>;
        };
        cashAdjustments: {
          create: (data: unknown) => Promise<unknown>;
          listByShiftId: (shiftId: string) => Promise<unknown>;
        };
        kitchenOrders: {
          create: (data: unknown) => Promise<unknown>;
          updateStatus: (id: string, status: unknown) => Promise<unknown>;
          listByStatus: (status: unknown) => Promise<unknown>;
          bump: (id: string) => Promise<unknown>;
        };
        inventoryItems: {
          list: (filters?: unknown) => Promise<unknown>;
          listLowStock: () => Promise<unknown>;
          updateStock: (
            id: string,
            quantity: number,
            note?: string
          ) => Promise<unknown>;
        };
        recipes: {
          listByMenuItemId: (menuItemId: string) => Promise<unknown>;
          getFullRecipesCache: () => Promise<unknown>;
        };
        settings: {
          get: (key: string, scope?: string) => Promise<unknown>;
          set: (key: string, value: unknown, scope?: string) => Promise<unknown>;
          getAllByScope: (scope: string) => Promise<unknown>;
        };
        syncQueue: {
          push: (item: unknown) => Promise<unknown>;
          peek: (limit?: number) => Promise<unknown>;
          claimBatch: (batchSize?: number) => Promise<unknown>;
          markDone: (opId: string) => Promise<unknown>;
          markFailed: (opId: string, error: string) => Promise<unknown>;
          getCounts: () => Promise<unknown>;
          resetByOpId: (opId: string) => Promise<unknown>;
        };
        syncRecords: {
          listByEntity: (
            entityType: string,
            filters?: unknown
          ) => Promise<unknown>;
          insert: (record: unknown) => Promise<unknown>;
          markStatus: (id: string, status: unknown) => Promise<unknown>;
        };
        auditLogs: {
          listByDate: (
            from: string,
            to: string,
            filters?: unknown
          ) => Promise<unknown>;
          insert: (log: unknown) => Promise<unknown>;
        };
        inventoryTransactions: {
          listByItem: (itemId: string, limit?: number) => Promise<unknown>;
          listByShift: (shiftId: string) => Promise<unknown>;
        };
        meta: {
          setSyncCursor: (
            cursor: Record<string, string | number>
          ) => Promise<unknown>;
          getSyncCursor: () => Promise<unknown>;
          setLastAuth: (auth: unknown) => Promise<unknown>;
          getLastAuth: () => Promise<unknown>;
        };
        tableSessions: {
          openOrGet: (payload: unknown) => Promise<unknown>;
          getById: (id: string) => Promise<unknown>;
          getOpenForTable: (tableId: string) => Promise<unknown>;
          listOpen: (branchId?: string) => Promise<unknown>;
          listRecent: (branchId?: string, limit?: number) => Promise<unknown>;
          replaceCartItems: (payload: unknown) => Promise<unknown>;
          updateStatus: (payload: unknown) => Promise<unknown>;
        };
        tableSessionLedger: {
          listForSession: (sessionId: string) => Promise<unknown>;
          appendNote: (payload: unknown) => Promise<unknown>;
        };
        reports: {
          periodSales: (opts: {
            period: 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';
            year?: number;
            month?: number;
            weekStartTs?: number;
            dayTs?: number;
            branchId?: string | null;
            restaurantId?: string | null;
          }) => Promise<unknown>;
          availableYears: (scope?: {
            branchId?: string | null;
            restaurantId?: string | null;
          }) => Promise<number[]>;
        };
      };
      sync: {
        requestNow: () => Promise<unknown>;
        subscribeStatus: (cb: (status: unknown) => void) => void;
        unsubscribeStatus: () => void;
      };
      print: {
        testPage: () => Promise<unknown>;
        receipt: (orderId: string, copy?: number) => Promise<unknown>;
        kitchenTicket: (orderId: string) => Promise<unknown>;
        listPrinters: () => Promise<unknown>;
        getQueueStatus: () => Promise<unknown>;
      };
      customerDisplay: {
        showIdle: () => Promise<unknown>;
        showOrder: (orderPreview: unknown) => Promise<unknown>;
        showPaid: (order: unknown) => Promise<unknown>;
      };
      shifts: {
        openShift: (data: unknown) => Promise<unknown>;
        closeShift: (data: unknown) => Promise<unknown>;
        getOpenShift: () => Promise<unknown>;
      };
    };
    customerWindowAPI: {
      getVersions: () => Promise<{
        node: string;
        chrome: string;
        electron: string;
      }>;
      subscribeCustomerState: (cb: (state: CustomerStatePayload) => void) => void;
      unsubscribeCustomerState: () => void;
      getRestaurantBranding: () => Promise<CustomerBranding>;
    };
  }
}

export {};
