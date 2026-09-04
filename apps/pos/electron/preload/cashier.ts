import { contextBridge, ipcRenderer } from 'electron';

type DbInvokeResponse =
  | { success: true; result: unknown }
  | { success: false; error: string }
  | unknown;

async function invokeDb(channel: string, ...args: unknown[]): Promise<unknown> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as DbInvokeResponse;
  if (res && typeof res === 'object' && 'success' in res) {
    const r = res as { success: boolean; result?: unknown; error?: unknown };
    if (r.success) return r.result;
    throw new Error(typeof r.error === 'string' ? r.error : 'Unknown IPC error');
  }
  return res as unknown;
}

contextBridge.exposeInMainWorld('electronAPI', {
  getVersions: () => ipcRenderer.invoke('app:get-versions'),

  getDeviceId: () => ipcRenderer.invoke('device:get-device-id'),

  // Critical for packaged desktop builds: the renderer's `file:///` URL has
  // no hostname, so it cannot detect production via window.location. Ask the
  // main process for the canonical resolved API base (always
  // prolific-api.onrender.com on packaged prod) — otherwise login calls fall
  // to localhost:4000 and the user sees SERVER_UNREACHABLE.
  getApiBaseUrl: () => ipcRenderer.invoke('device:get-api-base-url'),

  // Synchronous counterpart so the renderer module-level `const API_BASE =
  // resolveApiBase();` call (runs at import time) can get the URL without
  // async/await. Returns plain string, no Promise wrapping.
  getApiBaseUrlSync: () => ipcRenderer.sendSync('device:get-api-base-url-sync'),

  getConnectionStatus: () => ipcRenderer.invoke('sync:get-connection-status'),

  // PIN login CORS bypass for packaged Electron.
  // Renderer fetch from file:/// triggers an OPTIONS preflight with
  // Origin: "null" (opaque) — the Nest CORS allowlist used to reject that
  // preflight with HTTP 404 "Cannot OPTIONS /api/v1/auth/pin/login", which
  // Chromium then surfaced as a TypeError with NO response → guardedFetch
  // classified it as SERVER_UNREACHABLE. This IPC sends the POST through
  // Node's native http stack (no CORS, no preflight) as an automatic
  // belt-and-suspenders fallback.
  authPinLogin: (payload: {
    pin: string;
    branchId?: string;
    deviceId?: string;
  }) => ipcRenderer.invoke('auth:pin-login', payload),

  // Generic public HTTP GET CORS bypass for packaged Electron.
  // Any GET to /public/* (menu, branches, qr-resolve, etc.) that carries a
  // non-safelisted header or runs after a 30s Render cold-start may trigger
  // an OPTIONS preflight with the opaque file:// origin. Returns the same
  // shape as authPinLogin ({status, ok, body (parsed json), text}) so the
  // renderer can drop-in replace fetch() without parsing differences.
  publicHttpGet: (path: string) =>
    ipcRenderer.invoke('public:http-get', { path }),

  db: {
    runMigrations: () => invokeDb('db:run-migrations'),

    employees: {
      findAll: () => invokeDb('db:employees:findAll'),
      findByPin: (pin: string, branchId?: string) =>
        invokeDb('db:employees:findByPin', branchId, pin),
      count: () => invokeDb('db:employees:count'),
      applySnapshot: (employees: unknown) =>
        invokeDb('db:employees:applySnapshot', employees),
      upsertWithPin: (employee: unknown, pin: string) =>
        invokeDb('db:employees:upsertWithPin', employee, pin),
    },

    menuCategories: {
      listAll: () => invokeDb('db:menu-categories:listAll'),
      upsert: (row: unknown) => invokeDb('db:menu-categories:upsert', row),
      deleteById: (id: string) => invokeDb('db:menu-categories:deleteById', id),
    },

    menuItems: {
      list: (filters?: unknown) => invokeDb('db:menu-items:list', filters),
      findById: (id: string) => invokeDb('db:menu-items:findById', id),
      search: (query: string) => invokeDb('db:menu-items:search', query),
      listByCategory: (categoryId: string) =>
        invokeDb('db:menu-items:listByCategory', categoryId),
      upsert: (row: unknown) => invokeDb('db:menu-items:upsert', row),
      deleteById: (id: string) => invokeDb('db:menu-items:deleteById', id),
    },

    menuModifiers: {
      listForItemId: (itemId: string) =>
        invokeDb('db:menu-modifiers:listForItemId', itemId),
      listByIds: (ids: string[]) =>
        invokeDb('db:menu-modifiers:listByIds', ids),
      listAll: (branchId?: string) =>
        invokeDb('db:menu-modifiers:listAll', branchId),
      listOptionsByModifierIds: (ids: string[]) =>
        invokeDb('db:menu-modifiers:listOptionsByModifierIds', ids),
      upsert: (payload: { modifier: unknown; options: unknown }) =>
        invokeDb('db:menu-modifiers:upsert', payload),
      deleteById: (id: string) => invokeDb('db:menu-modifiers:deleteById', id),
    },

    menu: {
      applySnapshot: (snapshot: unknown) =>
        invokeDb('db:menu:applySnapshot', snapshot),
    },

    taxes: {
      listActiveDefaults: () => invokeDb('db:taxes:listActiveDefaults'),
    },

    discounts: {
      listActive: () => invokeDb('db:discounts:listActive'),
    },

    tables: {
      list: () => invokeDb('db:tables:list'),
      applySnapshot: (tables: unknown) =>
        invokeDb('db:tables:applySnapshot', tables),
    },

    customers: {
      list: (filters?: unknown) => invokeDb('db:customers:list', filters),
      create: (data: unknown) => invokeDb('db:customers:create', data),
      findOrCreate: (data: unknown) =>
        invokeDb('db:customers:findOrCreate', data),
    },

    orders: {
      create: (draft: unknown) => invokeDb('db:orders:create', draft),
      updateStatus: (id: string, status: unknown) =>
        invokeDb('db:orders:updateStatus', { id, status }),
      updatePaymentStatus: (id: string, payload: unknown) =>
        invokeDb('db:orders:updatePaymentStatus', { id, payload }),
      listRecent: (limit?: number) => invokeDb('db:orders:listRecent', limit),
      getById: (id: string) => invokeDb('db:orders:getById', id),
      listHeld: () => invokeDb('db:orders:listHeld'),
      setHeld: (id: string, held: boolean, reason?: string) =>
        invokeDb('db:orders:setHeld', { id, held, reason }),
      listByTableId: (tableId: string) =>
        invokeDb('db:orders:listByTableId', tableId),
      addItem: (orderId: string, item: unknown) =>
        invokeDb('db:orders:addItem', { orderId, item }),
      removeItem: (orderId: string, itemId: string) =>
        invokeDb('db:orders:removeItem', { orderId, itemId }),
    },

    orderItems: {
      listForOrderId: (orderId: string) =>
        invokeDb('db:order-items:listForOrderId', orderId),
    },

    orderItemModifierOptions: {
      bulkInsert: (rows: unknown[]) =>
        invokeDb('db:order-item-modifiers:bulkInsert', rows),
      listForOrderId: (orderId: string) =>
        invokeDb('db:order-item-modifiers:listForOrderId', orderId),
    },

    payments: {
      create: (payment: unknown) => invokeDb('db:payments:create', payment),
      listByOrderId: (orderId: string) =>
        invokeDb('db:payments:listByOrderId', orderId),
      listByShiftId: (shiftId: string) =>
        invokeDb('db:payments:listByShiftId', shiftId),
      getShiftTotals: (shiftId: string) =>
        invokeDb('db:payments:getShiftTotals', shiftId),
    },

    shifts: {
      open: (data: unknown) => invokeDb('db:shifts:open', data),
      close: (data: unknown) => invokeDb('db:shifts:close', data),
      getOpen: () => invokeDb('db:shifts:getOpen'),
      listByEmployee: (employeeId: string) =>
        invokeDb('db:shifts:listByEmployee', employeeId),
      listByDate: (date: unknown) => invokeDb('db:shifts:listByDate', date),
    },

    cashAdjustments: {
      create: (data: unknown) => invokeDb('db:cash-adjustments:create', data),
      listByShiftId: (shiftId: string) =>
        invokeDb('db:cash-adjustments:listByShiftId', shiftId),
    },

    kitchenOrders: {
      create: (data: unknown) => invokeDb('db:kitchen-orders:create', data),
      updateStatus: (id: string, status: unknown) =>
        invokeDb('db:kitchen-orders:updateStatus', { id, status }),
      listByStatus: (status: unknown) =>
        invokeDb('db:kitchen-orders:listByStatus', status),
      bump: (id: string) => invokeDb('db:kitchen-orders:bump', id),
    },

    inventoryItems: {
      list: (filters?: unknown) => invokeDb('db:inventory-items:list', filters),
      listLowStock: () => invokeDb('db:inventory-items:listLowStock'),
      updateStock: (id: string, quantity: number, note?: string) =>
        invokeDb('db:inventory-items:updateStock', { id, quantity, note }),
    },

    recipes: {
      listByMenuItemId: (menuItemId: string) =>
        invokeDb('db:recipes:listByMenuItemId', menuItemId),
      getFullRecipesCache: () => invokeDb('db:recipes:getFullRecipesCache'),
    },

    settings: {
      get: (key: string, scope?: string) =>
        invokeDb('db:settings:get', { key, scope }),
      set: (key: string, value: unknown, scope?: string) =>
        invokeDb('db:settings:set', { key, value, scope }),
      getAllByScope: (scope: string) =>
        invokeDb('db:settings:getAllByScope', scope),
    },

    syncQueue: {
      push: (item: unknown) => invokeDb('db:sync-queue:push', item),
      peek: (limit?: number) => invokeDb('db:sync-queue:peek', limit),
      claimBatch: (batchSize?: number) =>
        invokeDb('db:sync-queue:claimBatch', batchSize),
      markDone: (opId: string) => invokeDb('db:sync-queue:markDone', opId),
      markFailed: (opId: string, error: string) =>
        invokeDb('db:sync-queue:markFailed', { opId, error }),
      getCounts: () => invokeDb('db:sync-queue:getCounts'),
      resetByOpId: (opId: string) =>
        invokeDb('db:sync-queue:resetByOpId', opId),
    },

    syncRecords: {
      listByEntity: (entityType: string, filters?: unknown) =>
        invokeDb('db:sync-records:listByEntity', { entityType, filters }),
      insert: (record: unknown) => invokeDb('db:sync-records:insert', record),
      markStatus: (id: string, status: unknown) =>
        invokeDb('db:sync-records:markStatus', { id, status }),
    },

    auditLogs: {
      listByDate: (from: string, to: string, filters?: unknown) =>
        invokeDb('db:audit-logs:listByDate', { from, to, filters }),
      insert: (log: unknown) => invokeDb('db:audit-logs:insert', log),
    },

    inventoryTransactions: {
      listByItem: (itemId: string, limit?: number) =>
        invokeDb('db:inventory-transactions:listByItem', { itemId, limit }),
      listByShift: (shiftId: string) =>
        invokeDb('db:inventory-transactions:listByShift', shiftId),
    },

    meta: {
      setSyncCursor: (cursor: Record<string, string | number>) =>
        invokeDb('db:meta:setSyncCursor', cursor),
      getSyncCursor: () => invokeDb('db:meta:getSyncCursor'),
      setLastAuth: (auth: unknown) => invokeDb('db:meta:setLastAuth', auth),
      getLastAuth: () => invokeDb('db:meta:getLastAuth'),
    },

    tableSessions: {
      openOrGet: (payload: unknown) =>
        invokeDb('db:table-sessions:openOrGet', payload),
      getById: (id: string) => invokeDb('db:table-sessions:getById', id),
      getOpenForTable: (tableId: string) =>
        invokeDb('db:table-sessions:getOpenForTable', tableId),
      listOpen: (branchId?: string) =>
        invokeDb('db:table-sessions:listOpen', branchId),
      listRecent: (branchId?: string, limit?: number) =>
        invokeDb('db:table-sessions:listRecent', branchId, limit),
      replaceCartItems: (payload: unknown) =>
        invokeDb('db:table-sessions:replaceCartItems', payload),
      updateStatus: (payload: unknown) =>
        invokeDb('db:table-sessions:updateStatus', payload),
    },

    tableSessionLedger: {
      listForSession: (sessionId: string) =>
        invokeDb('db:table-session-ledger:listForSession', sessionId),
      appendNote: (payload: unknown) =>
        invokeDb('db:table-session-ledger:appendNote', payload),
    },

    reports: {
      periodSales: (opts: unknown) =>
        invokeDb('db:reports:periodSales', opts),
      availableYears: (scope?: unknown) =>
        invokeDb('db:reports:availableYears', scope),
    },
  },

  sync: {
    requestNow: () => ipcRenderer.invoke('sync:request-now'),
    subscribeStatus: (cb: (status: unknown) => void) =>
      ipcRenderer.on('sync:status-changed', (_e, s) => cb(s)),
    unsubscribeStatus: () =>
      ipcRenderer.removeAllListeners('sync:status-changed'),
  },

  print: {
    testPage: () => ipcRenderer.invoke('print:test-page'),
    receipt: (orderId: string, copy = 1) =>
      ipcRenderer.invoke('print:receipt', { orderId, copy }),
    kitchenTicket: (orderId: string) =>
      ipcRenderer.invoke('print:kitchen-ticket', { orderId }),
    listPrinters: () => ipcRenderer.invoke('print:list-printers'),
    getQueueStatus: () => ipcRenderer.invoke('print:queue-status'),
  },

  customerDisplay: {
    showIdle: () => ipcRenderer.invoke('customer:show-idle'),
    showOrder: (orderPreview: unknown) =>
      ipcRenderer.invoke('customer:show-order', orderPreview),
    showPaid: (order: unknown) => ipcRenderer.invoke('customer:show-paid', order),
  },

  shifts: {
    openShift: (data: unknown) => ipcRenderer.invoke('shift:open', data),
    closeShift: (data: unknown) => ipcRenderer.invoke('shift:close', data),
    getOpenShift: () => ipcRenderer.invoke('shift:get-open'),
  },
});

export type ElectronAPI = typeof window.electronAPI;
