'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../lib/auth-store';
import { useCartStore } from '../../lib/cart-store';
import { formatCentsToNgn } from '../../lib/ui-helpers';
import type { ConnectionPillState, OpenShiftState } from '../../lib/types';
import { pinLogin } from '../../lib/remote-auth';
import { fetchPublicMenu } from '../../lib/remote-menu';
import { fetchPosBootstrap } from '../../lib/remote-pos';
import { applyRemoteMenuSnapshot } from '../../lib/mock-electron-shim';
import Header from './Header';
import MenuGrid from './MenuGrid';
import CartPanel from './CartPanel';
import ShiftModal from './ShiftModal';
import TableTabDetailsModal from './TableTabDetailsModal';
import ManagerTools from './ManagerTools';

type SidebarTab = 'MENU' | 'TABLES' | 'HISTORY' | 'SHIFT' | 'REPORTS' | 'MANAGER';

const SIDEBAR_TABS_BASE: { id: SidebarTab; label: string; icon: string; desc: string }[] = [
  { id: 'MENU', label: 'Menu', icon: '🍽️', desc: 'Browse menu & add items' },
  { id: 'TABLES', label: 'Tables', icon: '🪑', desc: 'Floor plan & table service' },
  { id: 'HISTORY', label: 'History', icon: '📋', desc: 'Live orders & recall' },
  { id: 'SHIFT', label: 'Shift', icon: '🕒', desc: 'Open / close your shift' },
  { id: 'REPORTS', label: 'Reports', icon: '📊', desc: 'Sales performance' },
];
const SIDEBAR_TABS_MANAGER: { id: SidebarTab; label: string; icon: string; desc: string } = {
  id: 'MANAGER',
  label: 'Manager',
  icon: '🛠️',
  desc: 'Edit menu, items & categories',
};
// Roles that are allowed to view Manager Tools tab (MENU_EDIT permission maps to these
// RBAC matrix in server rbac.service.ts default for MANAGER/ADMIN/SUPER_ADMIN).
const MANAGER_TAB_ROLES = new Set([
  'MANAGER',
  'SUPERVISOR',
  'ADMIN',
  'SUPER_ADMIN',
  'OWNER',
]);
// Combined static metadata array for places that need to look up any tab's
// label/icon (e.g. PlaceholderPanel icon). The runtime sidebar rendering uses
// the dynamic role-gated `sidebarTabs` computed inside the component.
const ALL_SIDEBAR_TABS_META = [...SIDEBAR_TABS_BASE, SIDEBAR_TABS_MANAGER];

const ORDER_STATUS_STYLES: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  NEW: { bg: 'bg-[linear-gradient(120deg,rgba(34,211,238,0.20),rgba(251,191,36,0.14))]', text: 'text-cyan-200', dot: 'status-dot-new', label: 'New' },
  PREPARING: { bg: 'bg-[linear-gradient(120deg,rgba(251,191,36,0.20),rgba(234,88,12,0.14))]', text: 'text-amber-200', dot: 'status-dot-preparing', label: 'Preparing' },
  READY: { bg: 'bg-[linear-gradient(120deg,rgba(167,139,250,0.20),rgba(212,175,55,0.14))]', text: 'text-violet-200', dot: 'status-dot-ready', label: 'Ready' },
  DELIVERED: { bg: 'bg-[linear-gradient(120deg,rgba(16,185,129,0.20),rgba(212,175,55,0.14))]', text: 'text-emerald-200', dot: 'status-dot-delivered', label: 'Delivered' },
  CLOSED: { bg: 'bg-slate-700/30', text: 'text-slate-300', dot: 'status-dot-closed', label: 'Closed' },
  COMPLETED: { bg: 'bg-slate-700/30', text: 'text-slate-300', dot: 'status-dot-closed', label: 'Completed' },
  ON_HOLD: { bg: 'bg-[linear-gradient(120deg,rgba(205,127,50,0.22),rgba(234,88,12,0.16))]', text: 'text-amber-200', dot: 'status-dot-hold', label: 'On Hold' },
  CANCELLED: { bg: 'bg-rose-500/15', text: 'text-rose-200', dot: 'bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.7)] rounded-full h-2.5 w-2.5 inline-block', label: 'Cancelled' },
};

const TABLE_STATUS_TINTS: Record<string, { ring: string; bg: string; label: string; dot: string; text: string }> = {
  AVAILABLE: { ring: 'ring-emerald-400/40', bg: 'from-emerald-500/18 to-transparent', label: 'Available', dot: 'bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.7)]', text: 'text-emerald-200' },
  OCCUPIED: { ring: 'ring-amber-400/60', bg: 'from-amber-500/28 via-[#CD7F32]/20 to-transparent', label: 'Occupied', dot: 'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.8)] animate-pulse-soft', text: 'text-amber-200' },
  RESERVED: { ring: 'ring-violet-400/50', bg: 'from-violet-500/22 to-transparent', label: 'Reserved', dot: 'bg-violet-400 shadow-[0_0_10px_rgba(167,139,250,0.7)]', text: 'text-violet-200' },
  CLEANING: { ring: 'ring-cyan-400/40', bg: 'from-cyan-500/22 to-transparent', label: 'Cleaning', dot: 'bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.7)]', text: 'text-cyan-200' },
};

// Persistent popup-window reference for the customer-facing display.
// Lives at module scope so React re-mounts (StrictMode double-mount, HMR, or
// re-renders from auth state transitions) won't lose the handle and spawn
// duplicate windows on every click of the 🖥️ Display button.
let _customerDisplayWindow: Window | null = null;

// Reactive tick: forces the button to re-render so its "active" amber
// highlight reflects the current closed/alive state of the popup.
function useCustomerDisplayAlive(): boolean {
  const [alive, setAlive] = useState<boolean>(false);
  useEffect(() => {
    const id = window.setInterval(() => {
      const next = !!_customerDisplayWindow && !_customerDisplayWindow.closed;
      setAlive((prev) => (prev !== next ? next : prev));
    }, 750);
    return () => window.clearInterval(id);
  }, []);
  return alive;
}

export default function CashierScreenLayout() {
  const navigate = useNavigate();
  const { employee, branch, restaurant } = useAuthStore();
  const accessToken = useAuthStore((s) => s.accessToken);
  const loginMode = useAuthStore((s) => s.loginMode);
  const offlinePin = useAuthStore((s) => s.offlinePin);
  const authActions = useAuthStore((s) => s.actions);
  const cartActions = useCartStore((s) => s.actions);
  const [activeTab, setActiveTab] = useState<SidebarTab>('MENU');

  // Role-gated sidebar tabs: MANAGER tab rail is only shown to
  // MANAGER/ADMIN/SUPER_ADMIN/OWNER roles per RBAC matrix (MENU_EDIT).
  const sidebarTabs = useMemo(() => {
    const tabs = [...SIDEBAR_TABS_BASE];
    if (employee && MANAGER_TAB_ROLES.has(String(employee.role))) {
      tabs.push(SIDEBAR_TABS_MANAGER);
    }
    return tabs;
  }, [employee?.role]);

  // Reactive visual indicator for the 🖥️ Display sidebar button (amber when
  // the customer-facing popup window is open; ink-300 when closed).
  const displayAlive = useCustomerDisplayAlive();

  const [connection, setConnection] = useState<ConnectionPillState>({
    status: 'OFFLINE',
    pendingCount: 0,
    failedCount: 0,
  });

  const [openShift, setOpenShift] = useState<OpenShiftState>({
    shiftId: null,
    openedAt: null,
    openingCashCents: null,
  });

  const [showShiftModal, setShowShiftModal] = useState<'OPEN' | 'CLOSE' | null>(null);
  const [shiftLoaded, setShiftLoaded] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // --- Mark-as-Paid modal state (for QR table "Pay at Counter" and Website
  // online orders that the attendant manually confirms as paid at the POS).
  type CounterTender = 'CASH' | 'CARD_POS' | 'BANK_TRANSFER';
  const [markPaidTarget, setMarkPaidTarget] = useState<any | null>(null);
  const [markPaidMethod, setMarkPaidMethod] = useState<CounterTender>('CASH');
  const [markPaidAmountCents, setMarkPaidAmountCents] = useState<number>(0);
  const [markPaidNote, setMarkPaidNote] = useState<string>('');
  const [markPaidBusy, setMarkPaidBusy] = useState<boolean>(false);

  // --- Incoming web/QR order notification state -----------------------------
  // Active notification cards surfaced to the attendant. useState for render.
  const [incomingWebOrders, setIncomingWebOrders] = useState<any[]>([]);
  // Audio bell — toggleable (on by default). useState for render chip text.
  const [notifSoundOn, setNotifSoundOn] = useState<boolean>(true);

  // === Refs (NOT state) so the 8s setInterval callback reads LATEST values.
  // The interval is registered in a useEffect([]) once and would otherwise
  // close over the very first render's state forever (stale-closure bug).
  // Refs have a single mutable .current identity so stale closures are safe.
  /** Which external (non-POS) order ids we've already surfaced to the rail. */
  const seenExternalOrderIdsRef = useRef<Set<string>>(new Set());
  /** False only on the VERY first hydration. Prevents spamming 20 historical
   *  order notifications on POS login; flipped once (true) after first call. */
  const initialHydrationDoneRef = useRef<boolean>(false);
  /** Mirror of notifSoundOn so `playOrderBell` reads the user's latest toggle
   *  even when called from the stale-interval closure. */
  const notifSoundOnRef = useRef<boolean>(true);
  // Keep the ref mirror 1:1 with state every render (cheap assignment).
  notifSoundOnRef.current = notifSoundOn;

  useEffect(() => {
    if (!accessToken || !branch?.id) return;
    if (String(connection.status || '').toUpperCase() !== 'ONLINE') return;

    let alive = true;
    const refreshReferenceData = async () => {
      try {
        const bootstrap = await fetchPosBootstrap({ accessToken });
        await window.electronAPI?.db?.employees?.applySnapshot?.(bootstrap.employees);
        await window.electronAPI?.db?.tables?.applySnapshot?.(bootstrap.tables);
      } catch {
      }

      try {
        const menu = await fetchPublicMenu(String(branch.id), undefined);
        // Write to BOTH cache layers so the admin-uploaded menu is visible in
        // every component regardless of where it reads from:
        //  (a) browser-mode in-memory mock shim snapshot (applyRemoteMenuSnapshot)
        //  (b) desktop-mode Electron SQLite (window.electronAPI.db.menu.applySnapshot)
        applyRemoteMenuSnapshot({
          categories: menu.categories,
          items: menu.items,
          modifiers: menu.modifiers,
        });
        await window.electronAPI?.db?.menu?.applySnapshot?.({
          categories: menu.categories,
          items: menu.items,
          modifiers: menu.modifiers,
        });
      } catch {
      }
    };

    void refreshReferenceData();
    // 15s polling: every admin-uploaded menu item shows up within one cashier
    // interactive cycle (add-to-cart). Previously 60s which felt like "never
    // updated" to managers watching POS after admin uploads.
    const t = setInterval(() => {
      if (!alive) return;
      void refreshReferenceData();
    }, 15000);

    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [accessToken, branch?.id, connection.status]);

  // Runtime data for advanced panels
  const [tables, setTables] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [tableSessions, setTableSessions] = useState<any[]>([]);
  const [historyFilter, setHistoryFilter] = useState<string>('ALL');
  // Date range filter for History — null = no range (all time). Stored as ISO strings yyyy-mm-dd for <input type=date>.
  const [historyDateStart, setHistoryDateStart] = useState<string | null>(null);
  const [historyDateEnd, setHistoryDateEnd] = useState<string | null>(null);
  const [tablesZone, setTablesZone] = useState<string>('ALL');
  // Dedicated tab-details modal. Opened either from the Cart rail "View Tab" or
  // directly by tapping the tab-number badge on an occupied table card.
  const [tabDetails, setTabDetails] = useState<{
    open: boolean;
    tableId?: string;
    tableName?: string;
    sessionId?: string;
  }>({ open: false });

  useEffect(() => {
    if (!employee && !branch) {
      console.log('[pos] not authenticated, redirecting');
      navigate('/login', { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee, branch]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const syncSub = (s: any) => {
          if (!alive) return;
          setConnection((prev) => ({
            ...prev,
            status: s?.status || prev.status,
            lastSuccessfulAt: s?.lastSyncAt || s?.lastSuccessfulAt || prev.lastSuccessfulAt,
          }));
          if (
            String(s?.status || '').toUpperCase() === 'ONLINE' &&
            loginMode === 'OFFLINE_PIN' &&
            offlinePin &&
            branch?.id
          ) {
            (async () => {
              try {
                const device = await window.electronAPI?.getDeviceId?.();
                const deviceId = device?.deviceId;
                const res: any = await pinLogin({
                  pin: offlinePin,
                  branchId: branch.id,
                  deviceId,
                });
                const emp = res?.employee || null;
                const usr = res?.user || null;
                const rst = res?.restaurant || null;
                const br = res?.branch || null;
                const accessToken = res?.accessToken;
                const refreshToken = res?.refreshToken;
                const expiresIn = res?.expiresIn;

                if (!emp?.id || !usr?.id || !br?.id || !rst?.id || !accessToken) {
                  return;
                }

                const employeeRecord = {
                  id: emp.id,
                  userId: usr.id,
                  firstName: usr.firstName,
                  lastName: usr.lastName,
                  email: usr.email,
                  phone: usr.phone,
                  role: emp.role,
                  branchId: emp.branchId,
                  restaurantId: emp.restaurantId,
                };

                await window.electronAPI?.db?.employees?.upsertWithPin?.(employeeRecord, offlinePin);
                authActions.setOnlineLogin({
                  employee: employeeRecord,
                  restaurant: rst,
                  branch: { ...br, restaurant: rst },
                  accessToken,
                  refreshToken,
                  expiresIn,
                  deviceId,
                });
                await window.electronAPI?.sync?.requestNow?.();
              } catch {
              }
            })();
          }
        };
        window.electronAPI?.sync?.subscribeStatus?.(syncSub);

        const st: any = await window.electronAPI?.getConnectionStatus?.();
        const counts: any = (await window.electronAPI?.db?.syncQueue?.getCounts?.()) || {};
        if (alive) {
          setConnection({
            status: st?.status || 'OFFLINE',
            pendingCount: counts?.pending || 0,
            failedCount: counts?.failed || 0,
            lastSuccessfulAt: st?.lastSuccessfulAt || st?.lastSyncAt,
          });
        }

        // Load panels data (tables + orders) independently of shift.
        try {
          const tbl: any = (await window.electronAPI?.db?.tables?.list?.()) || [];
          if (alive) setTables(Array.isArray(tbl) ? tbl : (tbl?.data as any[]) || []);
        } catch { /* ignore */ }
        try {
          const ord =
            (await window.electronAPI?.db?.orders?.listRecent?.(200)) ??
            (await window.electronAPI?.db?.orders?.list?.());
          const list = Array.isArray(ord) ? ord : ((ord as any)?.data as any[]) || [];
          const isRowShape =
            list.length > 0 &&
            (Object.prototype.hasOwnProperty.call(list[0] as any, 'order_number') ||
              Object.prototype.hasOwnProperty.call(list[0] as any, 'total_cents'));
          if (!isRowShape) {
            // Browser mock-shim returns pure camelCase already: no conversion
            // needed. But we MUST still apply the same visibility + diffing
            // pipeline as the snake→camel path: employee filter (show external
            // OR own orders) and detectAndQueueExternalOrders for the rail.
            // Otherwise the notification rail stays empty in browser demo.
            const eidCamel = employee?.id ? String(employee.id) : '';
            const filteredCamel = list.filter((o: any) => {
              const src = String(o.source || o.sourceChannel || 'POS').toUpperCase();
              const isExternal = src !== 'POS';
              // Normalize the source key to sourceChannel so downstream code
              // (rail cards, HistoryPanel chips) sees a consistent shape.
              if (!o.sourceChannel && o.source) o.sourceChannel = o.source;
              const isOwn = eidCamel ? String(o.employeeId || '') === eidCamel : true;
              return isExternal || isOwn;
            });
            if (alive) {
              detectAndQueueExternalOrders(filteredCamel);
              setOrders(filteredCamel);
            }
          } else {
            const itemsByOrderId = new Map<string, any[]>();
            await Promise.all(
              list.map(async (r: any) => {
                const items: any =
                  (await window.electronAPI?.db?.orderItems?.listForOrderId?.(String(r.id))) ||
                  [];
                itemsByOrderId.set(String(r.id), Array.isArray(items) ? items : []);
              })
            );
            const tableById = new Map<string, any>();
            for (const t of tables) tableById.set(String(t.id), t);
            const hydrated = list.map((r: any) => {
              const tbl = r.table_id ? tableById.get(String(r.table_id)) : null;
              const items = itemsByOrderId.get(String(r.id)) || [];
              return {
                id: String(r.id),
                orderNumber: String(r.order_number || ''),
                orderType: r.order_type || undefined,
                sourceChannel: r.source || 'POS',
                tableId: r.table_id || undefined,
                tableName: tbl?.name || r.table_name || undefined,
                employeeId: r.employee_id || undefined,
                customerName: r.customer_name || undefined,
                customerPhone: r.customer_phone || undefined,
                customerEmail: r.customer_email || undefined,
                status: r.status || 'NEW',
                paymentStatus: r.payment_status || 'UNPAID',
                paymentMethod: r.payment_method || undefined,
                totalAmount: typeof r.total_cents === 'number' ? r.total_cents / 100 : 0,
                paidAmount: typeof r.paid_amount_cents === 'number' ? r.paid_amount_cents / 100 : 0,
                balanceDue: typeof r.balance_due_cents === 'number' ? r.balance_due_cents / 100 : 0,
                notes: r.note || undefined,
                createdAt: typeof r.created_at === 'number' ? r.created_at : Date.now(),
                updatedAt: typeof r.updated_at === 'number' ? r.updated_at : Date.now(),
                items: items.map((it: any) => ({
                  menuItemId: it.menu_item_id,
                  name: it.name_snapshot,
                  unitPrice:
                    typeof it.price_snapshot_cents === 'number' ? it.price_snapshot_cents / 100 : 0,
                  quantity: it.quantity,
                  selectedModifiers: [],
                  notes: it.special_instructions || undefined,
                })),
              };
            });
            const eid = employee?.id ? String(employee.id) : '';
            // Show this employee's own POS orders, PLUS ANY external-order from
            // web/QR/phone/app regardless of which employee (or null) attached.
            // External orders come through with sourceChannel !== POS and must
            // be visible to ALL logged-in POS attendants, not hidden behind
            // the employee-scoped filter.
            const filtered = hydrated.filter((o: any) => {
              const isExternal = String(o.sourceChannel || 'POS').toUpperCase() !== 'POS';
              const isOwn = eid ? String(o.employeeId || '') === eid : true;
              return isExternal || isOwn;
            });
            if (alive) {
              detectAndQueueExternalOrders(filtered);
              setOrders(filtered);
            }
          }
        } catch { /* ignore */ }

        // Load running-table sessions so table cards can show live balance / tab
        // number directly on the floor plan.
        try {
          const sessions =
            (await window.electronAPI?.db?.tableSessions?.listOpen?.()) ?? [];
          if (Array.isArray(sessions) && alive) setTableSessions(sessions);
        } catch { /* ignore */ }
      } catch (e) {
        console.warn('[pos] init error', e);
      }
    })();

    const t = setInterval(async () => {
      try {
        const counts: any = (await window.electronAPI?.db?.syncQueue?.getCounts?.()) || {};
        setConnection((prev) => ({
          ...prev,
          pendingCount: counts?.pending ?? prev.pendingCount,
          failedCount: counts?.failed ?? prev.failedCount,
        }));
        const ord =
          (await window.electronAPI?.db?.orders?.listRecent?.(200)) ??
          (await window.electronAPI?.db?.orders?.list?.());
        const list = Array.isArray(ord) ? ord : ((ord as any)?.data as any[]) || [];
        const isRowShape =
          list.length > 0 &&
          (Object.prototype.hasOwnProperty.call(list[0] as any, 'order_number') ||
            Object.prototype.hasOwnProperty.call(list[0] as any, 'total_cents'));
        if (!isRowShape) {
          // Mirror of the init camelCase branch. Apply the same employee
          // filter + detect diffing so 8-second interval ticks continue to
          // surface new external orders in browser mock mode.
          const eidCamel2 = employee?.id ? String(employee.id) : '';
          const filteredCamel2 = list.filter((o: any) => {
            const src = String(o.source || o.sourceChannel || 'POS').toUpperCase();
            const isExternal = src !== 'POS';
            if (!o.sourceChannel && o.source) o.sourceChannel = o.source;
            const isOwn = eidCamel2 ? String(o.employeeId || '') === eidCamel2 : true;
            return isExternal || isOwn;
          });
          detectAndQueueExternalOrders(filteredCamel2);
          setOrders(filteredCamel2);
        } else {
          const itemsByOrderId = new Map<string, any[]>();
          await Promise.all(
            list.map(async (r: any) => {
              const items: any =
                (await window.electronAPI?.db?.orderItems?.listForOrderId?.(String(r.id))) || [];
              itemsByOrderId.set(String(r.id), Array.isArray(items) ? items : []);
            })
          );
          const tableById = new Map<string, any>();
          for (const t of tables) tableById.set(String(t.id), t);
          const hydrated = list.map((r: any) => {
            const tbl = r.table_id ? tableById.get(String(r.table_id)) : null;
            const items = itemsByOrderId.get(String(r.id)) || [];
            return {
              id: String(r.id),
              orderNumber: String(r.order_number || ''),
              orderType: r.order_type || undefined,
              sourceChannel: r.source || 'POS',
              tableId: r.table_id || undefined,
              tableName: tbl?.name || r.table_name || undefined,
              employeeId: r.employee_id || undefined,
              customerName: r.customer_name || undefined,
              customerPhone: r.customer_phone || undefined,
              customerEmail: r.customer_email || undefined,
              status: r.status || 'NEW',
              paymentStatus: r.payment_status || 'UNPAID',
              paymentMethod: r.payment_method || undefined,
              totalAmount: typeof r.total_cents === 'number' ? r.total_cents / 100 : 0,
              paidAmount: typeof r.paid_amount_cents === 'number' ? r.paid_amount_cents / 100 : 0,
              balanceDue: typeof r.balance_due_cents === 'number' ? r.balance_due_cents / 100 : 0,
              notes: r.note || undefined,
              createdAt: typeof r.created_at === 'number' ? r.created_at : Date.now(),
              updatedAt: typeof r.updated_at === 'number' ? r.updated_at : Date.now(),
              items: items.map((it: any) => ({
                menuItemId: it.menu_item_id,
                name: it.name_snapshot,
                unitPrice:
                  typeof it.price_snapshot_cents === 'number' ? it.price_snapshot_cents / 100 : 0,
                quantity: it.quantity,
                selectedModifiers: [],
                notes: it.special_instructions || undefined,
              })),
            };
          });
          const eid = employee?.id ? String(employee.id) : '';
          // Mirror of init hydration: own POS orders + ALL external orders from
          // web/QR/phone/app are visible regardless of employeeId.
          const filtered = hydrated.filter((o: any) => {
            const isExternal = String(o.sourceChannel || 'POS').toUpperCase() !== 'POS';
            const isOwn = eid ? String(o.employeeId || '') === eid : true;
            return isExternal || isOwn;
          });
          detectAndQueueExternalOrders(filtered);
          setOrders(filtered);
        }

        // Also refresh open running tabs so floor-plan badges stay live
        try {
          const sessions =
            (await window.electronAPI?.db?.tableSessions?.listOpen?.()) ?? [];
          if (Array.isArray(sessions)) setTableSessions(sessions);
        } catch {
          /* ignore */
        }
      } catch {
        /* ignore */
      }
    }, 8000);

    return () => {
      alive = false;
      clearInterval(t);
      window.electronAPI?.sync?.unsubscribeStatus?.();
      // Reset notification-diffing refs on unmount. In development, React 18
      // StrictMode runs effect -> cleanup -> effect on every mount, simulating
      // unmount/remount to catch cleanup bugs. If we do NOT reset these refs
      // here, the discarded mount #1 flips initialHydrationDone=true and
      // populates seenExternalOrderIds, so mount #2 (the real one) sees
      // firstTime=false + newlyArrived=[] and incomingWebOrders stays empty
      // forever = NO NOTIFICATION RAIL on login. Resetting gives each mount
      // its own "first login" surface as expected.
      seenExternalOrderIdsRef.current = new Set();
      initialHydrationDoneRef.current = false;
    };
    // General bootstrap only runs once; shift restoration lives below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore the active OPEN shift scoped to the current employee + branch.
  // Runs once as soon as we have auth identifiers, OR whenever they change
  // (e.g. the same cashier logs out then back in on the same terminal, or a
  // different cashier takes over — the latter correctly returns no match and
  // forces a fresh Open Shift flow).
  useEffect(() => {
    const eid = employee?.id;
    const bid = branch?.id;
    const rid = restaurant?.id;
    // Only attempt a restore once we have both an employee and a branch id.
    if (!eid || !bid) return;
    let active = true;
    (async () => {
      try {
        // Pass the scoping filter so mock shim and Electron both use the
        // same (employee, branch, restaurant) boundary — prevents a
        // different cashier on the same terminal from inheriting someone
        // else's open shift, and ensures restore works after refresh/logout.
        const open: any = await window.electronAPI?.db?.shifts?.getOpen?.({
          employeeId: eid,
          branchId: bid,
          restaurantId: rid,
        });
        if (!active) return;
        if (open && (open.id || open.shiftId)) {
          // Normalize property names — Electron/SQLite uses snake_case
          // (opening_cash_cents, opened_at) while the mock shim may also
          // expose camelCase aliases. Check all variants and take the
          // first defined value.
          const openingCents =
            typeof open.opening_cash_cents === 'number'
              ? open.opening_cash_cents
              : typeof open.openingCashCents === 'number'
                ? open.openingCashCents
                : typeof open.openingCash === 'number'
                  ? Math.round(open.openingCash * 100)
                  : null;
          const openedMs =
            typeof open.opened_at === 'number'
              ? open.opened_at
              : typeof open.openedAt === 'number'
                ? open.openedAt
                : open.openedAt
                  ? new Date(open.openedAt).getTime()
                  : Date.now();
          setOpenShift({
            shiftId: open.id || open.shiftId,
            openedAt: openedMs,
            openingCashCents: openingCents,
          });
        }
      } catch (e) {
        console.warn('[pos] shift restore failed', e);
      } finally {
        if (active) setShiftLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [employee?.id, branch?.id, restaurant?.id]);

  useEffect(() => {
    if (!shiftLoaded) return;
    // Only prompt to open a NEW shift if there is truly no active OPEN shift
    // already on record. If the user already has a shift open (surviving a
    // refresh or a logout → login), we keep using that shift until they
    // explicitly end it via the CLOSE modal.
    if (!openShift.shiftId) {
      setShowShiftModal('OPEN');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftLoaded]);

  const flashToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2800);
  };

  // --- Incoming external-order (QR/website) notification helpers ------------
  // Short double-beep using WebAudio so no asset file is needed.
  // Reads sound pref from REF (not state) so even the stale 8s interval
  // closure picks up the user's latest bell toggle.
  const playOrderBell = () => {
    if (!notifSoundOnRef.current) return;
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const now = ctx.currentTime;
      const beep = (t: number, dur = 0.16, freq = 880, vol = 0.18) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + dur + 0.02);
      };
      beep(now, 0.14, 880, 0.22);
      beep(now + 0.20, 0.18, 1175, 0.22);
      setTimeout(() => { try { ctx.close(); } catch {} }, 800);
    } catch { /* audio best-effort only */ }
  };

  // Given the freshly hydrated order list, diff against the REF-held set of
  // seen external order ids, push new arrivals into the notification card
  // stack, and play the bell.
  //
  // BEHAVIOR:
  //   First-time call (cashier just logged in):
  //     • Prime the seenExternalOrderIdsRef (prevents duplicates on re-renders)
  //     • Push ALL currently UNPAID / PARTIALLY_PAID external orders into the
  //       rail, but WITHOUT the bell. A cashier clocking in at 11:29 needs to
  //       see the Pay-at-Counter QR table orders that arrived at 11:20.
  //     • Do NOT push already-PAID / REFUNDED completed external orders to the
  //       rail on login — those are informational only in the History tab.
  //     • No toast flash / no bell so the POS doesn't ring on login.
  //
  //   Subsequent 8s refresh calls:
  //     • Only push genuinely NEW ids (not in the ref) into the rail.
  //     • Ring bell + flash toast for each new arrival batch.
  //
  // Uses ONLY refs for diffing state so this function is 100% safe to call
  // from the 8s setInterval (which captures a stale first-render closure and
  // would otherwise always see "no seen ids yet / firstTime=true" forever).
  const detectAndQueueExternalOrders = (freshOrders: any[]) => {
    const external = freshOrders.filter(
      (o: any) => String(o.sourceChannel || 'POS').toUpperCase() !== 'POS'
    );
    const previous = seenExternalOrderIdsRef.current;
    const newlyArrived: any[] = [];
    const newSeen = new Set(previous);
    for (const o of external) {
      if (!o?.id) continue;
      newSeen.add(String(o.id));
      if (!previous.has(String(o.id))) newlyArrived.push(o);
    }
    seenExternalOrderIdsRef.current = newSeen;
    // ----- Belt-and-suspenders silent surface-of-unpaid on EVERY tick ------
    // Runs regardless of firstTime to ensure no unpaid external order ever
    // silently sits in the DB with no notification card showing. Catches
    // edge cases (StrictMode double-mount ref poisoning, HMR, race
    // conditions between init/interval hydration) where the firstTime
    // branch is swallowed and leaves incomingWebOrders empty even though
    // there are unpaid QR/website orders. This merge is silent: NO bell,
    // NO toast. Only brand-new *post-login* arrivals get the bell/toast.
    const unpaidExternal = freshOrders.filter((o: any) => {
      if (String(o.sourceChannel || 'POS').toUpperCase() === 'POS') return false;
      const ps = String(o.paymentStatus || 'UNPAID').toUpperCase();
      return ps !== 'PAID' && ps !== 'REFUNDED';
    });
    if (unpaidExternal.length > 0) {
      setIncomingWebOrders((prev) => {
        const alreadyTracked = new Set(prev.map((p: any) => String(p.id)));
        const toAdd = unpaidExternal.filter((n) => !alreadyTracked.has(String(n.id)));
        if (toAdd.length === 0) return prev;
        return [...toAdd, ...prev].slice(0, 10);
      });
    }
    // -----------------------------------------------------------------------
    const firstTime = !initialHydrationDoneRef.current;
    initialHydrationDoneRef.current = true;
    if (firstTime) {
      // On POS login: surface any still-open (not PAID / not REFUNDED) external
      // orders into the notification rail. Skip already completed orders — if
      // the order is already fully paid, notification is unnecessary noise on
      // login (it's still visible in the History tab if they need to look).
      // Bell + toast are suppressed — they only ring for *new arrivals while
      // the cashier is actively on shift*.
      // NOTE: actual merging of unpaid orders is now handled by the
      // belt-and-suspenders block above; this branch exists purely to
      // short-circuit the bell/toast for the login tick.
      return;
    }
    if (newlyArrived.length > 0) {
      playOrderBell();
      setIncomingWebOrders((prev) => {
        const alreadyTracked = new Set(prev.map((p: any) => String(p.id)));
        const merged = [...newlyArrived.filter((n) => !alreadyTracked.has(String(n.id))), ...prev];
        return merged.slice(0, 10);
      });
      flashToast(`🔔 ${newlyArrived.length} new web/table order${newlyArrived.length === 1 ? '' : 's'}`);
    }
  };

  // Shortcut handlers for notification card actions.
  const ackIncomingOrder = (orderId: string) => {
    setIncomingWebOrders((prev) => prev.filter((p: any) => String(p.id) !== String(orderId)));
  };
  const recallIncomingOrder = async (order: any) => {
    ackIncomingOrder(order.id);
    await recallOrder(order);
  };
  const markPaidIncomingOrder = (order: any) => {
    ackIncomingOrder(order.id);
    openMarkPaid(order);
  };

  // Recall a held or previous order into the cart
  const recallOrder = async (order: any) => {
    try {
      cartActions.clear();
      if (order.tableId) cartActions.setTable(order.tableId, order.tableName || '');
      if (order.orderType) cartActions.setOrderType(order.orderType);
      if (order.notes) cartActions.setNote(order.notes);
      // Rebuild cart lines from items; use demo menu lookup to carry modifiers
      const allItems: any = (await window.electronAPI?.db?.menuItems?.list?.()) || [];
      const menu = Array.isArray(allItems) ? allItems : (allItems?.data as any[]) || [];
      for (const it of order.items || []) {
        const menuItem = menu.find((m: any) => m.id === it.menuItemId) || {
          id: it.menuItemId,
          name: it.name,
          price: it.unitPrice,
          status: 'AVAILABLE',
          modifiers: [],
        };
        cartActions.addItem(menuItem, it.quantity || 1, it.selectedModifiers || []);
      }
      flashToast(`📂 Recalled ${order.orderNumber || order.id} into cart`);
      setActiveTab('MENU');
    } catch (e) {
      console.warn(e);
      flashToast('Recall failed — try Menu tab.');
    }
  };

  // Transition order status
  const bumpOrderStatus = async (order: any) => {
    const flow = ['NEW', 'PREPARING', 'READY', 'DELIVERED', 'CLOSED'];
    const cur = order.status || 'NEW';
    const idx = flow.indexOf(cur);
    const next = idx >= 0 && idx < flow.length - 1 ? flow[idx + 1] : 'COMPLETED';
    try {
      await window.electronAPI?.db?.orders?.updateStatus?.(order.id, next);
      setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, status: next, updatedAt: Date.now() } : o)));
      flashToast(`⬆️ ${order.orderNumber || order.id} → ${next}`);
    } catch (e) {
      console.warn(e);
    }
  };

  // --- Mark-as-Paid (counter-attendant workflow) ----------------------------
  // Opens the confirm overlay for an unpaid order. Defaults the paid amount
  // to the remaining balance (total - already paid) so attendants rarely need
  // to edit the number on split-pay second+ attempts.
  const openMarkPaid = (order: any) => {
    const totalCents = Math.round((order.totalAmount || 0) * 100);
    const priorPaid = Math.round((order.paidAmount || 0) * 100);
    const remaining = Math.max(0, totalCents - priorPaid);
    setMarkPaidTarget(order);
    setMarkPaidMethod('CASH');
    setMarkPaidAmountCents(remaining > 0 ? remaining : totalCents);
    setMarkPaidNote('');
    setMarkPaidBusy(false);
  };

  const closeMarkPaid = () => {
    setMarkPaidTarget(null);
    setMarkPaidBusy(false);
  };

  // Atomic: calls updatePaymentStatus IPC (writes order patch + Payment
  // ledger row), optimistically updates the local orders state, auto-prints
  // a 2-copy customer+cashier receipt, and offers a 1-click path to bump the
  // order to DELIVERED when balance reaches zero.
  //
  // CRITICAL SYNC-TO-ADMIN: After the local SQLite transaction succeeds, we
  // enqueue ORDER UPDATE (payment patch) + PAYMENT CREATE (ledger row) sync
  // commands so the cloud push worker (or browser mock-shim bridge) POSTs
  // them to backend /sync/batch — this is what makes admin section reflect
  // "Mark as Paid" changes instead of only showing POS-local updates.
  // Compare: PaymentModal lines 355-372 and CartPanel lines 238-246.
  const handleMarkPaidConfirm = async () => {
    if (!markPaidTarget || markPaidBusy) return;
    setMarkPaidBusy(true);
    const oid = markPaidTarget.id;
    try {
      const res: any = await window.electronAPI?.db?.orders?.updatePaymentStatus?.(oid, {
        paymentStatus: 'PAID',
        method: markPaidMethod,
        paidAmountCents: markPaidAmountCents,
        note: markPaidNote || undefined,
        employeeId: employee?.id,
        employeeName: employee?.firstName
          ? `${employee.firstName} ${employee.lastName || ''}`.trim()
          : undefined,
        shiftId: openShift.shiftId || undefined,
      });

      // Optimistically patch the order row into local state so chips update
      // instantly instead of waiting for the next 8s refresh cycle.
      const patched = res?.order;
      const paymentRow = res?.payment;
      if (patched) {
        setOrders((prev) => prev.map((o) => {
          if (o.id !== oid) return o;
          const normalize = (r: any) => ({
            ...o,
            ...r,
            paymentStatus: r.paymentStatus ?? r.payment_status ?? o.paymentStatus,
            paymentMethod: r.paymentMethod ?? r.payment_method ?? o.paymentMethod,
            paidAmount: r.paidAmount != null ? r.paidAmount
              : r.paidAmountCents != null ? r.paidAmountCents / 100
              : r.paid_amount_cents != null ? r.paid_amount_cents / 100
              : o.paidAmount,
            balanceDue: r.balanceDue != null ? r.balanceDue
              : r.balanceDueCents != null ? r.balanceDueCents / 100
              : r.balance_due_cents != null ? r.balance_due_cents / 100
              : o.balanceDue,
            updatedAt: r.updatedAt ?? r.updated_at ?? Date.now(),
          });
          return normalize(patched);
        }));
      }

      // =====================================================================
      // SYNC-TO-ADMIN ENQUEUE — make mark-paid visible to admin panel.
      // =====================================================================
      try {
        const now = Date.now();
        // (A) ORDER UPDATE: payment status, method, totals, employee, notes
        const paidCents =
          patched?.paid_amount_cents ??
          patched?.paidAmountCents ??
          (patched?.paidAmount != null ? Math.round(Number(patched.paidAmount) * 100) : markPaidAmountCents);
        const balCents =
          patched?.balance_due_cents ??
          patched?.balanceDueCents ??
          (patched?.balanceDue != null ? Math.round(Number(patched.balanceDue) * 100) : Math.max(0, Number((markPaidTarget.totalAmount ?? 0) * 100) - markPaidAmountCents));
        const effStatus = String(
          patched?.payment_status ?? patched?.paymentStatus ??
          (balCents > 0 ? 'PARTIALLY_PAID' : 'PAID')
        );
        const orderPatchPayload: any = {
          id: oid,
          paymentStatus: effStatus,
          paymentMethod: markPaidMethod,
          paidAmountCents: Number(paidCents) || 0,
          balanceDueCents: Number(balCents) || 0,
          updatedAt: new Date(now),
        };
        if (markPaidNote) orderPatchPayload.notes = markPaidNote;
        if (employee?.id) {
          orderPatchPayload.employeeId = String(employee.id);
          orderPatchPayload.acceptedByEmployeeId = String(employee.id);
          orderPatchPayload.acceptedAt = new Date(now);
        }
        await window.electronAPI?.db?.syncQueue?.push?.({
          op_id: `order_update_payment_${oid}_${now}`,
          entity_type: 'ORDER',
          operation: 'UPDATE',
          entity_id: oid,
          payload: JSON.stringify(orderPatchPayload),
          idempotency_key: `order-payment-${oid}-${markPaidAmountCents}-${effStatus}`,
          local_entity_version: 2,
        });

        // (B) PAYMENT CREATE: ledger row. Server-side applyPaymentCommand
        // auto-reconciles payment totals and bumps order.paymentStatus.
        const paymentId =
          paymentRow?.id ?? paymentRow?._id ?? `pay-pos-${oid}-${now}`;
        const incrementalCents =
          Number(paymentRow?.amount_cents ?? paymentRow?.amountCents ?? 0) ||
          markPaidAmountCents;
        const serverPaymentPayload: any = {
          id: paymentId,
          restaurantId: (restaurant as any)?.id,
          branchId: (branch as any)?.id,
          orderId: oid,
          employeeId: employee?.id,
          shiftId: openShift?.shiftId || undefined,
          amountCents: Number(incrementalCents) || 0,
          currency: ((restaurant as any)?.currency as string) || 'NGN',
          method: markPaidMethod,
          provider: 'LOCAL_POS',
          verificationSource: 'LOCAL',
          status: 'PAID',
          notes: markPaidNote || undefined,
          idempotencyKey: `markpaid-${oid}-${now}`,
          receiptNumber: `${markPaidTarget.orderNumber || oid}-${markPaidMethod}-${now}`.replace(/[^\w-]/g, '').substring(0, 32),
          completedAt: new Date(now),
          createdAt: new Date(now),
          updatedAt: new Date(now),
        };
        await window.electronAPI?.db?.syncQueue?.push?.({
          op_id: `payment_${paymentId}`,
          entity_type: 'PAYMENT',
          operation: 'CREATE',
          entity_id: paymentId,
          payload: JSON.stringify(serverPaymentPayload),
          idempotency_key: paymentId,
          local_entity_version: 1,
        });
      } catch (syncErr: any) {
        // Sync enqueue is best-effort — never block the receipt print flow
        // because POS works fully offline. Queue writes will be retried on
        // the next cycle.
        console.warn('[pos] mark-paid sync enqueue warning (best-effort):', syncErr?.message ?? syncErr);
      }

      const methodLabel: Record<string, string> = {
        CASH: '💵 CASH',
        CARD_POS: '💳 CARD',
        BANK_TRANSFER: '🏦 TRANSFER',
      };
      const statusAfter = patched?.paymentStatus || patched?.payment_status || 'PAID';
      flashToast(
        `${methodLabel[markPaidMethod] || markPaidMethod} recorded · ${statusAfter} · ${formatCentsToNgn(markPaidAmountCents)}`
      );

      // Auto-print 2 receipt copies (CUSTOMER + CASHIER) to match the exact
      // behavior of PaymentModal when paying for new in-POS orders.
      try {
        await window.electronAPI?.print?.receipt?.(oid, 2);
      } catch (printErr) {
        console.warn('[pos] mark-paid receipt print error (non-fatal):', printErr);
      }

      // If order is now fully paid and still in an active status, auto-advance
      // to DELIVERED so the kitchen flow converges. Skip if already past.
      let deliveredBumped = false;
      const balAfter =
        patched?.balanceDueCents ??
        patched?.balance_due_cents ??
        (patched?.balanceDue != null ? Math.round(Number(patched.balanceDue) * 100) : null) ??
        0;
      if (balAfter <= 0 && markPaidTarget) {
        const curSt = (patched?.status || markPaidTarget.status || 'NEW').toUpperCase();
        if (['NEW', 'PREPARING', 'READY'].includes(curSt)) {
          try {
            await window.electronAPI?.db?.orders?.updateStatus?.(oid, 'DELIVERED');
            setOrders((prev) => prev.map((oo) => oo.id === oid ? { ...oo, status: 'DELIVERED', updatedAt: Date.now() } : oo));
            deliveredBumped = true;
            flashToast(`✅ ${markPaidTarget.orderNumber || oid} → DELIVERED`);
          } catch { /* status bump best-effort */ }
        }
      }

      // =====================================================================
      // SYNC-TO-ADMIN BONUS: if we bumped status to DELIVERED above, enqueue
      // a second ORDER UPDATE command so admin sees DELIVERED (not just PAID).
      // =====================================================================
      if (deliveredBumped) {
        try {
          await window.electronAPI?.db?.syncQueue?.push?.({
            op_id: `order_status_${oid}_DELIVERED_${Date.now()}`,
            entity_type: 'ORDER',
            operation: 'UPDATE',
            entity_id: oid,
            payload: JSON.stringify({
              id: oid,
              status: 'DELIVERED',
              updatedAt: new Date(),
              deliveredByEmployeeId: employee?.id,
              deliveredAt: new Date(),
            }),
            idempotency_key: `order-delivered-${oid}`,
            local_entity_version: 3,
          });
        } catch (e) {
          console.warn('[pos] mark-paid DELIVERED status enqueue warning:', e);
        }
      }

      closeMarkPaid();
    } catch (err: any) {
      console.warn('[pos] mark-paid failed:', err);
      flashToast(`⚠️ Payment record failed: ${err?.message || 'try again'}`);
      setMarkPaidBusy(false);
    }
  };

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden relative">
      <Header
        connectionState={connection}
        openShift={openShift}
        onRequestOpenShift={() => setShowShiftModal('OPEN')}
        onRequestCloseShift={() => setShowShiftModal('CLOSE')}
      />

      {/* --- Incoming Web / QR Order Notification Rail -----------------------
            Sticky section between Header and main layout. ALWAYS rendered as
            a visible strip so the attendant can't miss it when orders
            accumulate. Horizontal-scroll on narrow screens, 1-row rail. */}
      {incomingWebOrders.length > 0 && (
        <div className="shrink-0 border-b border-white/5 bg-[linear-gradient(180deg,rgba(8,145,178,0.16)_0%,rgba(212,175,55,0.06)_55%,rgba(15,23,42,0)_100%)] backdrop-blur-xl relative overflow-hidden">
          {/* Ambience */}
          <div className="absolute -top-10 left-1/3 h-32 w-64 rounded-full blur-3xl pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(34,211,238,0.45), transparent 70%)' }}
          />
          <div className="relative px-4 sm:px-6 py-3">
            {/* Rail header row */}
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
              <div className="flex items-center gap-2.5 flex-wrap">
                <div className="inline-flex items-center gap-2">
                  <span className="relative inline-flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-400" />
                  </span>
                  <span className="text-[11px] uppercase tracking-[0.18em] font-black text-cyan-300">
                    Incoming Customer Orders
                  </span>
                </div>
                <span className="chip-neon !py-1 !px-3 !text-xs !font-black tabular-nums">
                  🔔 {incomingWebOrders.length} pending
                </span>
                {/* Jump to Orders tab (HistoryPanel) so the attendant can full-list process */}
                {activeTab !== 'HISTORY' && (
                  <button
                    onClick={() => setActiveTab('HISTORY')}
                    className="chip !py-1 !px-3 !text-xs !font-bold !bg-white/5 !text-ink-200 !ring-white/10 hover:!text-white hover:!ring-cyan-400/30 transition-all"
                  >
                    📋 Go to Orders tab
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* Sound bell toggle (applies to FUTURE notifications) */}
                <button
                  onClick={() => setNotifSoundOn((v) => !v)}
                  title={notifSoundOn ? 'Mute new order bell' : 'Unmute new order bell'}
                  className="chip !py-1 !px-2.5 !text-xs !font-bold !bg-white/5 !text-ink-200 !ring-white/10 hover:!text-white hover:!ring-amber-400/30 transition-all"
                >
                  {notifSoundOn ? '🔊 Bell ON' : '🔇 Bell OFF'}
                </button>
                {/* Dismiss all */}
                <button
                  onClick={() => setIncomingWebOrders([])}
                  className="chip !py-1 !px-2.5 !text-xs !font-bold !bg-white/5 !text-ink-200 !ring-white/10 hover:!text-rose-200 hover:!ring-rose-400/30 transition-all"
                >
                  ✅ Acknowledge all
                </button>
              </div>
            </div>

            {/* Horizontal rail of notification cards */}
            <div className="flex gap-3 overflow-x-auto pb-1 no-scrollbar snap-x snap-mandatory">
              {incomingWebOrders.map((o: any) => {
                const src = String(o.sourceChannel || '').toUpperCase();
                const qty = (o.items || []).reduce((s: number, it: any) => s + (Number(it.quantity) || 0), 0);
                const nowTs = Date.now();
                const createdAt = Number(o.createdAt || 0);
                const minsAgo = createdAt > 0 && nowTs >= createdAt
                  ? Math.max(0, Math.floor((nowTs - createdAt) / 60000))
                  : null;
                // Source tinted header badge
                const srcBadge =
                  src === 'QR'
                    ? { label: '📱 TABLE QR', cls: '!bg-emerald-500/15 !text-emerald-200 !ring-emerald-400/30' }
                    : src === 'WEBSITE'
                      ? { label: '🌐 ONLINE', cls: '!bg-sky-500/15 !text-sky-200 !ring-sky-400/30' }
                      : src === 'APP'
                        ? { label: '📲 APP', cls: '!bg-violet-500/15 !text-violet-200 !ring-violet-400/30' }
                        : src === 'PHONE'
                          ? { label: '📞 PHONE', cls: '!bg-amber-500/15 !text-amber-200 !ring-amber-400/30' }
                          : { label: '📍 EXTERNAL', cls: '!bg-slate-500/15 !text-slate-200 !ring-slate-400/30' };
                // Is unpaid / pay-at-counter? (highlights the Mark Paid button)
                const unpaid = o.paymentStatus && !['PAID', 'REFUNDED'].includes(String(o.paymentStatus).toUpperCase());
                return (
                  <div
                    key={String(o.id)}
                    className="shrink-0 w-[23rem] sm:w-[25rem] snap-start card neon-border p-3.5 sm:p-4 shadow-glow-restaurant animate-slide-up"
                  >
                    {/* Card header */}
                    <div className="flex items-start justify-between gap-2 mb-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="chip !py-1 !px-2.5 !text-[10px] !font-black tabular-nums !bg-emerald-500/15 !text-emerald-200 !ring-emerald-400/30 animate-pulse">
                          ● NEW
                        </span>
                        <span className={`chip !py-1 !px-2.5 !text-[10px] !font-black uppercase tracking-wider ${srcBadge.cls}`}>
                          {srcBadge.label}
                        </span>
                        <span className="chip-neon !py-1 !px-2.5 !text-[10px] !font-black tabular-nums">
                          #{o.orderNumber || (String(o.id || '').slice(-5).toUpperCase())}
                        </span>
                        {minsAgo !== null && (
                          <span className="text-[10px] text-ink-400 font-bold tabular-nums">
                            {minsAgo < 1 ? 'just now' : `${minsAgo}m ago`}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => ackIncomingOrder(o.id)}
                        className="shrink-0 h-7 w-7 rounded-lg bg-white/5 ring-1 ring-inset ring-white/10 text-ink-300 hover:bg-rose-500/10 hover:text-rose-200 hover:ring-rose-400/30 transition-all text-[11px] font-black"
                        title="Acknowledge (hide from rail — order still in Orders tab)"
                      >
                        ✕
                      </button>
                    </div>

                    {/* Table + Customer + type */}
                    <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
                      {o.tableName && (
                        <span className="chip-neon !py-0.5 !px-2 !text-[11px] !font-bold">
                          🪑 {o.tableName}
                        </span>
                      )}
                      {o.customerName && (
                        <span className="chip !py-0.5 !px-2 !text-[11px] !font-bold !bg-white/5 !text-white !ring-white/15">
                          👤 {o.customerName}
                        </span>
                      )}
                      {/* Customer contact chips — phone and email from website/QR order */}
                      {o.customerPhone && (
                        <span className="chip !py-0.5 !px-2 !text-[11px] !font-bold !bg-cyan-500/10 !text-cyan-200 !ring-cyan-400/25" title={`Call ${o.customerPhone}`}>
                          📞 {o.customerPhone}
                        </span>
                      )}
                      {o.customerEmail && (
                        <span className="chip !py-0.5 !px-2 !text-[11px] !font-bold !bg-violet-500/10 !text-violet-200 !ring-violet-400/25" title={`Email ${o.customerEmail}`}>
                          📧 {o.customerEmail}
                        </span>
                      )}
                      {o.orderType && (
                        <span className="chip !py-0.5 !px-2 !text-[11px] !font-bold !bg-amber-500/10 !text-amber-200 !ring-amber-400/25 uppercase tracking-wider">
                          {String(o.orderType).replace('_', ' ')}
                        </span>
                      )}
                    </div>

                    {/* Items + total + status */}
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-3.5">
                      <div className="text-xs text-ink-300 font-semibold">
                        🧾 {qty} item{qty === 1 ? '' : 's'} · {(o.items || []).length} line{(o.items || []).length === 1 ? '' : 's'}
                        {o.notes && <span className="chip ml-1.5 !py-0.5 !px-2 !text-[10px] !font-bold !bg-amber-500/10 !text-amber-200 !ring-amber-400/25">📝 note</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        {o.paymentStatus && (() => {
                          const ps = String(o.paymentStatus).toUpperCase();
                          const meta: Record<string, { label: string; cls: string }> = {
                            PAID: { label: '✅ PAID', cls: '!bg-emerald-500/15 !text-emerald-200 !ring-emerald-400/30' },
                            PARTIALLY_PAID: { label: '💳 PART', cls: '!bg-sky-500/15 !text-sky-200 !ring-sky-400/30' },
                            PENDING: { label: '⏳ PEND', cls: '!bg-amber-500/15 !text-amber-200 !ring-amber-400/30' },
                            UNPAID: { label: '⏳ UNPAID', cls: '!bg-rose-500/10 !text-rose-200 !ring-rose-400/25' },
                            FAILED: { label: '❌ FAIL', cls: '!bg-rose-500/15 !text-rose-200 !ring-rose-400/35' },
                            REFUNDED: { label: '↩️ RFND', cls: '!bg-slate-700/40 !text-slate-200 !ring-slate-500/40' },
                          };
                          const m = meta[ps] || meta.UNPAID;
                          return (
                            <span className={`chip !py-0.5 !px-2 !text-[10px] !font-black uppercase tracking-wider ${m.cls}`}>
                              {m.label}
                            </span>
                          );
                        })()}
                        <span className="text-lg font-black text-gradient-neon tabular-nums leading-none">
                          {formatCentsToNgn(Math.round((o.totalAmount || 0) * 100))}
                        </span>
                      </div>
                    </div>

                    {/* Three action buttons inline */}
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        onClick={() => ackIncomingOrder(o.id)}
                        className="btn-secondary !min-h-9 !px-2 !py-2 !text-[11px] !font-black"
                        title="Acknowledge — keep in Orders tab, hide from rail"
                      >
                        ✅ Ack
                      </button>
                      <button
                        onClick={() => void recallIncomingOrder(o)}
                        className="btn-primary !min-h-9 !px-2 !py-2 !text-[11px] !font-black"
                        title="Load into cart to edit / process / reprint"
                      >
                        📂 Process
                      </button>
                      {unpaid ? (
                        <button
                          onClick={() => markPaidIncomingOrder(o)}
                          className="btn-neon-cyan !min-h-9 !px-2 !py-2 !text-[11px] !font-black shadow-glow-restaurant animate-neon-pulse"
                          title="Record counter payment — cash / card POS terminal / bank transfer"
                        >
                          💵 Mark Paid
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            ackIncomingOrder(o.id);
                            setActiveTab('HISTORY');
                          }}
                          className="btn-secondary !min-h-9 !px-2 !py-2 !text-[11px] !font-black"
                          title="Already paid — view in Orders tab"
                        >
                          👁 View
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 flex min-h-0 relative">
        {/* Sidebar */}
        <aside className="w-24 shrink-0 border-r border-white/5 bg-slate-900/40 backdrop-blur-xl flex flex-col py-4 relative overflow-hidden">
          <div className="absolute inset-0 opacity-50 pointer-events-none bg-gradient-mesh-warm" />
          <nav className="flex-1 flex flex-col items-center gap-2 px-2 relative">
            {sidebarTabs.map((t) => {
              const active = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => {
                    setActiveTab(t.id);
                    if (t.id === 'SHIFT') {
                      if (openShift.shiftId) setShowShiftModal('CLOSE');
                      else setShowShiftModal('OPEN');
                    }
                  }}
                  className={`w-full min-h-[5.25rem] flex flex-col items-center justify-center gap-1.5 rounded-2xl transition-all active:scale-[0.97] ring-1 ring-inset group relative overflow-hidden ${
                    active
                      ? 'text-white ring-amber-400/40 animate-neon-pulse'
                      : 'text-ink-300 hover:text-white hover:ring-white/15'
                  }`}
                  style={active
                    ? {
                        background: 'linear-gradient(180deg, rgba(255,215,0,0.18) 0%, rgba(212,175,55,0.12) 45%, rgba(205,127,50,0.10) 100%)',
                        boxShadow: '0 0 28px -8px rgba(212, 175, 55, 0.55), inset 0 1px 0 rgba(255,215,0,0.18)',
                      }
                    : { background: 'rgba(255,255,255,0.02)' }}
                  title={`${t.label} — ${t.desc}`}
                >
                  {active && (
                    <div className="absolute inset-x-0 top-0 h-[2px]"
                      style={{ background: 'linear-gradient(90deg, transparent, #FFD700 30%, #CD7F32 70%, transparent)' }}
                    />
                  )}
                  <span className={`text-3xl leading-none relative ${active ? 'animate-float-slow' : ''}`}>{t.icon}</span>
                  <span className={`text-[10px] font-black uppercase tracking-[0.16em] relative ${active ? 'text-amber-200' : ''}`}>
                    {t.label}
                  </span>
                </button>
              );
            })}
          </nav>
          <div className="mt-auto px-2 space-y-2 relative">
            <button
              onClick={() => {
                // Open or re-focus the customer-facing popup window. In a
                // real Electron build a secondary BrowserWindow would be
                // created; in browser/Vite mode we open a classic popup that
                // mounts the same SPA at the /#/customer-display hash route.
                // The popup has its own installMockElectronAPI() call in
                // main.tsx, so it connects back to this POS window via the
                // BroadcastChannel state bus and hydrates the latest state
                // immediately (including any live cart already being rung).
                const existing = _customerDisplayWindow;
                if (existing && !existing.closed) {
                  try {
                    existing.focus();
                  } catch (_) {
                    /* popup may be cross-origin / in another browser context */
                  }
                  // Always re-push idle/order state so refocus recovers the UI
                  // even if the popup had been refreshed and lost its state.
                  window.electronAPI?.customerDisplay?.showIdle?.().catch(() => {});
                  flashToast('🖥️ Customer display: Refocused');
                  return;
                }

                // 1280×800 landscape matches the typical customer-facing
                // 15.6"/21.5" monitor hung above the POS terminal. Centre on
                // whatever screen the browser window reports so launching
                // from a laptop doesn't dump the popup off-screen.
                const w = 1280;
                const h = 800;
                const left = Math.max(
                  0,
                  Math.floor(
                    (typeof screen !== 'undefined' ? screen.width : window.innerWidth) / 2 -
                      w / 2,
                  ),
                );
                const top = Math.max(
                  0,
                  Math.floor(
                    (typeof screen !== 'undefined' ? screen.height : window.innerHeight) / 2 -
                      h / 2,
                  ),
                );
                const features = [
                  `width=${w}`,
                  `height=${h}`,
                  `left=${left}`,
                  `top=${top}`,
                  'menubar=no',
                  'toolbar=no',
                  // modern browsers may still show URL bar for security; text is informational
                ].join(',');
                const popup = window.open(
                  '/#/customer-display',
                  'prolific-customer-display',
                  features,
                );
                if (!popup) {
                  flashToast('⚠️ Popup blocked — allow popups for Prolific POS');
                  return;
                }
                _customerDisplayWindow = popup;
                // Clear ref if user manually closes the popup so the next
                // click re-opens it cleanly instead of trying to focus a dead ref.
                const closePoll = window.setInterval(() => {
                  if (_customerDisplayWindow && _customerDisplayWindow.closed) {
                    _customerDisplayWindow = null;
                    window.clearInterval(closePoll);
                  }
                }, 1000);
                popup.addEventListener?.('beforeunload', () => {
                  if (_customerDisplayWindow === popup) _customerDisplayWindow = null;
                });
                // Prime the channel so the popup gets idle state the moment
                // its React tree mounts (its subscriber issues a
                // customer-latest-request, but pushing eagerly avoids a flash).
                window.electronAPI?.customerDisplay?.showIdle?.().catch(() => {});
                flashToast('🖥️ Customer display: Launched on second monitor');
              }}
              className={[
                'w-full min-h-[4.5rem] flex flex-col items-center justify-center gap-1 rounded-2xl transition-all relative group',
                displayAlive
                  ? 'text-amber-200 bg-white/5 ring-1 ring-amber-400/40 shadow-[0_0_0_1px_rgba(251,191,36,0.10),0_0_24px_rgba(251,191,36,0.08)]'
                  : 'text-ink-300 hover:text-amber-200 hover:bg-white/5',
              ].join(' ')}
              title="Customer Display"
            >
              <span className="text-2xl relative">🖥️</span>
              <span className="text-[9px] font-black uppercase tracking-[0.18em] relative">
                Display
              </span>
              {displayAlive && (
                <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]" />
              )}
            </button>
            <button
              onClick={() => {
                console.log('[pos] print test');
                window.electronAPI?.print?.testPage?.().catch(() => {});
                flashToast('🖨️ Test print queued');
              }}
              className="w-full min-h-[4.5rem] flex flex-col items-center justify-center gap-1 rounded-2xl text-ink-300 hover:text-amber-200 hover:bg-white/5 transition-all relative group"
              title="Test Print"
            >
              <span className="text-2xl relative">🖨️</span>
              <span className="text-[9px] font-black uppercase tracking-[0.18em] relative">Print</span>
            </button>
          </div>
        </aside>

        {/* Main 2-pane area: Center content + Right Cart rail */}
        <main className="flex-1 flex min-w-0 min-h-0">
          <section className="flex-1 min-w-0 flex flex-col min-h-0">
            {activeTab === 'MENU' && (
              <MenuGrid
                branchId={branch?.id}
                onItemAdded={(item, modifiers) => {
                  cartActions.addItem(item, 1, modifiers);
                }}
              />
            )}
            {activeTab === 'TABLES' && (
              <TablesPanel
                tables={tables}
                tablesZone={tablesZone}
                setTablesZone={setTablesZone}
                onSelectTable={(tbl) => {
                  cartActions.setTable(tbl.id, tbl.name);
                  flashToast(`🪑 Table ${tbl.name} assigned to current order`);
                  setActiveTab('MENU');
                }}
                orders={orders}
                sessions={tableSessions}
                onOpenTabDetails={(tableId, tableName, sessionId) => {
                  setTabDetails({ open: true, tableId, tableName, sessionId });
                }}
              />
            )}
            {activeTab === 'HISTORY' && (
              <HistoryPanel
                orders={orders}
                filter={historyFilter}
                setFilter={setHistoryFilter}
                dateStart={historyDateStart}
                dateEnd={historyDateEnd}
                setDateStart={setHistoryDateStart}
                setDateEnd={setHistoryDateEnd}
                clearDateRange={() => { setHistoryDateStart(null); setHistoryDateEnd(null); }}
                onRecall={recallOrder}
                onBumpStatus={bumpOrderStatus}
                onOpenTable={(tblId, tblName) => {
                  if (tblId) cartActions.setTable(tblId, tblName || '');
                  setActiveTab('TABLES');
                }}
                onMarkPaid={openMarkPaid}
                onPrintReceipt={(o: any) => {
                  const oid = o?.id || o?._id;
                  if (!oid) return;
                  (async () => {
                    try {
                      await window.electronAPI?.print?.receipt?.(oid, 1);
                      flashToast(`🧾 Receipt ${o.orderNumber || o.id?.slice(-5).toUpperCase() || '#'} printed`);
                    } catch (e) {
                      console.warn('[pos] print history receipt failed', e);
                      flashToast('🖨️ Receipt print failed — try again');
                    }
                  })();
                }}
                restaurantCurrency={restaurant?.currency}
              />
            )}
            {activeTab === 'SHIFT' && (
              <PlaceholderPanel
                tab="SHIFT"
                subtitle="Use the modal to open / close your shift and reconcile float."
                actions={[
                  { label: '🔓 Open Shift', variant: 'primary', onClick: () => setShowShiftModal('OPEN') },
                  { label: '🔒 Close Shift', variant: 'secondary', onClick: () => setShowShiftModal('CLOSE') },
                ]}
              />
            )}
            {activeTab === 'REPORTS' && (
              <ReportsPanel orders={orders} employee={employee} shift={openShift} />
            )}
            {activeTab === 'MANAGER' && (
              <ManagerTools
                accessToken={accessToken!}
                restaurantId={restaurant?.id}
                branchId={branch?.id}
                employeeRole={employee?.role as any}
                connectionStatus={connection.status}
                onMenuChanged={async () => {
                  // After a manager edit, re-fetch the full public menu and
                  // dual-write the snapshot to in-memory cache + localStorage
                  // offline mirror so POS menu grid matches instantly.
                  try {
                    if (!branch?.id) return;
                    const snap = await fetchPublicMenu(branch.id);
                    applyRemoteMenuSnapshot({
                      categories: snap.categories,
                      items: snap.items,
                      modifiers: snap.modifiers,
                    });
                  } catch (e) {
                    console.warn('[manager-tools] post-save snapshot refresh failed', e);
                  }
                }}
              />
            )}
          </section>
          <CartPanel />
        </main>
      </div>

      {/* Shift modals */}
      {showShiftModal === 'OPEN' && (
        <ShiftModal
          mode="OPEN"
          openShift={openShift}
          onClose={() => {
            if (!openShift.shiftId) return;
            setShowShiftModal(null);
          }}
          onDone={(s) => {
            setOpenShift(s);
            setShowShiftModal(null);
            flashToast('✅ Shift opened. Good luck!');
          }}
        />
      )}
      {showShiftModal === 'CLOSE' && (
        <ShiftModal
          mode="CLOSE"
          openShift={openShift}
          onClose={() => setShowShiftModal(null)}
          onDone={(s) => {
            setOpenShift(s);
            setShowShiftModal(null);
            flashToast('🔒 Shift closed — see Reports for summary.');
          }}
        />
      )}

      {/* Table tab details — opened from Cart rail "View Tab" CTA or table-card badge */}
      {tabDetails.open && (
        <TableTabDetailsModal
          open={tabDetails.open}
          tableId={tabDetails.tableId}
          tableName={tabDetails.tableName}
          sessionId={tabDetails.sessionId}
          onClose={() => setTabDetails((s) => ({ ...s, open: false }))}
        />
      )}

      {/* --- Mark-as-Paid confirm overlay — counter attendants use this to
            record cash / POS-terminal / bank-transfer payments for QR-table
            "Pay at Counter" and Website online orders. 3 large tender chips,
            editable amount for split payments, optional note field. --- */}
      {markPaidTarget && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-fade-in">
          <div className="w-full max-w-2xl card-glow card neon-border p-5 sm:p-7 relative overflow-hidden animate-slide-up">
            {/* Background ambience */}
            <div className="absolute -top-20 -right-20 h-60 w-60 rounded-full blur-3xl opacity-60 pointer-events-none"
              style={{ background: 'radial-gradient(circle, rgba(34,211,238,0.40) 0%, transparent 70%)' }}
            />
            <div className="absolute -bottom-24 -left-20 h-60 w-60 rounded-full blur-3xl opacity-60 pointer-events-none"
              style={{ background: 'radial-gradient(circle, rgba(255,215,0,0.32) 0%, transparent 70%)' }}
            />

            {/* Header */}
            <div className="relative flex items-start justify-between gap-4 mb-5">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-[0.18em] font-black text-cyan-300/80">
                  Counter Payment · Attendant Action
                </div>
                <h2 className="text-2xl sm:text-3xl font-black mt-1.5 flex items-center gap-2 flex-wrap">
                  <span className="text-gradient-neon">💵 Record Payment</span>
                  <span className="chip-neon !py-1 !px-3 !text-xs !font-bold tabular-nums">
                    #{markPaidTarget.orderNumber || (markPaidTarget.id || '').slice(-5).toUpperCase()}
                  </span>
                </h2>
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  {markPaidTarget.tableName && (
                    <span className="chip-neon !py-1 !px-3 !text-xs !font-bold">
                      🪑 {markPaidTarget.tableName}
                    </span>
                  )}
                  {markPaidTarget.customerName && (
                    <span className="chip !py-1 !px-3 !text-xs !font-bold !bg-white/5 !text-white !ring-white/15">
                      👤 {markPaidTarget.customerName}
                    </span>
                  )}
                  <span className="chip !py-1 !px-3 !text-xs !font-bold !bg-amber-500/10 !text-amber-200 !ring-amber-400/25 uppercase tracking-wider">
                    {markPaidTarget.orderType?.replace('_', ' ') || markPaidTarget.sourceChannel || 'POS ORDER'}
                  </span>
                </div>
              </div>
              <button
                onClick={closeMarkPaid}
                disabled={markPaidBusy}
                className="shrink-0 h-10 w-10 rounded-xl bg-white/5 ring-1 ring-inset ring-white/10 text-ink-200 hover:bg-white/10 hover:text-white transition-all text-lg font-black disabled:opacity-50"
                title="Close"
              >
                ✕
              </button>
            </div>

            {/* Order total summary */}
            <div className="relative card p-4 sm:p-5 mb-5 ring-1 ring-inset ring-white/10">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.16em] font-black text-ink-400">Total Order Amount</div>
                  <div className="text-3xl sm:text-4xl font-black text-gradient-neon tabular-nums mt-1 leading-none">
                    {formatCentsToNgn(Math.round((markPaidTarget.totalAmount || 0) * 100))}
                  </div>
                </div>
                <div className="text-right space-y-1.5">
                  {(markPaidTarget.paidAmount || 0) > 0 && (
                    <div className="text-xs">
                      <span className="text-ink-400 font-bold uppercase tracking-wider">Already paid: </span>
                      <span className="font-black text-emerald-300 tabular-nums">
                        {formatCentsToNgn(Math.round((markPaidTarget.paidAmount || 0) * 100))}
                      </span>
                    </div>
                  )}
                  <div className="text-xs">
                    <span className="text-ink-400 font-bold uppercase tracking-wider">Balance: </span>
                    <span className="font-black text-rose-300 tabular-nums">
                      {formatCentsToNgn(Math.round(((markPaidTarget.balanceDue || 0) > 0
                        ? markPaidTarget.balanceDue
                        : Math.max(0, (markPaidTarget.totalAmount || 0) - (markPaidTarget.paidAmount || 0))) * 100))}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* 3 Tender method buttons */}
            <div className="relative mb-5">
              <div className="text-[10px] uppercase tracking-[0.16em] font-black text-ink-400 mb-2.5">Payment Method · Tender Type</div>
              <div className="grid grid-cols-3 gap-2.5">
                {(['CASH', 'CARD_POS', 'BANK_TRANSFER'] as const).map((m) => {
                  const active = markPaidMethod === m;
                  const meta: Record<string, { icon: string; label: string; sub: string }> = {
                    CASH: { icon: '💵', label: 'Cash', sub: 'Notes & coins' },
                    CARD_POS: { icon: '💳', label: 'Card POS', sub: 'Terminal swipe' },
                    BANK_TRANSFER: { icon: '🏦', label: 'Transfer', sub: 'Bank / mobile' },
                  };
                  const t = meta[m];
                  return (
                    <button
                      key={m}
                      onClick={() => setMarkPaidMethod(m)}
                      disabled={markPaidBusy}
                      className={`relative rounded-2xl p-3 sm:p-4 text-left transition-all ring-1 ring-inset min-h-[5.5rem] flex flex-col justify-between ${
                        active
                          ? 'ring-transparent shadow-glow-restaurant text-slate-950'
                          : 'ring-white/10 bg-white/5 text-white hover:ring-cyan-400/30'
                      }`}
                      style={active ? {
                        background: m === 'CASH'
                          ? 'linear-gradient(135deg, #FFD700 0%, #D4AF37 55%, #CD7F32 100%)'
                          : m === 'CARD_POS'
                            ? 'linear-gradient(135deg, #22D3EE 0%, #0EA5E9 55%, #6366F1 100%)'
                            : 'linear-gradient(135deg, #A78BFA 0%, #8B5CF6 55%, #7C3AED 100%)',
                      } : {}}
                    >
                      <div className="text-2xl sm:text-3xl leading-none">{t.icon}</div>
                      <div>
                        <div className="text-xs sm:text-sm font-black leading-tight">{t.label}</div>
                        <div className={`text-[10px] sm:text-[11px] mt-0.5 font-bold leading-tight ${active ? 'text-slate-900/70' : 'text-ink-400'}`}>
                          {t.sub}
                        </div>
                      </div>
                      {active && (
                        <div className="absolute top-2 right-2 h-5 w-5 rounded-full bg-white/90 text-slate-950 flex items-center justify-center text-[11px] font-black shadow-md">✓</div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Paid amount + Note */}
            <div className="relative grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              <div>
                <label className="text-[10px] uppercase tracking-[0.16em] font-black text-ink-400 block mb-2">
                  Paid Amount (₦) · editable for splits
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-400 font-black text-lg">₦</span>
                  <input
                    type="number"
                    min={0}
                    step={50}
                    value={Number.isFinite(markPaidAmountCents) ? (markPaidAmountCents / 100).toFixed(0) : '0'}
                    onChange={(e) => setMarkPaidAmountCents(Math.max(0, Math.round(Number(e.target.value || 0) * 100)))}
                    disabled={markPaidBusy}
                    className="w-full h-14 pl-10 pr-4 rounded-2xl bg-white/5 ring-1 ring-inset ring-white/10 text-white text-xl font-black tabular-nums focus:ring-cyan-400/50 focus:outline-none transition-all disabled:opacity-60"
                  />
                </div>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {[0.5, 0.75, 1].map((frac) => {
                    const totalCents = Math.round((markPaidTarget.totalAmount || 0) * 100);
                    const priorCents = Math.round((markPaidTarget.paidAmount || 0) * 100);
                    const remaining = Math.max(0, totalCents - priorCents);
                    const target = frac === 1
                      ? remaining
                      : Math.max(5000, Math.round(remaining * frac / 500) * 500);
                    const pct = frac === 1 ? 'Full' : `${Math.round(frac * 100)}%`;
                    return (
                      <button
                        key={frac}
                        type="button"
                        onClick={() => setMarkPaidAmountCents(target)}
                        disabled={markPaidBusy}
                        className="chip !py-1 !px-2.5 !text-[11px] !font-bold !bg-white/5 !text-ink-200 !ring-white/10 hover:!ring-cyan-400/30 hover:!text-white disabled:opacity-50"
                      >
                        {pct} · {formatCentsToNgn(target)}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.16em] font-black text-ink-400 block mb-2">
                  Note / Reference (optional)
                </label>
                <textarea
                  value={markPaidNote}
                  onChange={(e) => setMarkPaidNote(e.target.value)}
                  disabled={markPaidBusy}
                  rows={4}
                  placeholder="Transfer ref, terminal slip ID, customer note, etc."
                  className="w-full h-14 sm:h-full rounded-2xl bg-white/5 ring-1 ring-inset ring-white/10 text-white text-sm font-semibold px-4 py-3 resize-none focus:ring-cyan-400/50 focus:outline-none transition-all disabled:opacity-60 placeholder:text-ink-500"
                />
              </div>
            </div>

            {/* Action bar */}
            <div className="relative flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-3">
              <button
                onClick={closeMarkPaid}
                disabled={markPaidBusy}
                className="btn-secondary !min-h-12 !px-5 !text-sm !font-black flex-1 sm:flex-none"
              >
                Cancel
              </button>
              <button
                onClick={handleMarkPaidConfirm}
                disabled={markPaidBusy || markPaidAmountCents <= 0}
                className="btn-primary !min-h-12 !px-6 !text-sm !font-black flex-1 sm:flex-none shadow-glow-restaurant animate-neon-pulse disabled:!animate-none disabled:!opacity-50"
              >
                {markPaidBusy ? (
                  <>
                    <span className="inline-block h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin mr-2 align-middle" />
                    Recording…
                  </>
                ) : (
                  <>✔ Record Payment · {formatCentsToNgn(markPaidAmountCents)}</>
                )}
              </button>
            </div>

            {/* Footer info */}
            <div className="relative mt-5 pt-4 border-t border-white/5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-400 font-bold">
              <div>
                💡 After confirming: order chip → ✅ PAID, 2 receipts printed (customer + cashier)
              </div>
              {!openShift.shiftId && (
                <span className="chip !py-1 !px-2.5 !font-black !bg-amber-500/10 !text-amber-200 !ring-amber-400/25">
                  ⚠️ Shift not opened — no shift link
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Global toast */}
      {toast && (
        <div className="fixed top-24 right-6 z-[60] animate-slide-up">
          <div className="card-glow card neon-border chip-neon !rounded-2xl !px-5 !py-3 !text-sm !font-bold shadow-glow-restaurant">
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}

// ====================== PlaceholderPanel (SHIFT tab fallback) ======================
function PlaceholderPanel({ tab, subtitle, actions }: {
  tab: SidebarTab;
  subtitle?: string;
  actions?: { label: string; variant: 'primary' | 'secondary' | 'neon-pink' | 'neon-cyan'; onClick: () => void }[];
}) {
  const tabMeta = ALL_SIDEBAR_TABS_META.find((t) => t.id === tab);
  const icon = tabMeta?.icon || '🧭';
  return (
    <div className="flex-1 p-10 flex items-center justify-center overflow-y-auto min-h-0">
      <div className="text-center max-w-lg relative">
        <div className="absolute -top-20 left-1/2 -translate-x-1/2 h-60 w-60 rounded-full blur-3xl opacity-50 pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(255,215,0,0.30) 0%, transparent 70%)' }}
        />
        <div className="relative text-7xl mb-6 animate-float-slow inline-flex h-28 w-28 items-center justify-center rounded-[2rem] shadow-glow-restaurant animate-neon-pulse"
          style={{ background: 'linear-gradient(135deg, rgba(255,215,0,0.15), rgba(205,127,50,0.12))' }}
        >
          {icon}
        </div>
        <h2 className="relative text-3xl font-black mb-2">
          <span className="text-gradient-neon">{tabMeta?.label}</span>
          <span className="text-white"> Console</span>
        </h2>
        <p className="relative text-ink-300 leading-relaxed">
          {subtitle || `${tabMeta?.label} flows are wired through local DB IPCs. Use Menu tab to take orders now.`}
        </p>
        {actions && actions.length > 0 && (
          <div className={`relative mt-8 grid gap-3 ${actions.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {actions.map((a) => (
              <button key={a.label} onClick={a.onClick} className={a.variant === 'primary' ? 'btn-primary' : a.variant === 'secondary' ? 'btn-secondary' : a.variant === 'neon-pink' ? 'btn-neon-pink' : 'btn-neon-cyan'}>
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ====================== TablesPanel: Floor plan ======================
function TablesPanel({ tables, tablesZone, setTablesZone, onSelectTable, orders, sessions, onOpenTabDetails }: {
  tables: any[];
  tablesZone: string;
  setTablesZone: (z: string) => void;
  onSelectTable: (tbl: any) => void;
  orders: any[];
  sessions?: any[];
  onOpenTabDetails?: (tableId: string, tableName: string, sessionId: string) => void;
}) {
  const zones = useMemo(() => {
    const set = new Set<string>();
    for (const t of tables) if (t.zone) set.add(t.zone);
    return ['ALL', ...Array.from(set)];
  }, [tables]);

  // Aggregate orders per table, keyed by String(tableId) so ObjectId/string keys always
  // mismatch is impossible. Also counts source==='QR' orders separately so we can
  // explicitly show a scanner-occupied badge on the floor plan.
  const orderCountsByTable = useMemo(() => {
    const map: Record<string, { open: number; total: number; last: any; qrOpen: number; qrTotal: number }> = {};
    for (const o of orders) {
      const rawTid = o.tableId;
      if (!rawTid) continue;
      const tid = String(rawTid);
      const entry = map[tid] || { open: 0, total: 0, last: null as any, qrOpen: 0, qrTotal: 0 };
      entry.total += 1;
      if (o.source === 'QR') entry.qrTotal += 1;
      const finalised = ['CLOSED', 'COMPLETED', 'CANCELLED', 'PAID'].includes((o.status || '').toUpperCase());
      if (!finalised) {
        entry.open += 1;
        if (o.source === 'QR') entry.qrOpen += 1;
      }
      const lastTs = o.updatedAt || o.createdAt || 0;
      const entryTs = entry.last?.updatedAt || entry.last?.createdAt || 0;
      if (lastTs > entryTs || !entry.last) entry.last = o;
      map[tid] = entry;
    }
    return map;
  }, [orders]);

  // Map tableId -> open running tab session for live badge rendering on cards.
  // Supports both snake_case (SQLite row) and camelCase (frontend normalised).
  const sessionByTableId = useMemo(() => {
    const m = new Map<string, any>();
    for (const s of sessions || []) {
      const tid = String(s.table_id ?? s.tableId ?? '');
      if (!tid) continue;
      // Prefer OPEN status if multiple exist for a table (edge case).
      const existing = m.get(tid);
      if (!existing || (s.status === 'OPEN' && existing.status !== 'OPEN')) {
        m.set(tid, s);
      }
    }
    return m;
  }, [sessions]);

  // Compact status → pill tint map for the session badge
  const SESSION_STATUS_TINT: Record<string, { bg: string; text: string; ring: string; label: string }> = {
    OPEN: { bg: 'bg-emerald-500/20', text: 'text-emerald-200', ring: 'ring-emerald-400/40', label: 'OPEN' },
    AWAITING_PAYMENT: { bg: 'bg-amber-500/20', text: 'text-amber-200', ring: 'ring-amber-400/40', label: 'AWAITING PAY' },
    PARTIALLY_PAID: { bg: 'bg-sky-500/20', text: 'text-sky-200', ring: 'ring-sky-400/40', label: 'PART PAID' },
    PAID: { bg: 'bg-slate-600/30', text: 'text-slate-200', ring: 'ring-slate-400/30', label: 'PAID' },
    CLOSED: { bg: 'bg-slate-700/40', text: 'text-slate-300', ring: 'ring-slate-500/40', label: 'CLOSED' },
    VOIDED: { bg: 'bg-rose-500/20', text: 'text-rose-200', ring: 'ring-rose-400/40', label: 'VOIDED' },
  };

  const shown = tables.filter((t) => tablesZone === 'ALL' || !tablesZone || t.zone === tablesZone);

  // Compute a derived / effective status per table (not just the raw `t.status` seed).
  // This is the critical function that ensures a customer who scans a table's QR code
  // and places an order → the POS floor plan instantly shows the table as "Occupied"
  // (with the amber pulse + Running Tab / QR badges) even if the raw status was
  // "AVAILABLE" and no staff explicitly flipped the status enum on the row.
  const effectiveStatus = (t: any): string => {
    const raw = (t.status || 'AVAILABLE').toUpperCase();
    // If the backend status is already explicitly set, trust it first.
    if (raw in TABLE_STATUS_TINTS && raw !== 'AVAILABLE') return raw;
    const tid = String(t.id ?? (t as any)._id ?? '');
    const meta = orderCountsByTable[tid];
    const session = sessionByTableId.get(tid);
    // Any open order (incl. QR-source) or any running tab session = Occupied.
    if ((meta?.open ?? 0) > 0 || session) return 'OCCUPIED';
    return 'AVAILABLE';
  };

  const totalsByStatus = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of tables) {
      const st = effectiveStatus(t);
      m[st] = (m[st] || 0) + 1;
    }
    return m;
    // orderCountsByTable / sessionByTableId re-compute whenever orders/sessions change.
  }, [tables, orders, sessions]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar */}
      <div className="p-6 pb-4 border-b border-white/5 bg-slate-900/30 backdrop-blur-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] font-black text-amber-400/80">Floor Plan</div>
            <h2 className="text-2xl font-black mt-1">
              <span className="text-gradient-neon">Tables</span>
              <span className="text-white"> · {tables.length} total</span>
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(TABLE_STATUS_TINTS).map(([st, stl]) => (
              <div key={st} className="chip !py-1.5 !px-3 !text-xs !font-bold">
                <span className={`h-2.5 w-2.5 rounded-full ${stl.dot}`} />
                <span className={stl.text.replace('text-', 'text-')}>{stl.label}</span>
                <span className="tabular-nums text-white/90">{totalsByStatus[st] || 0}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {zones.map((z) => (
            <button
              key={z}
              onClick={() => setTablesZone(z)}
              className={`min-h-[2.75rem] rounded-xl px-4 text-sm font-bold transition-all ring-1 ring-inset ${
                tablesZone === z
                  ? 'text-slate-950 shadow-glow-restaurant ring-transparent'
                  : 'text-ink-200 bg-white/5 ring-white/10 hover:ring-amber-400/30'
              }`}
              style={tablesZone === z ? {
                background: 'linear-gradient(120deg, #FFD700 0%, #D4AF37 38%, #CD7F32 72%, #F59E0B 100%)',
              } : {}}
            >
              {z === 'ALL' ? '🌐 All Zones' : `📍 ${z}`}
            </button>
          ))}
        </div>
      </div>

      {/* Floor grid */}
      <div className="flex-1 overflow-y-auto p-6 min-h-0">
        {shown.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-24">
            <div className="text-6xl mb-4 animate-float-slow">🪑</div>
            <h3 className="text-xl font-black text-white mb-1">No tables in this zone</h3>
            <p className="text-ink-300 max-w-md">
              Sync your menu from the cloud (or seed dining tables) to view the floor plan.
              Tap <span className="text-amber-300 font-bold">Menu</span> to start an order without assigning a table.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {shown.map((t) => {
              const tid = String(t.id ?? (t as any)._id ?? '');
              const st = effectiveStatus(t);
              const tint = TABLE_STATUS_TINTS[st] || TABLE_STATUS_TINTS.AVAILABLE;
              const meta = orderCountsByTable[tid];
              const round = t.shape === 'round';
              const session = sessionByTableId.get(tid);
              const hasQrOpen = (meta?.qrOpen || 0) > 0;
              const isOccupied =
                st === 'OCCUPIED' || (meta?.open || 0) > 0 || Boolean(session);
              return (
                <button
                  key={tid}
                  onClick={() => onSelectTable(t)}
                  className={`relative group card p-5 hover:shadow-glow-restaurant transition-all active:scale-[0.97] ring-1 ring-inset ${tint.ring} overflow-hidden ${round ? 'rounded-[2rem]' : ''}`}
                >
                  <div className={`absolute inset-0 bg-gradient-to-br ${tint.bg} opacity-90 pointer-events-none`} />
                  {isOccupied && (
                    <div className="absolute -top-12 -right-12 h-32 w-32 rounded-full blur-3xl opacity-60 pointer-events-none"
                      style={{ background: 'radial-gradient(circle, rgba(255,215,0,0.50) 0%, transparent 70%)' }}
                    />
                  )}

                  <div className="relative flex items-start justify-between mb-3">
                    <div className={`h-12 w-12 ${round ? 'rounded-full' : 'rounded-2xl'} flex items-center justify-center text-white font-black ring-2 ring-inset ring-white/25 shadow-glow-restaurant`}
                      style={{
                        background: round
                          ? 'linear-gradient(135deg, #FFD700 0%, #D4AF37 50%, #CD7F32 100%)'
                          : 'linear-gradient(135deg, rgba(255,215,0,0.30) 0%, rgba(205,127,50,0.22) 100%)',
                        color: round ? '#1a1200' : '#fff',
                      }}
                    >
                      <span className="text-lg">{t.name || '?'}</span>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <span className={`h-3 w-3 rounded-full ${tint.dot}`} />
                      {hasQrOpen && (
                        <span className="chip !py-0.5 !px-2 !text-[9px] !font-black uppercase tracking-[0.14em] ring-1 ring-inset ring-amber-400/40 bg-amber-500/20 text-amber-200">
                          📷 QR Scan
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="relative">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="text-lg font-black text-white leading-none">{t.name}</div>
                      <div className="chip !py-0.5 !px-2 !text-[10px] !font-black uppercase tracking-widest">
                        👥 {t.capacity || '—'}
                      </div>
                    </div>
                    <div className={`text-[11px] uppercase tracking-[0.14em] font-black mb-3 ${tint.text}`}>
                      {tint.label}
                    </div>
                    <div className="rule mb-3" />
                    {meta?.last && (
                      <div className="space-y-1 mb-2">
                        <div className="flex items-center justify-between text-[11px] font-bold text-ink-200">
                          <span>{meta.last.orderNumber || 'Order'}</span>
                          <span className="tabular-nums text-amber-200">
                            {formatCentsToNgn(Math.round((meta.last.totalAmount || 0) * 100))}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="status-dot status-dot-preparing h-2 w-2" />
                          <span className="text-[10px] text-ink-300 uppercase font-bold tracking-wider">
                            {meta.open || 0} open · {meta.total || 0} total
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Running-tab session badge: shows T-#### + live balance.
                        Clicking the badge (stopPropagation) opens the tab-details
                        modal instead of re-assigning the table. */}
                    {session && (
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          const sid = String(session.id ?? '');
                          if (sid && onOpenTabDetails) {
                            onOpenTabDetails(String(t.id), String(t.name || ''), sid);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation();
                            e.preventDefault();
                            const sid = String(session.id ?? '');
                            if (sid && onOpenTabDetails) {
                              onOpenTabDetails(String(t.id), String(t.name || ''), sid);
                            }
                          }
                        }}
                        className="relative mt-1 rounded-2xl p-2.5 ring-1 ring-inset ring-emerald-400/30 bg-gradient-to-br from-emerald-500/18 via-[#CD7F32]/10 to-transparent hover:ring-amber-400/50 hover:shadow-glow-restaurant transition-all cursor-pointer group"
                      >
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-2 py-0.5 ring-1 ring-inset ring-emerald-400/40">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.7)]" />
                            <span className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-200">
                              Running Tab
                            </span>
                          </div>
                          <div className={`chip !py-0.5 !px-2 !text-[9px] !font-black uppercase tracking-widest ring-1 ring-inset ${
                            SESSION_STATUS_TINT[session.status || 'OPEN'] || SESSION_STATUS_TINT.OPEN
                          } ${
                            SESSION_STATUS_TINT[session.status || 'OPEN']?.bg || SESSION_STATUS_TINT.OPEN.bg
                          } ${
                            SESSION_STATUS_TINT[session.status || 'OPEN']?.text || SESSION_STATUS_TINT.OPEN.text
                          }`.trim()}>
                            {SESSION_STATUS_TINT[session.status || 'OPEN']?.label || 'OPEN'}
                          </div>
                        </div>
                        <div className="flex items-end justify-between gap-2">
                          <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-ink-300 mb-0.5">
                              Tab No.
                            </div>
                            <div className="font-black text-white leading-none tabular-nums text-lg">
                              {session.tab_number || `T-${String(session.id || '').slice(-4).toUpperCase()}`}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-ink-300 mb-0.5">
                              Balance
                            </div>
                            <div className="font-black tabular-nums leading-none text-amber-200 text-base">
                              {formatCentsToNgn(
                                typeof session.balance_due_cents === 'number'
                                  ? session.balance_due_cents
                                  : typeof session.balanceDueCents === 'number'
                                  ? session.balanceDueCents
                                  : 0,
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-[10px] font-bold text-ink-300 group-hover:text-emerald-200 transition-colors">
                          <span>
                            👤 {session.server_name || session.serverName || session.opened_by_name || session.openedByName || 'Staff'}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            View details
                            <span className="transition-transform group-hover:translate-x-0.5">→</span>
                          </span>
                        </div>
                      </div>
                    )}

                    {!meta?.last && !session && (
                      <div className="text-[11px] text-ink-300 font-semibold">
                        {t.zone || 'Unzoned'} · Tap to assign →
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ====================== HistoryPanel: Orders list ======================
function HistoryPanel({
  orders,
  filter,
  setFilter,
  dateStart,
  dateEnd,
  setDateStart,
  setDateEnd,
  clearDateRange,
  onRecall,
  onBumpStatus,
  onOpenTable,
  onMarkPaid,
  onPrintReceipt,
  restaurantCurrency,
}: {
  orders: any[];
  filter: string;
  setFilter: (f: string) => void;
  dateStart: string | null;
  dateEnd: string | null;
  setDateStart: (s: string | null) => void;
  setDateEnd: (s: string | null) => void;
  clearDateRange: () => void;
  onRecall: (o: any) => void;
  onBumpStatus: (o: any) => void;
  onOpenTable: (id: string, name?: string) => void;
  onMarkPaid?: (o: any) => void;
  onPrintReceipt?: (o: any) => void;
  restaurantCurrency?: string;
}) {
  // ---- Helpers: yyyy-mm-dd <-> midnight timestamps in local time ----
  const startOfDayTs = (iso: string | null): number | null => {
    if (!iso) return null;
    const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  };
  const endOfDayTs = (iso: string | null): number | null => {
    if (!iso) return null;
    const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
  };
  const toIsoDate = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const todayIso = toIsoDate(new Date());

  const filters = ['ALL', 'NEW', 'PREPARING', 'READY', 'DELIVERED', 'ON_HOLD', 'CLOSED'];

  // Preset chips — click sets start/end to a range
  const DATE_PRESETS: { id: string; label: string; apply: () => void }[] = [
    {
      id: 'ANY',
      label: '🌐 All Time',
      apply: () => clearDateRange(),
    },
    {
      id: 'TODAY',
      label: '📅 Today',
      apply: () => { setDateStart(todayIso); setDateEnd(todayIso); },
    },
    {
      id: 'YDAY',
      label: '⏮️ Yesterday',
      apply: () => {
        const d = new Date(); d.setDate(d.getDate() - 1);
        const iso = toIsoDate(d); setDateStart(iso); setDateEnd(iso);
      },
    },
    {
      id: '7D',
      label: '7 Days',
      apply: () => {
        const end = new Date();
        const start = new Date(); start.setDate(start.getDate() - 6);
        setDateStart(toIsoDate(start)); setDateEnd(toIsoDate(end));
      },
    },
    {
      id: '30D',
      label: '30 Days',
      apply: () => {
        const end = new Date();
        const start = new Date(); start.setDate(start.getDate() - 29);
        setDateStart(toIsoDate(start)); setDateEnd(toIsoDate(end));
      },
    },
  ];

  // Compute which preset is active (used for chip highlight)
  const activePreset = useMemo(() => {
    if (!dateStart && !dateEnd) return 'ANY';
    if (!dateStart || !dateEnd) return 'CUSTOM';
    const t = todayIso;
    if (dateStart === t && dateEnd === t) return 'TODAY';
    const y = new Date(); y.setDate(y.getDate() - 1); const yIso = toIsoDate(y);
    if (dateStart === yIso && dateEnd === yIso) return 'YDAY';
    const d7 = new Date(); d7.setDate(d7.getDate() - 6);
    if (dateStart === toIsoDate(d7) && dateEnd === t) return '7D';
    const d30 = new Date(); d30.setDate(d30.getDate() - 29);
    if (dateStart === toIsoDate(d30) && dateEnd === t) return '30D';
    return 'CUSTOM';
  }, [dateStart, dateEnd]);

  // Filter orders by status AND date range (inclusive)
  const filtered = useMemo(() => {
    const startTs = startOfDayTs(dateStart);
    const endTs = endOfDayTs(dateEnd);
    const list = orders.filter((o) => {
      const statusOk = filter === 'ALL'
        ? true
        : (o.status || '') === filter || (filter === 'CLOSED' && ['CLOSED', 'COMPLETED'].includes(o.status || ''));
      if (!statusOk) return false;
      const ts = o.createdAt || 0;
      if (startTs != null && ts < startTs) return false;
      if (endTs != null && ts > endTs) return false;
      return true;
    });
    return [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [orders, filter, dateStart, dateEnd]);

  const totals = useMemo(() => {
    const m: Record<string, number> = {};
    for (const o of orders) m[o.status || 'NEW'] = (m[o.status || 'NEW'] || 0) + 1;
    m.CLOSED = (m.CLOSED || 0) + (m.COMPLETED || 0);
    return m;
  }, [orders]);

  // Sales total respects the date + status filters
  const salesTotalCents = useMemo(
    () => filtered
      .filter((o) => ['DELIVERED', 'CLOSED', 'COMPLETED', 'PAID'].includes(o.status || '') || o.paymentStatus === 'PAID')
      .reduce((s, o) => s + Math.round((o.totalAmount || 0) * 100), 0),
    [filtered],
  );

  // Human-readable date-range label for the header + sales chip
  const rangeLabel = useMemo(() => {
    if (!dateStart && !dateEnd) return 'today';
    if (dateStart && dateEnd) {
      if (dateStart === dateEnd) {
        return dateStart === todayIso ? 'today' : `${dateStart}`;
      }
      return `${dateStart} → ${dateEnd}`;
    }
    if (dateStart) return `from ${dateStart}`;
    return `up to ${dateEnd}`;
  }, [dateStart, dateEnd]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="p-4 sm:p-6 pb-4 border-b border-white/5 bg-slate-900/30 backdrop-blur-xl space-y-3">
        {/* Row 1: title + stats */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] font-black text-amber-400/80">Live Order Queue</div>
            <h2 className="text-xl sm:text-2xl font-black mt-1 flex items-center gap-2 sm:gap-3 flex-wrap">
              <span className="text-gradient-neon">Orders</span>
              <span className="text-white">· {filtered.length} shown</span>
              <span className="chip-neon !text-[11px] !py-1 !px-3">
                💰 {formatCentsToNgn(salesTotalCents)} paid · {rangeLabel}
              </span>
            </h2>
          </div>
        </div>

        {/* Row 2: Status filters */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {filters.map((f) => {
            const active = filter === f;
            const cnt = f === 'ALL' ? orders.length : f === 'CLOSED' ? totals.CLOSED || 0 : totals[f] || 0;
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`min-h-[2.25rem] sm:min-h-[2.75rem] rounded-xl px-2.5 sm:px-3.5 text-xs sm:text-sm font-bold transition-all ring-1 ring-inset inline-flex items-center gap-1.5 sm:gap-2 ${
                  active
                    ? 'text-slate-950 shadow-glow-restaurant ring-transparent animate-neon-pulse'
                    : 'text-ink-200 bg-white/5 ring-white/10 hover:ring-amber-400/30'
                }`}
                style={active ? {
                  background: 'linear-gradient(120deg, #FFD700 0%, #D4AF37 38%, #CD7F32 72%, #F59E0B 100%)',
                } : {}}
              >
                {f === 'ALL' ? '🌐 All' : ORDER_STATUS_STYLES[f]?.label || f}
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-black tabular-nums ${
                  active ? 'bg-slate-950/25 text-slate-950' : 'bg-white/10 text-white'
                }`}>
                  {cnt}
                </span>
              </button>
            );
          })}
        </div>

        {/* Row 3: Date presets */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {DATE_PRESETS.map((p) => {
            const active = activePreset === p.id;
            return (
              <button
                key={p.id}
                onClick={p.apply}
                className={`min-h-[2.1rem] rounded-xl px-2.5 sm:px-3 text-[11px] sm:text-xs font-black transition-all ring-1 ring-inset inline-flex items-center gap-1 ${
                  active
                    ? 'text-slate-950 shadow-glow-restaurant ring-transparent'
                    : 'text-ink-200 bg-white/5 ring-white/10 hover:ring-amber-400/30'
                }`}
                style={active ? {
                  background: 'linear-gradient(120deg, #FFD700 0%, #CD7F32 60%, #F59E0B 100%)',
                } : {}}
              >
                {p.label}
              </button>
            );
          })}
          {/* Custom toggle — active when user manually edits dates or uses a non-preset range */}
          <button
            onClick={() => {
              // Seed custom with today + today if no range set, else keep existing
              if (!dateStart && !dateEnd) { setDateStart(todayIso); setDateEnd(todayIso); }
            }}
            className={`min-h-[2.1rem] rounded-xl px-2.5 sm:px-3 text-[11px] sm:text-xs font-black transition-all ring-1 ring-inset inline-flex items-center gap-1 ${
              activePreset === 'CUSTOM'
                ? 'text-slate-950 shadow-glow-restaurant ring-transparent'
                : 'text-ink-200 bg-white/5 ring-white/10 hover:ring-amber-400/30'
            }`}
            style={activePreset === 'CUSTOM' ? {
              background: 'linear-gradient(120deg, #FFD700 0%, #CD7F32 60%, #F59E0B 100%)',
            } : {}}
          >
            🎯 Custom
          </button>
          {(dateStart || dateEnd) && (
            <button
              onClick={clearDateRange}
              className="min-h-[2.1rem] rounded-xl px-2.5 text-[11px] font-black text-rose-200 bg-rose-500/10 ring-1 ring-inset ring-rose-400/25 hover:ring-rose-400/50 transition-all"
              title="Clear date range"
            >
              ✕ Clear
            </button>
          )}
        </div>

        {/* Row 4: Custom Start / End date inputs — only shown when Custom is active or range is manually entered */}
        {(activePreset === 'CUSTOM' || dateStart || dateEnd) && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-2.5 rounded-2xl bg-white/[0.03] ring-1 ring-inset ring-amber-400/15">
            <div className="flex-1 flex items-center gap-2 min-w-0">
              <label className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-300/80 shrink-0 w-16">
                From
              </label>
              <input
                type="date"
                value={dateStart || ''}
                max={dateEnd || todayIso}
                onChange={(e) => setDateStart(e.target.value || null)}
                className="flex-1 min-w-0 min-h-[2.25rem] rounded-xl px-3 text-sm font-bold bg-slate-950/60 text-white ring-1 ring-inset ring-white/10 focus:ring-amber-400/50 outline-none [color-scheme:dark]"
              />
            </div>
            <div className="flex-1 flex items-center gap-2 min-w-0">
              <label className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-300/80 shrink-0 w-16">
                To
              </label>
              <input
                type="date"
                value={dateEnd || ''}
                min={dateStart || undefined}
                max={todayIso}
                onChange={(e) => setDateEnd(e.target.value || null)}
                className="flex-1 min-w-0 min-h-[2.25rem] rounded-xl px-3 text-sm font-bold bg-slate-950/60 text-white ring-1 ring-inset ring-white/10 focus:ring-amber-400/50 outline-none [color-scheme:dark]"
              />
            </div>
          </div>
        )}
      </div>

      {/* Order list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-16 sm:py-24 px-6">
            <div className="text-5xl sm:text-6xl mb-4 animate-float-slow">📋</div>
            <h3 className="text-lg sm:text-xl font-black text-white mb-1">No orders match this filter</h3>
            <p className="text-ink-300 max-w-md text-sm">
              {dateStart || dateEnd ? (
                <>
                  No orders were created between <span className="text-amber-300 font-bold">{rangeLabel}</span> with status <span className="text-amber-300 font-bold">{filter === 'ALL' ? '(any)' : filter}</span>. Try a wider range or switch to <span className="text-amber-300 font-bold">🌐 All Time</span>.
                </>
              ) : (
                <>
                  Create an order in the Menu tab, or hold an order to see it here as <span className="text-amber-300 font-bold">On Hold</span>.
                </>
              )}
            </p>
          </div>
        ) : (
          <div className="p-4 sm:p-6 space-y-3">
            {filtered.map((o) => {
              const st = o.status || 'NEW';
              const stl = ORDER_STATUS_STYLES[st] || ORDER_STATUS_STYLES.NEW;
              const items = o.items || [];
              const lineCount = items.length;
              const qtyCount = items.reduce((s: number, it: any) => s + (it.quantity || 0), 0);
              const minsAgo = Math.max(0, Math.round((Date.now() - (o.createdAt || Date.now())) / 60000));
              const createdIso = (() => {
                const d = new Date(o.createdAt || Date.now());
                return toIsoDate(d);
              })();
              return (
                <div key={o.id} className="card-glow card p-4 flex flex-col sm:flex-row sm:items-center gap-4 relative overflow-hidden group hover:shadow-glow-restaurant transition-all">
                  <div className="absolute -left-20 top-1/2 -translate-y-1/2 h-40 w-40 rounded-full blur-3xl opacity-20 group-hover:opacity-40 transition-opacity pointer-events-none"
                    style={{ background: 'radial-gradient(circle, rgba(255,215,0,0.6) 0%, transparent 70%)' }}
                  />
                  <div className={`shrink-0 w-full sm:w-44 p-4 rounded-2xl ring-1 ring-inset relative ${stl.bg}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`status-dot ${stl.dot.replace('h-2.5', 'h-3').replace('w-2.5', 'w-3')}`} />
                      <span className={`text-[10px] font-black uppercase tracking-[0.16em] ${stl.text}`}>{stl.label}</span>
                    </div>
                    <div className="text-2xl font-black text-white leading-none mb-1">
                      {o.orderNumber || `#${(o.id || '').slice(-5).toUpperCase()}`}
                    </div>
                    <div className="text-[11px] text-ink-300 font-bold uppercase tracking-wider mt-1">
                      {minsAgo < 1 ? 'Just now' : minsAgo < 60 ? `${minsAgo}m ago` : `${Math.floor(minsAgo / 60)}h ${minsAgo % 60}m ago`}
                    </div>
                    <div className="text-[10px] text-ink-400 font-bold mt-1 tabular-nums">
                      {createdIso}
                    </div>
                    <div className="mt-3 chip !py-0.5 !px-2 !text-[10px] !font-black uppercase tracking-widest inline-flex">
                      {o.orderType?.replace('_', ' ') || 'POS ORDER'}
                    </div>
                  </div>

                  <div className="flex-1 min-w-0 space-y-2 relative">
                    <div className="flex flex-wrap items-center gap-2">
                      {o.tableName && (
                        <button onClick={() => onOpenTable(o.tableId, o.tableName)} className="chip-neon !py-1 !px-3 !text-xs !font-bold">
                          🪑 {o.tableName}
                        </button>
                      )}
                      {o.paymentStatus && (() => {
                        // Full 7-state PaymentStatus chip rendering with tinted
                        // gradients + emoji labels so attendants spot unpaid
                        // (QR / website) orders at a glance.
                        const ps = String(o.paymentStatus).toUpperCase();
                        const meta: Record<string, { label: string; cls: string }> = {
                          PAID: {
                            label: '✅ PAID',
                            cls: '!bg-[linear-gradient(120deg,rgba(16,185,129,0.20),rgba(212,175,55,0.15))] !text-emerald-200 !ring-emerald-400/30',
                          },
                          PARTIALLY_PAID: {
                            label: '💳 PART PAID',
                            cls: '!bg-[linear-gradient(120deg,rgba(56,189,248,0.20),rgba(99,102,241,0.18))] !text-sky-200 !ring-sky-400/30',
                          },
                          PENDING: {
                            label: '⏳ PENDING',
                            cls: '!bg-[linear-gradient(120deg,rgba(251,191,36,0.20),rgba(234,88,12,0.16))] !text-amber-200 !ring-amber-400/30',
                          },
                          FAILED: {
                            label: '❌ FAILED',
                            cls: '!bg-rose-500/15 !text-rose-200 !ring-rose-400/35',
                          },
                          REFUNDED: {
                            label: '↩️ REFUNDED',
                            cls: '!bg-slate-700/40 !text-slate-200 !ring-slate-500/40',
                          },
                          PARTIALLY_REFUNDED: {
                            label: '↩️ PART REFUND',
                            cls: '!bg-violet-500/15 !text-violet-200 !ring-violet-400/30',
                          },
                          UNPAID: {
                            label: '⏳ UNPAID',
                            cls: '!bg-rose-500/10 !text-rose-200 !ring-rose-400/25',
                          },
                        };
                        const m = meta[ps] || meta.UNPAID;
                        return (
                          <span className={`chip !py-1 !px-3 !text-xs !font-bold uppercase tracking-wider ${m.cls}`}>
                            {m.label}
                          </span>
                        );
                      })()}
                      {/* Customer identity chips — shows who placed the website/QR order */}
                      {o.customerName && (
                        <span className="chip !py-1 !px-3 !text-xs !font-bold !bg-white/5 !text-white !ring-white/15">
                          👤 {o.customerName}
                        </span>
                      )}
                      {o.customerPhone && (
                        <span className="chip !py-1 !px-3 !text-xs !font-bold !bg-cyan-500/10 !text-cyan-200 !ring-cyan-400/25" title={`Call ${o.customerPhone}`}>
                          📞 {o.customerPhone}
                        </span>
                      )}
                      {o.customerEmail && (
                        <span className="chip !py-1 !px-3 !text-xs !font-bold !bg-violet-500/10 !text-violet-200 !ring-violet-400/25" title={`Email ${o.customerEmail}`}>
                          📧 {o.customerEmail}
                        </span>
                      )}
                      <span className="text-xs text-ink-300 font-semibold">
                        {qtyCount} item{qtyCount === 1 ? '' : 's'} · {lineCount} line{lineCount === 1 ? '' : 's'}
                      </span>
                      {o.notes && (
                        <span className="chip !py-1 !px-3 !text-xs !font-bold !bg-amber-500/10 !text-amber-200 !ring-amber-400/25">
                          📝 Note
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {items.slice(0, 5).map((it: any, i: number) => (
                        <span key={i} className="text-[11px] text-ink-200 bg-white/5 rounded-lg px-2 py-1 ring-1 ring-inset ring-white/10 font-bold">
                          {it.quantity || 1}× {it.name}
                        </span>
                      ))}
                      {items.length > 5 && (
                        <span className="text-[11px] text-amber-300 bg-amber-500/10 rounded-lg px-2 py-1 ring-1 ring-inset ring-amber-400/25 font-black">
                          +{items.length - 5} more
                        </span>
                      )}
                    </div>
                    {o.notes && (
                      <div className="text-xs text-amber-200 font-semibold bg-amber-500/10 rounded-xl px-3 py-2 ring-1 ring-inset ring-amber-400/20">
                        💬 {o.notes}
                      </div>
                    )}
                  </div>

                  <div className="sm:w-60 shrink-0 flex flex-col gap-2 relative">
                    <div className="card p-3 text-right relative overflow-hidden">
                      <div className="absolute inset-0 opacity-40 pointer-events-none"
                        style={{ background: 'radial-gradient(circle at 100% 0%, rgba(255,215,0,0.18), transparent 60%)' }}
                      />
                      <div className="text-[10px] text-ink-400 font-black uppercase tracking-widest text-right mb-1">Total</div>
                      <div className="text-2xl font-black text-gradient-neon tabular-nums leading-none">
                        {formatCentsToNgn(Math.round((o.totalAmount || 0) * 100))}
                      </div>
                      {(o.balanceDue || 0) > 0 && (
                        <div className="text-[11px] text-rose-300 font-bold mt-1.5 tabular-nums">
                          Bal: {formatCentsToNgn(Math.round((o.balanceDue || 0) * 100))}
                        </div>
                      )}
                    </div>
                    {(() => {
                      // Counter-attendant Mark-as-Paid: available for every order
                      // that isn't already PAID and isn't CANCELLED. Covers QR
                      // Pay-at-Counter, website online orders, and any
                      // partially-paid splits.
                      const canMarkPaid =
                        onMarkPaid &&
                        st !== 'CANCELLED' &&
                        o.paymentStatus !== 'PAID' &&
                        o.paymentStatus !== 'REFUNDED';
                      const actionCols = canMarkPaid
                        ? ['CLOSED', 'COMPLETED', 'CANCELLED'].includes(st)
                          ? 3 // MarkPaid + Recall + Receipt (no Next when closed)
                          : 4
                        : ['CLOSED', 'COMPLETED', 'CANCELLED'].includes(st)
                          ? 2
                          : 3;
                      return (
                        <div className={`grid gap-2 ${
                          actionCols === 4 ? 'grid-cols-2 sm:grid-cols-4'
                            : actionCols === 3 ? 'grid-cols-3'
                            : 'grid-cols-2'
                        }`}>
                          {canMarkPaid && (
                            <button
                              onClick={() => onMarkPaid!(o)}
                              className="btn-neon-cyan !min-h-11 !px-2 !py-2 !text-[11px] !font-black shadow-glow-restaurant animate-neon-pulse"
                              title="Record counter payment (cash / card at POS / transfer)"
                            >
                              💵 Mark Paid
                            </button>
                          )}
                          {!['CLOSED', 'COMPLETED', 'CANCELLED'].includes(st) && (
                            <button onClick={() => onBumpStatus(o)} className="btn-primary !min-h-11 !px-2 !py-2 !text-[11px] !font-black">
                              ⬆️ Next
                            </button>
                          )}
                          <button
                            onClick={() => onRecall(o)}
                            className="btn-secondary !min-h-11 !px-2 !py-2 !text-[11px] !font-black"
                          >
                            📂 Recall
                          </button>
                          <button
                            onClick={() => onPrintReceipt?.(o)}
                            className="btn-secondary !min-h-11 !px-2 !py-2 !text-[11px] !font-black"
                            title="Print a copy of the receipt"
                          >
                            🖨️ Receipt
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ====================== ReportsPanel: Quick shift stats ======================
function ReportsPanel({ orders, employee, shift }: { orders: any[]; employee: any; shift: OpenShiftState }) {
  const paid = orders.filter((o) => o.paymentStatus === 'PAID' || ['COMPLETED', 'DELIVERED', 'CLOSED'].includes(o.status || ''));
  const revenueCents = paid.reduce((s, o) => s + Math.round((o.totalAmount || 0) * 100), 0);
  const ordersCount = orders.length;
  const avgCents = ordersCount > 0 ? Math.round(revenueCents / ordersCount) : 0;

  const topItems = useMemo(() => {
    const tally: Record<string, { name: string; qty: number; revenue: number }> = {};
    for (const o of orders) {
      for (const it of o.items || []) {
        const key = it.menuItemId || it.name || 'unknown';
        const entry = tally[key] || { name: it.name, qty: 0, revenue: 0 };
        entry.qty += it.quantity || 1;
        entry.revenue += (it.unitPrice || 0) * (it.quantity || 1);
        tally[key] = entry;
      }
    }
    return Object.values(tally).sort((a, b) => b.qty - a.qty).slice(0, 6);
  }, [orders]);

  const byStatus = useMemo(() => {
    const m: Record<string, number> = {};
    for (const o of orders) m[o.status || 'NEW'] = (m[o.status || 'NEW'] || 0) + 1;
    return m;
  }, [orders]);

  const shiftElapsed = shift.openedAt ? Date.now() - shift.openedAt : 0;
  const hrs = Math.floor(shiftElapsed / 3600000);
  const mins = Math.floor((shiftElapsed % 3600000) / 60000);

  const cards = [
    { label: 'Revenue', value: formatCentsToNgn(revenueCents), sub: `${paid.length} paid orders`, icon: '💰', tint: 'from-[#FFD700]/30' },
    { label: 'Orders', value: ordersCount.toString(), sub: `${Object.values(byStatus).reduce((a, b) => a + b, 0) || 0} total lifecycle`, icon: '📦', tint: 'from-[#CD7F32]/30' },
    { label: 'Avg Order', value: formatCentsToNgn(avgCents), sub: 'Across all orders', icon: '📊', tint: 'from-[#EA580C]/28' },
    { label: 'Shift Length', value: `${hrs}h ${pad2(mins)}m`, sub: shift.shiftId ? 'Since opened' : 'Shift not yet opened', icon: '🕒', tint: 'from-[#22D3EE]/26' },
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <div className="p-6 pb-4 border-b border-white/5 bg-slate-900/30 backdrop-blur-xl space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] font-black text-amber-400/80">Live Analytics</div>
            <h2 className="text-3xl font-black mt-1">
              <span className="text-gradient-neon animate-text-glow">Reports</span>
              <span className="text-white"> · Shift Console</span>
            </h2>
            <div className="mt-2 text-sm text-ink-300 font-semibold">
              Cashier: <span className="text-white font-bold">{employee?.firstName || employee?.name || '—'} {employee?.lastName || ''}</span>
              <span className="dot-separator mx-2.5 align-middle" />
              Branch: <span className="text-white font-bold">{employee?.branch?.name || 'Main Branch'}</span>
            </div>
          </div>
          <div className="chip-neon !py-2 !px-4 !text-xs !font-black uppercase tracking-[0.14em]">
            📈 {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* KPI cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map((c) => (
            <div key={c.label} className="card-glow card neon-border p-5 relative overflow-hidden group">
              <div className={`absolute -top-16 -right-16 h-40 w-40 rounded-full blur-3xl opacity-60 bg-gradient-to-br ${c.tint} to-transparent group-hover:opacity-90 transition-opacity`} />
              <div className="flex items-start justify-between mb-4 relative">
                <div className="text-[11px] uppercase tracking-[0.18em] font-black text-ink-300">{c.label}</div>
                <div className="h-11 w-11 rounded-2xl shadow-glow-restaurant flex items-center justify-center text-xl animate-float-slow ring-1 ring-inset ring-white/15"
                  style={{ background: 'linear-gradient(135deg, rgba(255,215,0,0.20) 0%, rgba(205,127,50,0.15) 100%)' }}
                >
                  {c.icon}
                </div>
              </div>
              <div className="text-3xl font-black text-white leading-none mb-2 relative tabular-nums">
                {c.value}
              </div>
              <div className="text-xs text-ink-300 font-bold relative">{c.sub}</div>
            </div>
          ))}
        </div>

        {/* 2-column split */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Top items */}
          <div className="lg:col-span-2 card-glow card p-6 relative overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-neon" />
            <div className="flex items-center justify-between mb-5">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] font-black text-amber-400/80">Performance</div>
                <h3 className="text-xl font-black text-white mt-1">🏆 Top Selling Items</h3>
              </div>
              <div className="chip !py-1 !px-3 !text-xs !font-bold uppercase tracking-widest text-amber-300 !ring-amber-400/30 !bg-amber-500/10">
                Top {topItems.length}
              </div>
            </div>
            {topItems.length === 0 ? (
              <div className="text-center py-12 text-ink-300">No sales yet — create orders in Menu tab to populate reports.</div>
            ) : (
              <div className="space-y-3">
                {topItems.map((it, i) => {
                  const max = topItems[0]?.qty || 1;
                  const pct = Math.max(4, Math.round((it.qty / max) * 100));
                  return (
                    <div key={i} className="relative">
                      <div className="flex items-center justify-between text-sm mb-2 relative z-10">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="h-8 w-8 rounded-xl flex items-center justify-center text-xs font-black text-slate-950 shadow-glow-restaurant shrink-0"
                            style={{ background: i === 0 ? 'linear-gradient(135deg, #FFD700, #D4AF37)' : i === 1 ? 'linear-gradient(135deg, #CD7F32, #EA580C)' : 'linear-gradient(135deg, rgba(212,175,55,0.6), rgba(205,127,50,0.6))' }}
                          >
                            {i + 1}
                          </span>
                          <div className="font-bold text-white truncate">{it.name}</div>
                        </div>
                        <div className="text-ink-200 font-bold tabular-nums shrink-0 ml-3 flex items-center gap-3">
                          <span className="chip-neon !py-0.5 !px-2.5 !text-[11px]">
                            {it.qty} sold
                          </span>
                          <span className="text-amber-300">
                            ₦{(it.revenue || 0).toFixed(0)}
                          </span>
                        </div>
                      </div>
                      <div className="h-2.5 rounded-full bg-white/5 ring-1 ring-inset ring-white/10 overflow-hidden relative">
                        <div className="h-full rounded-full animate-neon-pulse"
                          style={{
                            width: `${pct}%`,
                            background: 'linear-gradient(90deg, #FFD700 0%, #D4AF37 45%, #CD7F32 100%)',
                            boxShadow: '0 0 14px -2px rgba(212,175,55,0.7)',
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Status breakdown */}
          <div className="card-glow card p-6 relative overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-1" style={{ background: 'linear-gradient(90deg, #22D3EE, #CD7F32, #FFD700)' }} />
            <div className="mb-5">
              <div className="text-[11px] uppercase tracking-[0.18em] font-black text-amber-400/80">Snapshot</div>
              <h3 className="text-xl font-black text-white mt-1">📊 Order Status</h3>
            </div>
            <div className="space-y-3">
              {Object.entries(ORDER_STATUS_STYLES).filter(([k]) => !['COMPLETED', 'CANCELLED'].includes(k)).map(([k, stl]) => {
                const cnt = k === 'CLOSED' ? (byStatus.CLOSED || 0) + (byStatus.COMPLETED || 0) : byStatus[k] || 0;
                const pct = Math.max(0, Math.round((cnt / Math.max(1, orders.length)) * 100));
                return (
                  <div key={k}>
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className={`status-dot ${stl.dot}`} />
                        <span className="font-black text-white">{stl.label}</span>
                      </div>
                      <span className="font-bold text-ink-200 tabular-nums">{cnt} · {pct}%</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-white/5 ring-1 ring-inset ring-white/10 overflow-hidden">
                      <div className={`h-full rounded-full ${stl.bg}`} style={{ width: `${pct}%`, boxShadow: '0 0 10px -2px rgba(212,175,55,0.45)' }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-6 pt-5 border-t border-white/5">
              <div className="text-[11px] uppercase tracking-[0.16em] font-black text-ink-300 mb-3">Opening Float</div>
              <div className="text-2xl font-black text-gradient-neon tabular-nums">
                {shift.openingCashCents ? formatCentsToNgn(shift.openingCashCents) : '— Not opened'}
              </div>
              <div className="text-xs text-ink-300 mt-1.5 font-semibold">
                {shift.openedAt
                  ? `Since ${new Date(shift.openedAt).toLocaleTimeString()}`
                  : 'Open your shift in the Shift tab →'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}
