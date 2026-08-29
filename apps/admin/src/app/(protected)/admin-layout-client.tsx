'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/lib/auth-store';
import { cn } from '@/lib/cn';
import { toast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { apiGet, apiPost } from '@/lib/api-client';
import { Badge } from '@/components/ui/Badge';
import type { Role } from '@prolific/shared-types';

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  group?: string;
}

const NAV_ITEMS: NavItem[] = [
  {
    label: 'Dashboard',
    href: '/dashboard',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" />
      </svg>
    ),
  },
  {
    label: 'Orders',
    href: '/orders',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M9 2h6a2 2 0 012 2v1h1a3 3 0 013 3v11a3 3 0 01-3 3H7a3 3 0 01-3-3V8a3 3 0 013-3h1V4a2 2 0 012-2z" />
        <path d="M9 13h6M9 17h4" />
      </svg>
    ),
  },
];

const MENU_GROUP: NavItem[] = [
  {
    label: 'Menu Items',
    href: '/menu/items',
    group: 'Menu',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M12 2a10 10 0 0110 10c0 5-3 7-10 7S2 17 2 12A10 10 0 0112 2z" />
        <path d="M2 12h20M12 2v20" />
      </svg>
    ),
  },
  {
    label: 'Categories',
    href: '/menu/categories',
    group: 'Menu',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    label: 'Modifiers',
    href: '/menu/modifiers',
    group: 'Menu',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4.5L6 21l1.5-7.5L2 9h7z" />
      </svg>
    ),
  },
];

const OPERATIONS_GROUP: NavItem[] = [
  {
    label: 'Tables',
    href: '/tables',
    group: 'Operations',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <rect x="3" y="6" width="18" height="10" rx="2" />
        <path d="M8 16v4M16 16v4" />
      </svg>
    ),
  },
  {
    label: 'QR Codes',
    href: '/qr-codes',
    group: 'Operations',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <path d="M14 14h3v3h-3zM17 17h4M14 21h7" />
      </svg>
    ),
  },
  {
    label: 'Employees',
    href: '/employees',
    group: 'Operations',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
      </svg>
    ),
  },
];

const REPORTS_GROUP: NavItem[] = [
  {
    label: 'Sales Report',
    href: '/reports/sales',
    group: 'Reports',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M3 3v18h18" />
        <rect x="7" y="12" width="3" height="6" rx="0.5" />
        <rect x="12" y="8" width="3" height="10" rx="0.5" />
        <rect x="17" y="5" width="3" height="13" rx="0.5" />
      </svg>
    ),
  },
  {
    label: 'Inventory',
    href: '/reports/inventory',
    group: 'Reports',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
        <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />
      </svg>
    ),
  },
];

const SETTINGS_GROUP: NavItem[] = [
  {
    label: 'Branch Settings',
    href: '/settings/branch',
    group: 'Settings',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
      </svg>
    ),
  },
  {
    label: 'Customer Display',
    href: '/settings/customer-display',
    group: 'Settings',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
        <circle cx="10.5" cy="10" r="1.2" fill="currentColor" />
        <path d="M14 8.5h4M14 11h3M14 13.5h2" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    label: 'Discounts & Happy Hour',
    href: '/settings/discounts',
    group: 'Settings',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M20 12v6a2 2 0 01-2 2H6a2 2 0 01-2-2v-6" />
        <path d="M12 2v10" />
        <path d="M8 6h8" />
      </svg>
    ),
  },
];

const INVENTORY_GROUP: NavItem[] = [
  {
    label: 'Inventory Items',
    href: '/inventory/items',
    group: 'Inventory',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M21 8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
        <path d="M3.27 6.96L12 12.01l8.73-5.05" />
        <path d="M12 22.08V12" />
      </svg>
    ),
  },
  {
    label: 'Suppliers',
    href: '/inventory/suppliers',
    group: 'Inventory',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M3 7h18" />
        <path d="M5 7V5a2 2 0 012-2h10a2 2 0 012 2v2" />
        <path d="M6 7l1 14h10l1-14" />
        <path d="M10 11v6" />
        <path d="M14 11v6" />
      </svg>
    ),
  },
  {
    label: 'Purchase Orders',
    href: '/inventory/purchase-orders',
    group: 'Inventory',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M9 2h6a2 2 0 012 2v1h1a3 3 0 013 3v11a3 3 0 01-3 3H7a3 3 0 01-3-3V8a3 3 0 013-3h1V4a2 2 0 012-2z" />
        <path d="M9 13h6" />
        <path d="M9 17h4" />
      </svg>
    ),
  },
];

const ALL_NAV = [...NAV_ITEMS, ...MENU_GROUP, ...OPERATIONS_GROUP, ...INVENTORY_GROUP, ...REPORTS_GROUP, ...SETTINGS_GROUP];

const ROLE_VARIANTS: Record<Role, { variant: any; label: string }> = {
  SUPER_ADMIN: { variant: 'accent', label: 'Super Admin' },
  ADMIN: { variant: 'brand', label: 'Admin' },
  MANAGER: { variant: 'success', label: 'Manager' },
  SUPERVISOR: { variant: 'info', label: 'Supervisor' },
  CASHIER: { variant: 'warning', label: 'Cashier' },
  KITCHEN: { variant: 'danger', label: 'Kitchen' },
  WAITER: { variant: 'soft', label: 'Waiter' },
  ACCOUNTANT: { variant: 'info', label: 'Accountant' },
};

export default function AdminLayoutClient({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { initFromStorage, clearAuth, user, employee, branch, accessToken, getRole, setApprovalToken, hasValidApprovalToken } = useAuthStore();

  const [collapsed, setCollapsed] = useState(false);
  const [clock, setClock] = useState('');
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showBranchMenu, setShowBranchMenu] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinLoading, setPinLoading] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const branchMenuRef = useRef<HTMLDivElement>(null);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const hasAuth = initFromStorage();
    if (!hasAuth) {
      router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
      return;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchPending = async () => {
      try {
        const stats: any = await apiGet('/reports/dashboard/stats');
        const next = Number(stats?.pendingOrders ?? 0);
        if (!cancelled) setPendingCount(Number.isFinite(next) ? next : 0);
      } catch (_err) {
        if (!cancelled) setPendingCount(0);
      }
    };

    fetchPending();
    const t = setInterval(fetchPending, 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [branch?.id]);

  useEffect(() => {
    if (!accessToken && typeof window !== 'undefined') {
      router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
    }
  }, [accessToken, router, pathname]);

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setClock(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
      if (branchMenuRef.current && !branchMenuRef.current.contains(e.target as Node)) {
        setShowBranchMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleLogout = () => {
    clearAuth();
    toast('Signed out', { variant: 'info' });
    router.replace('/login');
  };

  const handleVerifyPin = async () => {
    if (!pinInput) {
      toast('Enter PIN', { variant: 'warning' });
      return;
    }
    setPinLoading(true);
    try {
      const res = await apiPost<any>('/auth/pin/verify', { pin: pinInput });
      setApprovalToken(res.approvalToken || res.token || pinInput, 60);
      toast('PIN verified', {
        description: 'Approval token valid for 60 seconds',
        variant: 'success',
      });
      setShowPinModal(false);
      setPinInput('');
    } catch (err: any) {
      toast('PIN verification failed', {
        description: err.message || 'Invalid PIN',
        variant: 'error',
      });
    } finally {
      setPinLoading(false);
    }
  };

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');
  const role = getRole();
  const roleVariant = role ? ROLE_VARIANTS[role] : null;

  const groupedNav = [
    { label: undefined, items: NAV_ITEMS },
    { label: 'Menu', items: MENU_GROUP },
    { label: 'Operations', items: OPERATIONS_GROUP },
    { label: 'Inventory', items: INVENTORY_GROUP },
    { label: 'Reports', items: REPORTS_GROUP },
    { label: 'Settings', items: SETTINGS_GROUP },
  ];

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <svg className="animate-spin h-10 w-10 text-brand-600" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
            <path fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" className="opacity-75" />
          </svg>
          <span className="text-sm text-slate-500">Loading workspace...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50">
      <aside
        className={cn(
          'shrink-0 h-full bg-white border-r border-slate-200 flex flex-col transition-all duration-200 relative z-20',
          collapsed ? 'w-[76px]' : 'w-64'
        )}
      >
        <div className={cn(
          'flex items-center gap-3 h-16 px-5 border-b border-slate-100 shrink-0',
          collapsed && 'justify-center px-0'
        )}>
          <div className="h-9 w-9 shrink-0 rounded-xl bg-gradient-to-br from-brand-600 to-brand-700 flex items-center justify-center shadow-soft">
            <svg viewBox="0 0 32 32" className="h-5 w-5 text-white" fill="currentColor">
              <path d="M8 4h16l-2 24H10L8 4zm4 6v2h8v-2h-8zm0 5v2h8v-2h-8zm0 5v2h5v-2h-5z" opacity=".9" />
              <circle cx="24" cy="8" r="4" fill="#F97316" />
            </svg>
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <div className="text-slate-900 font-bold text-[15px] leading-none tracking-tight">Prolific</div>
              <div className="text-slate-400 text-[11px] font-medium mt-0.5">Admin Console</div>
            </div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto scrollbar-thin py-3 px-2.5 space-y-3">
          {groupedNav.map((group) => (
            <div key={group.label || 'root'} className="space-y-0.5">
              {group.label && !collapsed && (
                <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {group.label}
                </div>
              )}
              {group.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <button
                    key={item.href}
                    onClick={() => router.push(item.href)}
                    className={cn(
                      'w-full flex items-center gap-3 rounded-xl text-sm font-medium transition-all',
                      collapsed ? 'justify-center h-10 px-0 w-10 mx-auto' : 'px-3 h-10',
                      active
                        ? 'bg-brand-50 text-brand-700 shadow-[0_0_0_1px_rgba(79,70,229,0.12)_inset]'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    )}
                    title={collapsed ? item.label : undefined}
                  >
                    <span className={cn('shrink-0', active && 'text-brand-600')}>{item.icon}</span>
                    {!collapsed && <span className="truncate">{item.label}</span>}
                    {!collapsed && item.label === 'Orders' && pendingCount > 0 && (
                      <span className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-accent-500 text-white text-[10px] font-bold">
                        {pendingCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-slate-100 p-2.5">
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="w-full flex items-center justify-center gap-2 h-9 rounded-xl text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition text-xs font-medium"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={cn('h-4 w-4 transition-transform', collapsed && 'rotate-180')}
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 shrink-0 bg-white border-b border-slate-200 flex items-center gap-3 px-4 sm:px-6 relative z-10">
          <div className="hidden md:block h-8 w-px bg-slate-200" />

          <div className="relative" ref={branchMenuRef}>
            <button
              onClick={() => setShowBranchMenu((s) => !s)}
              className="flex items-center gap-2 h-10 px-3 rounded-xl hover:bg-slate-50 transition group"
            >
              <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-brand-50 to-accent-50 border border-brand-100/60 flex items-center justify-center">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-brand-600">
                  <path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1M9 13h1M9 17h1M14 9h1M14 13h1M14 17h1" />
                </svg>
              </div>
              <div className="text-left hidden sm:block">
                <div className="text-[11px] text-slate-400 font-medium leading-none">Current Branch</div>
                <div className="text-sm font-semibold text-slate-900 leading-tight mt-0.5 flex items-center gap-1.5">
                  {branch?.name || 'All Branches'}
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-slate-400 group-hover:text-slate-600">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </div>
              </div>
            </button>

            {showBranchMenu && (
              <div className="absolute top-full left-0 mt-2 w-72 rounded-2xl bg-white shadow-2xl border border-slate-200 p-2 z-50 animate-in fade-in zoom-in-95 duration-100 origin-top-left">
                <div className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-400">Switch Branch</div>
                {branch && (
                  <button className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-slate-50 text-left">
                    <div className="h-9 w-9 rounded-lg bg-brand-50 flex items-center justify-center text-brand-700 text-sm font-bold">
                      {branch.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-900">{branch.name}</div>
                      <div className="text-xs text-slate-500 truncate">{branch.city}, {branch.country}</div>
                    </div>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-4 w-4 text-brand-600">
                      <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                )}
                {!branch && (
                  <div className="px-3 py-2 text-sm text-slate-500">No branches available</div>
                )}
              </div>
            )}
          </div>

          <div className="flex-1" />

          {roleVariant && (
            <Badge variant={roleVariant.variant as any} dot>
              {roleVariant.label}
            </Badge>
          )}

          <div className="hidden sm:flex items-center gap-2 px-3 h-9 rounded-xl bg-slate-50 border border-slate-100 text-slate-700 font-mono text-sm tabular-nums">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-slate-400">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
            {clock}
          </div>

          <button
            className="relative h-10 w-10 rounded-xl hover:bg-slate-50 flex items-center justify-center transition"
            onClick={() => toast('Notifications', { description: 'Showing latest approvals', variant: 'info' })}
            title="Notifications"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-slate-600">
              <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 01-3.46 0" />
            </svg>
            {pendingCount > 0 && (
              <span className="absolute top-2 right-2 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-accent-500 text-white text-[10px] font-bold border-2 border-white">
                {pendingCount}
              </span>
            )}
          </button>

          <div className="relative" ref={userMenuRef}>
            <button
              onClick={() => setShowUserMenu((s) => !s)}
              className="flex items-center gap-2.5 h-10 pl-1.5 pr-3 rounded-xl hover:bg-slate-50 transition"
            >
              <div className="h-7 w-7 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white text-xs font-bold shadow-soft">
                {user.firstName?.charAt(0)}{user.lastName?.charAt(0)}
              </div>
              <div className="text-left hidden sm:block">
                <div className="text-sm font-semibold text-slate-900 leading-none">{user.firstName} {user.lastName}</div>
                <div className="text-[11px] text-slate-400 mt-0.5 leading-none">{employee?.positionTitle || 'Staff'}</div>
              </div>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-slate-400">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>

            {showUserMenu && (
              <div className="absolute top-full right-0 mt-2 w-72 rounded-2xl bg-white shadow-2xl border border-slate-200 p-2 z-50 animate-in fade-in zoom-in-95 duration-100 origin-top-right">
                <div className="p-3 rounded-xl bg-slate-50 mb-1">
                  <div className="flex items-center gap-3">
                    <div className="h-11 w-11 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold shadow-soft">
                      {user.firstName?.charAt(0)}{user.lastName?.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-slate-900 truncate">{user.firstName} {user.lastName}</div>
                      <div className="text-xs text-slate-500 truncate">{user.email}</div>
                    </div>
                  </div>
                </div>
                <div className="h-px bg-slate-100 my-1" />
                <button
                  onClick={() => {
                    setShowUserMenu(false);
                    setShowPinModal(true);
                  }}
                  className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-slate-50 text-left text-sm text-slate-700"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-slate-500">
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                  <span className="flex-1">Unlock Manager Approval</span>
                  {hasValidApprovalToken() && (
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Active</span>
                  )}
                </button>
                <button className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-slate-50 text-left text-sm text-slate-700">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-slate-500">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
                  </svg>
                  <span>Preferences</span>
                </button>
                <div className="h-px bg-slate-100 my-1" />
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-red-50 text-left text-sm text-red-600"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                    <path d="M16 17l5-5-5-5M21 12H9" />
                  </svg>
                  <span>Sign out</span>
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="min-h-full p-4 sm:p-6 lg:p-8">
            <div className="mx-auto w-full max-w-[1280px]">{children}</div>
          </div>
        </main>
      </div>

      <Modal
        open={showPinModal}
        onClose={() => {
          setShowPinModal(false);
          setPinInput('');
        }}
        size="sm"
        title="Verify Manager PIN"
        description="Enter your 4-6 digit PIN for void/refund approvals"
      >
        <div className="space-y-4">
          <Input
            label="Manager PIN"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            placeholder="••••"
            value={pinInput}
            onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 8))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleVerifyPin();
            }}
            autoFocus
          />
          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              fullWidth
              onClick={() => {
                setShowPinModal(false);
                setPinInput('');
              }}
            >
              Cancel
            </Button>
            <Button fullWidth loading={pinLoading} onClick={handleVerifyPin}>
              Verify PIN
            </Button>
          </div>
          <p className="text-[11px] text-slate-400 text-center">
            Approval token will be valid for 60 seconds
          </p>
        </div>
      </Modal>
    </div>
  );
}
