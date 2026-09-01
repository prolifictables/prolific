'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { DataTable, Column } from '@/components/ui/Table';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import {
  apiGet,
  apiPost,
  unwrapList,
  sid,
} from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import {
  formatNGN,
  formatDateTime,
  formatRelativeTime,
  formatNumber,
} from '@/lib/format';
import { cn } from '@/lib/cn';
import { toast } from '@/components/ui/Toast';
import type { Order, Payment, PaymentStatus } from '@prolific/shared-types';

// ---------------------------------------------------------------------------
// Lookup maps
// ---------------------------------------------------------------------------
const STATUS_TABS: {
  value: string;
  label: string;
  variant: any;
  statuses: string[];
}[] = [
  // "ALL" — special, no filter
  { value: 'ALL', label: 'All', variant: 'soft', statuses: [] },
  // "New" = the pending/incoming queue. Server enum has RECEIVED for the
  // "order just landed" state and PENDING for items not yet acked.
  {
    value: 'NEW',
    label: 'New',
    variant: 'warning',
    statuses: ['RECEIVED', 'PENDING'],
  },
  {
    value: 'ACCEPTED',
    label: 'Accepted',
    variant: 'info',
    statuses: ['ACCEPTED'],
  },
  {
    value: 'PREPARING',
    label: 'Preparing',
    variant: 'brand',
    statuses: ['PREPARING'],
  },
  { value: 'READY', label: 'Ready', variant: 'accent', statuses: ['READY'] },
  {
    value: 'AWAITING_PAYMENT',
    label: 'Awaiting Payment',
    variant: 'warning',
    statuses: ['AWAITING_PAYMENT', 'SERVED', 'PARTIALLY_PAID'],
  },
  {
    value: 'COMPLETED',
    label: 'Completed',
    variant: 'success',
    statuses: ['COMPLETED', 'PAID'],
  },
  {
    value: 'REFUNDED',
    label: 'Refunded',
    variant: 'danger',
    statuses: ['REFUNDED'],
  },
  { value: 'VOIDED', label: 'Voided', variant: 'danger', statuses: ['VOIDED'] },
];

const ORDER_STATUS_MAP: Record<
  string,
  { variant: any; label: string }
> = {
  PENDING: { variant: 'warning', label: 'Pending' },
  RECEIVED: { variant: 'warning', label: 'New' },
  ACCEPTED: { variant: 'info', label: 'Accepted' },
  PREPARING: { variant: 'brand', label: 'Preparing' },
  READY: { variant: 'accent', label: 'Ready' },
  SERVED: { variant: 'brand', label: 'Served' },
  AWAITING_PAYMENT: { variant: 'warning', label: 'Awaiting Pay' },
  PARTIALLY_PAID: { variant: 'warning', label: 'Partially Paid' },
  PAID: { variant: 'success', label: 'Paid' },
  COMPLETED: { variant: 'success', label: 'Completed' },
  CANCELLED: { variant: 'soft', label: 'Cancelled' },
  REFUNDED: { variant: 'danger', label: 'Refunded' },
  VOIDED: { variant: 'danger', label: 'Voided' },
  ON_HOLD: { variant: 'soft', label: 'On Hold' },
};

const PAYMENT_STATUS_MAP: Record<
  PaymentStatus,
  { variant: any; label: string }
> = {
  UNPAID: { variant: 'danger', label: 'Unpaid' },
  PENDING: { variant: 'warning', label: 'Pending' },
  PARTIALLY_PAID: { variant: 'warning', label: 'Partial' },
  PAID: { variant: 'success', label: 'Paid' },
  FAILED: { variant: 'danger', label: 'Failed' },
  REFUNDED: { variant: 'danger', label: 'Refunded' },
  PARTIALLY_REFUNDED: { variant: 'warning', label: 'Part Refunded' },
};

const SOURCE_MAP: Record<
  string,
  { variant: any; label: string; icon: 'qr' | 'web' | 'pos' | 'app' | 'phone' | 'other' }
> = {
  QR: { variant: 'brand', label: 'QR Table', icon: 'qr' },
  POS: { variant: 'success', label: 'POS', icon: 'pos' },
  WEBSITE: { variant: 'info', label: 'Website', icon: 'web' },
  APP: { variant: 'accent', label: 'Mobile App', icon: 'app' },
  PHONE: { variant: 'warning', label: 'Phone', icon: 'phone' },
};

const SOURCE_OPTIONS = [
  { value: '', label: 'All Channels' },
  { value: 'POS', label: 'POS' },
  { value: 'QR', label: 'QR (Table)' },
  { value: 'WEBSITE', label: 'Website' },
  { value: 'APP', label: 'Mobile App' },
  { value: 'PHONE', label: 'Phone Order' },
];

const PAYMENT_METHOD_OPTIONS: Array<{
  value:
    | 'CASH'
    | 'CARD'
    | 'BANK_TRANSFER'
    | 'ONLINE_PAYSTACK'
    | 'ONLINE_FLUTTERWAVE'
    | 'OTHER';
  label: string;
  hint: string;
}> = [
  { value: 'CASH', label: 'Cash', hint: 'Customer paid at counter' },
  { value: 'CARD', label: 'Card Terminal', hint: 'Physical POS card machine' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer', hint: 'Bank deposit / alert confirmed' },
  { value: 'ONLINE_PAYSTACK', label: 'Paystack', hint: 'Paid online via Paystack' },
  { value: 'ONLINE_FLUTTERWAVE', label: 'Flutterwave', hint: 'Paid online via Flutterwave' },
  { value: 'OTHER', label: 'Other', hint: 'Voucher / Wallet / Gift / Comp' },
];

// Refresh cadence per project conventions: 15s general layout, 8s active
// surfaces. Orders page is an "active surface" during service so use 12s.
const REFRESH_MS = 12_000;

interface PaymentFormState {
  method: PaymentMethodOptions;
  amountNgn: string;
  tipNgn: string;
  transactionReference: string;
  notes: string;
}
type PaymentMethodOptions =
  | 'CASH'
  | 'CARD'
  | 'BANK_TRANSFER'
  | 'ONLINE_PAYSTACK'
  | 'ONLINE_FLUTTERWAVE'
  | 'OTHER';

const EMPTY_PAYMENT = (balance: number): PaymentFormState => ({
  method: 'CASH',
  // Default to the exact balance the customer owes. NGN integer amount.
  amountNgn: String(Math.max(0, Math.round(balance))),
  tipNgn: '',
  transactionReference: '',
  notes: '',
});

const NGN = (v: unknown) => {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return n;
};

export default function OrdersPage() {
  const { branch, hasValidApprovalToken, getRole } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [source, setSource] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [selected, setSelected] = useState<Order | null>(null);
  const [selectedPayments, setSelectedPayments] = useState<Payment[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);

  const [showCancel, setShowCancel] = useState(false);
  const [showVoid, setShowVoid] = useState(false);
  const [showMarkPaid, setShowMarkPaid] = useState(false);
  const [paymentForm, setPaymentForm] = useState<PaymentFormState>(
    EMPTY_PAYMENT(0)
  );
  const [actionLoading, setActionLoading] = useState(false);
  const [voidReason, setVoidReason] = useState('');

  const role = getRole();
  const canVoidRefund =
    hasValidApprovalToken() ||
    role === 'SUPER_ADMIN' ||
    role === 'ADMIN' ||
    role === 'MANAGER';

  // Debounce: user profile requires Google-like search speed; debounce input
  // but once triggered refresh as fast as API allows (no artificial lag).
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 220);
    return () => clearTimeout(t);
  }, [search]);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      const tab = STATUS_TABS.find((t) => t.value === statusFilter);
      if (tab && tab.statuses.length > 0) {
        params.set('status', tab.statuses.join(','));
      }
      if (source) params.set('source', source);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (branch?.id) params.set('branchId', branch.id);
      // Bigger fetch window than before — single-page KPI dashboard needs
      // enough data to show today's revenue counters without pagination hops.
      params.set('limit', '200');
      params.set('sort', '-createdAt');

      const res: any = await apiGet(`/orders?${params.toString()}`);
      const rows = unwrapList<Order>(res);
      // String-normalize IDs so rowKey + sidEq joins avoid the old ObjectId vs
      // string collision that broke MenuGrid / CategoryRail filters.
      const normalized = rows.map((o: any) => ({
        ...o,
        id: sid(o.id ?? o._id),
        tableId: o.tableId ? sid(o.tableId) : '',
        qrCodeId: o.qrCodeId ? sid(o.qrCodeId) : '',
      }));
      setOrders(normalized);
    } catch (err: any) {
      toast('Failed to load orders', {
        description: err.message,
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchOrderPayments = async (order: Order) => {
    setPaymentsLoading(true);
    try {
      const raw = await apiGet(
        `/payments?orderId=${encodeURIComponent(sid(order.id))}`
      );
      setSelectedPayments(unwrapList<Payment>(raw));
    } catch (_err) {
      setSelectedPayments([]);
    } finally {
      setPaymentsLoading(false);
    }
  };

  // Initial + filter-change fetch
  useEffect(() => {
    fetchOrders();
  }, [branch?.id, statusFilter, source, dateFrom, dateTo, debouncedSearch]);

  // Polled refresh keeps KPI counters live during service without a page
  // reload. Matches project convention.
  useEffect(() => {
    const id = setInterval(() => {
      void fetchOrders();
    }, REFRESH_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch?.id, statusFilter, source, dateFrom, dateTo, debouncedSearch]);

  // When the selected order changes, refresh its payment history.
  useEffect(() => {
    if (!selected) {
      setSelectedPayments([]);
      return;
    }
    void fetchOrderPayments(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  // Second search pass on the already-fetched rows — the server-side search
  // is the primary filter; this client-side layer catches token/phone/email
  // substrings the server might not index, keeping Google-fast feel.
  const filteredOrders = useMemo(() => {
    if (!debouncedSearch) return orders;
    const q = debouncedSearch.toLowerCase().trim();
    if (!q) return orders;
    return orders.filter((o: any) => {
      const hay = [
        o.orderNumber,
        o.customerName,
        o.customerPhone,
        o.customerEmail,
        o.tableName,
        o.notes,
        ...((o.items || []).map((i: any) => i.name)),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [orders, debouncedSearch]);

  // KPI counters — use filtered list so toggling status / channel filters
  // updates the KPI tiles in sync.
  const kpis = useMemo(() => {
    let count = 0;
    let revenue = 0;
    let paid = 0;
    let unpaidWebOrQr = 0;
    for (const o of filteredOrders) {
      count += 1;
      revenue += NGN(o.totalAmount);
      paid += NGN((o as any).paidAmount);
      const src = String(o.sourceChannel || '').toUpperCase();
      const ps = String(o.paymentStatus || '').toUpperCase();
      if ((src === 'QR' || src === 'WEBSITE' || src === 'PHONE') && ps !== 'PAID' && ps !== 'REFUNDED' && ps !== 'PARTIALLY_REFUNDED') {
        unpaidWebOrQr += NGN((o as any).balanceDue ?? Math.max(0, NGN(o.totalAmount) - NGN((o as any).paidAmount)));
      }
    }
    const avg = count > 0 ? revenue / count : 0;
    return { count, revenue, avg, unpaidWebOrQr, paid };
  }, [filteredOrders]);

  // Per-status tab live counts so staff can eyeball queue depth at a glance.
  const tabCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const o of orders) {
      const s = String(o.status || '');
      for (const tab of STATUS_TABS) {
        if (tab.value === 'ALL') continue;
        if (tab.statuses.includes(s)) m[tab.value] = (m[tab.value] ?? 0) + 1;
      }
    }
    m['ALL'] = orders.length;
    return m;
  }, [orders]);

  // --- Actions -------------------------------------------------------------

  const openMarkPaid = (o: Order) => {
    const balance = Math.max(
      0,
      NGN((o as any).balanceDue) ||
        NGN(o.totalAmount) - NGN((o as any).paidAmount)
    );
    setSelected(o);
    setPaymentForm(EMPTY_PAYMENT(balance));
    setShowMarkPaid(true);
  };

  const handleRecordPayment = async () => {
    if (!selected) return;
    const amountNgn = Math.round(NGN(paymentForm.amountNgn));
    if (amountNgn <= 0) {
      toast('Enter amount', { variant: 'warning' });
      return;
    }
    const tipNgn = Math.round(NGN(paymentForm.tipNgn));
    setActionLoading(true);
    try {
      const idempotencyKey = `admin-mark-paid-${sid(selected.id)}-${Date.now()}`;
      await apiPost('/payments', {
        idempotencyKey,
        orderId: sid(selected.id),
        amountCents: amountNgn, // NOTE: server schema field named amountCents but NGN whole-naira convention
        tipCents: tipNgn || undefined,
        currency: 'NGN',
        method: paymentForm.method,
        notes: paymentForm.notes || undefined,
        customerName: selected.customerName || undefined,
        customerPhone: selected.customerPhone || undefined,
        transactionReference: paymentForm.transactionReference || undefined,
        provider:
          paymentForm.method === 'ONLINE_PAYSTACK'
            ? 'PAYSTACK'
            : paymentForm.method === 'ONLINE_FLUTTERWAVE'
            ? 'FLUTTERWAVE'
            : undefined,
      });
      toast('Payment recorded', { variant: 'success' });
      setShowMarkPaid(false);
      await fetchOrders();
      await fetchOrderPayments(selected);
    } catch (err: any) {
      toast('Failed to record payment', {
        description: err.message,
        variant: 'error',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!selected) return;
    setActionLoading(true);
    try {
      await apiPost(`/orders/${sid(selected.id)}/cancel`, {
        reason: voidReason || 'Customer cancelled',
      });
      toast('Order cancelled', { variant: 'success' });
      setShowCancel(false);
      setVoidReason('');
      fetchOrders();
    } catch (err: any) {
      toast('Cancel failed', { description: err.message, variant: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleVoid = async () => {
    if (!selected) return;
    if (!canVoidRefund) {
      toast('Manager PIN required', {
        description: 'Please unlock manager approval first',
        variant: 'warning',
      });
      setShowVoid(false);
      return;
    }
    setActionLoading(true);
    try {
      const approvalToken = useAuthStore.getState().approvalToken;
      await apiPost(`/orders/${sid(selected.id)}/void`, {
        reason: voidReason || 'Voided by admin',
        approvalToken,
      });
      toast('Order voided', { variant: 'success' });
      setShowVoid(false);
      setVoidReason('');
      fetchOrders();
    } catch (err: any) {
      toast('Void failed', { description: err.message, variant: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  // --- Columns -------------------------------------------------------------

  const SourceIcon = ({ kind }: { kind: string }) => {
    const cls = 'h-3.5 w-3.5';
    if (kind === 'qr')
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cls}>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <path d="M14 14h3v3h-3zM20 14h1v1h-1zM14 20h1v1h-1zM17 17h1v1h-1zM20 17h1v4h-4v-1h3z" strokeLinejoin="round" />
        </svg>
      );
    if (kind === 'web')
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cls}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18" />
        </svg>
      );
    if (kind === 'pos')
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cls}>
          <rect x="3" y="4" width="18" height="9" rx="2" />
          <path d="M7 18h10M9 22h6M7 8h4M15 8h2M7 11h6M16 11h2" />
        </svg>
      );
    if (kind === 'phone')
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cls}>
          <rect x="6" y="2" width="12" height="20" rx="2" />
          <path d="M10 18h4M11 5h2" />
        </svg>
      );
    if (kind === 'app')
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cls}>
          <rect x="5" y="2" width="14" height="20" rx="3" />
          <path d="M11 18h2" />
        </svg>
      );
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cls}>
        <circle cx="12" cy="12" r="4" />
      </svg>
    );
  };

  const columns: Column<Order>[] = [
    {
      key: 'orderNumber',
      title: 'Order',
      className: 'font-mono font-semibold text-slate-900',
      render: (r) => (
        <div className="min-w-0">
          <div className="font-mono font-semibold text-slate-900 truncate">
            {r.orderNumber}
          </div>
          <div className="text-[11px] text-slate-400">
            {formatDateTime(r.createdAt)} · {formatRelativeTime(r.createdAt)}
          </div>
        </div>
      ),
    },
    {
      key: 'table',
      title: 'Table',
      render: (r) => {
        const src = String(r.sourceChannel || '').toUpperCase();
        return (
          <div className="min-w-0">
            <Badge variant="soft" className={!r.tableName ? 'opacity-50' : ''}>
              {r.tableName || 'Takeaway'}
            </Badge>
            {src === 'QR' && r.tableName && (
              <div className="mt-1 text-[10px] text-brand-700 font-semibold">
                QR scan order
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'source',
      title: 'Source',
      render: (r) => {
        const s = String(r.sourceChannel || '').toUpperCase();
        const m = SOURCE_MAP[s] ?? {
          variant: 'soft',
          label: s || 'Other',
          icon: 'other' as const,
        };
        return (
          <Badge variant={m.variant} className="inline-flex items-center gap-1.5">
            <SourceIcon kind={m.icon} />
            {m.label}
          </Badge>
        );
      },
    },
    {
      key: 'itemsCount',
      title: 'Items',
      className: 'tabular-nums text-slate-700',
      render: (r) => `${(r.items as any)?.length ?? 0} items`,
    },
    {
      key: 'customer',
      title: 'Customer',
      render: (r) => {
        const name = r.customerName || 'Walk-in';
        const phone = (r as any).customerPhone ?? r.customerPhone;
        const email = (r as any).customerEmail;
        return (
          <div className="min-w-0 max-w-[200px]">
            <div className="font-medium text-slate-800 truncate">{name}</div>
            <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
              {phone && (
                <span
                  className="text-[11px] text-slate-500 font-mono truncate"
                  title={String(phone)}
                >
                  {String(phone)}
                </span>
              )}
              {email && (
                <span
                  className="text-[10px] text-slate-400 font-mono truncate"
                  title={String(email)}
                >
                  · {String(email)}
                </span>
              )}
            </div>
          </div>
        );
      },
    },
    {
      key: 'staff',
      title: 'Staff',
      render: (r) => (
        <div className="min-w-0">
          <div className="font-medium text-slate-800 truncate max-w-[160px]">
            {(r as any).employeeName || '—'}
          </div>
          {(r as any).employeeId && (
            <div className="text-[11px] text-slate-400 font-mono truncate max-w-[160px]">
              {(r as any).employeeId}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      title: 'Status',
      render: (r) => {
        const sc = ORDER_STATUS_MAP[r.status] || ORDER_STATUS_MAP.PENDING;
        return (
          <Badge variant={sc.variant} dot>
            {sc.label}
          </Badge>
        );
      },
    },
    {
      key: 'payment',
      title: 'Payment',
      render: (r) => {
        const ps =
          PAYMENT_STATUS_MAP[r.paymentStatus] || PAYMENT_STATUS_MAP.UNPAID;
        return <Badge variant={ps.variant}>{ps.label}</Badge>;
      },
    },
    {
      key: 'paidAmount',
      title: 'Paid',
      className: 'text-right tabular-nums',
      render: (r) => {
        const paid = NGN((r as any).paidAmount);
        if (paid <= 0) return <span className="text-slate-400">{formatNGN(0)}</span>;
        return (
          <span className="text-emerald-600 font-semibold">{formatNGN(paid)}</span>
        );
      },
    },
    {
      key: 'balanceDue',
      title: 'Balance',
      className: 'text-right tabular-nums',
      render: (r) => {
        const balance =
          NGN((r as any).balanceDue) ||
          Math.max(0, NGN(r.totalAmount) - NGN((r as any).paidAmount));
        if (balance <= 0)
          return <span className="text-emerald-600">{formatNGN(0)}</span>;
        return (
          <span className="text-rose-600 font-semibold">{formatNGN(balance)}</span>
        );
      },
    },
    {
      key: 'total',
      title: 'Total',
      className: 'text-right font-semibold text-slate-900 tabular-nums',
      render: (r) => formatNGN(r.totalAmount),
    },
    {
      key: 'actions',
      title: '',
      className: 'text-right w-[220px]',
      render: (r) => {
        const ps = String(r.paymentStatus || '').toUpperCase();
        const src = String(r.sourceChannel || '').toUpperCase();
        const needsPayment =
          ps !== 'PAID' &&
          ps !== 'REFUNDED' &&
          ps !== 'PARTIALLY_REFUNDED' &&
          r.status !== 'VOIDED' &&
          r.status !== 'CANCELLED';
        // "Mark Paid" is always available when balance > 0; but for Web / QR
        // / Phone channels we visually prioritize it since those are exactly
        // the "customer didn't pay at a staff POS yet" flows the admin needs
        // to confirm in-person.
        const prioritizePayment =
          needsPayment && (src === 'QR' || src === 'WEBSITE' || src === 'PHONE');
        return (
          <div className="flex items-center justify-end gap-1.5 flex-wrap">
            {needsPayment && (
              <Button
                variant={prioritizePayment ? 'success' : 'outline'}
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  openMarkPaid(r);
                }}
              >
                {prioritizePayment ? 'Confirm Payment' : 'Mark Paid'}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setSelected(r);
              }}
            >
              View
            </Button>
            {r.status !== 'VOIDED' &&
              r.status !== 'REFUNDED' &&
              r.status !== 'COMPLETED' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected(r);
                    setShowCancel(true);
                  }}
                >
                  Cancel
                </Button>
              )}
          </div>
        );
      },
    },
  ];

  // --- Drawer footer -------------------------------------------------------

  const drawerFooter = selected ? (
    <div className="flex items-center justify-between w-full gap-3 flex-wrap">
      <div className="text-sm">
        {!canVoidRefund &&
          (selected.status === 'COMPLETED' || selected.paymentStatus === 'PAID') && (
            <Badge variant="warning" dot>
              Manager PIN required to void
            </Badge>
          )}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {String(selected.paymentStatus || '').toUpperCase() !== 'PAID' &&
          selected.status !== 'VOIDED' &&
          selected.status !== 'CANCELLED' &&
          selected.status !== 'REFUNDED' && (
            <Button variant="success" size="sm" onClick={() => openMarkPaid(selected)}>
              Confirm Payment
            </Button>
          )}
        {selected.status !== 'VOIDED' && selected.status !== 'REFUNDED' && (
          <>
            {(selected.status === 'COMPLETED' ||
              selected.paymentStatus === 'PAID') && (
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  setShowVoid(true);
                  setVoidReason('');
                }}
              >
                Void Order
              </Button>
            )}
            {selected.status !== 'COMPLETED' &&
              selected.status !== 'CANCELLED' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowCancel(true);
                    setVoidReason('');
                  }}
                >
                  Cancel Order
                </Button>
              )}
          </>
        )}
      </div>
    </div>
  ) : undefined;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            Orders
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {formatNumber(filteredOrders.length)} orders found ·{' '}
            {branch?.name || 'All Branches'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="soft"
            className="text-[11px] inline-flex items-center gap-1.5"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live · refreshes every {Math.round(REFRESH_MS / 1000)}s
          </Badge>
          <Button variant="outline" size="sm" onClick={fetchOrders}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <path d="M23 4v6h-6M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
            Refresh
          </Button>
        </div>
      </div>

      {/* KPI Dashboard */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="!border-slate-200 !bg-slate-50/50">
          <div className="p-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Total Orders
              </div>
              <div className="mt-1 text-2xl font-bold text-slate-800 tabular-nums">
                {formatNumber(kpis.count)}
              </div>
            </div>
            <div className="h-11 w-11 rounded-xl bg-slate-200 flex items-center justify-center">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="h-5 w-5 text-slate-600"
              >
                <path d="M3 3h18v4H3zM3 9h18v12H3z" strokeLinejoin="round" />
                <path d="M7 13h10M7 17h6" strokeLinecap="round" />
              </svg>
            </div>
          </div>
        </Card>

        <Card className="!border-emerald-200 !bg-emerald-50/50">
          <div className="p-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-600">
                Revenue
              </div>
              <div className="mt-1 text-2xl font-bold text-emerald-700 tabular-nums">
                {formatNGN(kpis.revenue)}
              </div>
            </div>
            <div className="h-11 w-11 rounded-xl bg-emerald-100 flex items-center justify-center">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="h-5 w-5 text-emerald-600"
              >
                <path d="M12 1v22M17 5H9.5a3.5 3.5 0 100 7h5a3.5 3.5 0 110 7H6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
        </Card>

        <Card className="!border-brand-200 !bg-brand-50/50">
          <div className="p-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-brand-600">
                Avg Order
              </div>
              <div className="mt-1 text-2xl font-bold text-brand-700 tabular-nums">
                {formatNGN(kpis.avg)}
              </div>
            </div>
            <div className="h-11 w-11 rounded-xl bg-brand-100 flex items-center justify-center">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="h-5 w-5 text-brand-600"
              >
                <path d="M3 3v18h18M7 15l4-4 4 4 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
        </Card>

        <Card className="!border-rose-200 !bg-rose-50/50">
          <div className="p-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-rose-600">
                Unpaid Web/QR/Phone
              </div>
              <div className="mt-1 text-2xl font-bold text-rose-700 tabular-nums">
                {formatNGN(kpis.unpaidWebOrQr)}
              </div>
            </div>
            <div className="h-11 w-11 rounded-xl bg-rose-100 flex items-center justify-center">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="h-5 w-5 text-rose-600"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
        </Card>
      </div>

      {/* Filters + table */}
      <Card>
        <div className="px-5 pt-4">
          <div className="flex gap-2 overflow-x-auto scrollbar-thin pb-3 -mx-5 px-5">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setStatusFilter(tab.value)}
                className={cn(
                  'shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all',
                  statusFilter === tab.value
                    ? 'bg-brand-600 text-white border-brand-600 shadow-soft'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-brand-300 hover:text-brand-700'
                )}
              >
                <span>{tab.label}</span>
                <span
                  className={cn(
                    'ml-1 inline-flex items-center justify-center h-4 min-w-[16px] px-1.5 rounded-full text-[10px]',
                    statusFilter === tab.value
                      ? 'bg-white/20 text-white'
                      : 'bg-slate-100 text-slate-500'
                  )}
                >
                  {formatNumber(tabCounts[tab.value] ?? 0)}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <Input
            placeholder="Search order # / customer / item..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="lg:col-span-2"
            prefix={
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
            }
          />
          <Select
            options={SOURCE_OPTIONS}
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
          <Input
            type="date"
            label=""
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            placeholder="From"
          />
          <Input
            type="date"
            label=""
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            placeholder="To"
          />
        </div>

        <DataTable
          columns={columns}
          data={filteredOrders}
          rowKey={(r) => sid(r.id)}
          loading={loading}
          emptyText="No orders match your filters"
          onRowClick={(r) => setSelected(r)}
        />
      </Card>

      {/* Drawer */}
      <Drawer
        open={!!selected}
        onClose={() => setSelected(null)}
        side="right"
        size="md"
        title={selected?.orderNumber || ''}
        description={
          selected
            ? `${formatRelativeTime(selected.createdAt)} · ${selected.sourceChannel}`
            : ''
        }
        footer={drawerFooter}
      >
        {selected && <OrderDrawerBody selected={selected} payments={selectedPayments} paymentsLoading={paymentsLoading} />}
      </Drawer>

      {/* Mark Paid Modal */}
      <Modal
        open={showMarkPaid}
        onClose={() => setShowMarkPaid(false)}
        size="md"
        title="Confirm Payment"
        description={
          selected
            ? `Record ${selected.customerName ? selected.customerName + "'s" : ''} payment on ${selected.orderNumber}`
            : ''
        }
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <Button variant="outline" onClick={() => setShowMarkPaid(false)}>
              Cancel
            </Button>
            <Button loading={actionLoading} onClick={handleRecordPayment}>
              Record Payment
            </Button>
          </div>
        }
      >
        {selected && (
          <MarkPaidBody
            selected={selected}
            form={paymentForm}
            setForm={setPaymentForm}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={showCancel}
        onClose={() => {
          setShowCancel(false);
          setVoidReason('');
        }}
        onConfirm={handleCancel}
        title="Cancel Order"
        description="Cancelling will close this order. This action cannot be undone."
        confirmText="Cancel Order"
        variant="warning"
        loading={actionLoading}
      >
        <div className="mb-2">
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Reason (optional)
          </label>
          <textarea
            className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
            rows={3}
            placeholder="Why are you cancelling this order?"
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
          />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={showVoid}
        onClose={() => {
          setShowVoid(false);
          setVoidReason('');
        }}
        onConfirm={handleVoid}
        title="Void Order"
        description={
          canVoidRefund
            ? 'Voiding will reverse this transaction. This action cannot be undone and is logged for audit.'
            : 'Manager PIN is required. Please unlock approval first.'
        }
        confirmText={canVoidRefund ? 'Void Order' : 'Unlock & Void'}
        variant="danger"
        loading={actionLoading}
      >
        {canVoidRefund && (
          <div className="mb-2">
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Void Reason
            </label>
            <textarea
              className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
              rows={3}
              placeholder="Reason for voiding (required for audit)"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
            />
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}

// ------------------------ Subcomponents -----------------------------------

function OrderDrawerBody({
  selected,
  payments,
  paymentsLoading,
}: {
  selected: Order;
  payments: Payment[];
  paymentsLoading: boolean;
}) {
  const totalPaid = NGN((selected as any).paidAmount);
  const balance =
    NGN((selected as any).balanceDue) ||
    Math.max(0, NGN(selected.totalAmount) - totalPaid);
  const subtotal =
    NGN(selected.subtotal) ||
    NGN(selected.totalAmount) -
      NGN(selected.taxAmount) -
      NGN(selected.tipAmount) +
      NGN(selected.discountAmount);

  return (
    <div className="space-y-5">
      {/* Summary grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-slate-50 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Status
          </div>
          <div className="mt-2">
            {(() => {
              const s =
                ORDER_STATUS_MAP[selected.status] || ORDER_STATUS_MAP.PENDING;
              return (
                <Badge variant={s.variant} dot className="text-sm">
                  {s.label}
                </Badge>
              );
            })()}
          </div>
        </div>
        <div className="rounded-xl bg-slate-50 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Payment
          </div>
          <div className="mt-2">
            {(() => {
              const p =
                PAYMENT_STATUS_MAP[selected.paymentStatus] ||
                PAYMENT_STATUS_MAP.UNPAID;
              return (
                <Badge variant={p.variant} className="text-sm">
                  {p.label}
                </Badge>
              );
            })()}
          </div>
        </div>
        <div className="rounded-xl bg-slate-50 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Table
          </div>
          <div className="mt-1.5 text-sm font-semibold text-slate-900">
            {selected.tableName || 'Takeaway'}
          </div>
          {selected.sourceChannel && (
            <div className="mt-1 text-[11px] text-slate-500 font-medium">
              {SOURCE_MAP[String(selected.sourceChannel).toUpperCase()]?.label ??
                selected.sourceChannel}
            </div>
          )}
        </div>
        <div className="rounded-xl bg-slate-50 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Staff
          </div>
          <div className="mt-1.5 text-sm font-semibold text-slate-900">
            {(selected as any).employeeName || '—'}
          </div>
          {(selected as any).employeeId && (
            <div className="mt-1 text-[11px] text-slate-400 font-mono truncate">
              {(selected as any).employeeId}
            </div>
          )}
        </div>
        <div className="rounded-xl bg-slate-50 p-4 col-span-2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
            Customer
          </div>
          <div className="font-semibold text-slate-900">
            {selected.customerName || 'Walk-in'}
          </div>
          {(selected.customerPhone || (selected as any).customerEmail) && (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              {selected.customerPhone && (
                <span className="inline-flex items-center gap-1 text-sm text-slate-600 font-mono">
                  <svg
                    className="h-3.5 w-3.5 text-slate-400"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.37 1.9.72 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0122 16.92z" />
                  </svg>
                  {selected.customerPhone}
                </span>
              )}
              {(selected as any).customerEmail && (
                <span className="inline-flex items-center gap-1 text-sm text-slate-600 font-mono">
                  <svg
                    className="h-3.5 w-3.5 text-slate-400"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="5" width="18" height="14" rx="2" />
                    <path d="M3 7l9 6 9-6" />
                  </svg>
                  {(selected as any).customerEmail}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Items */}
      <div>
        <div className="text-sm font-semibold text-slate-900 mb-3 flex items-center justify-between">
          <span>Items</span>
          <span className="text-xs text-slate-500 font-normal">
            {(selected.items as any)?.length || 0} items
          </span>
        </div>
        <div className="space-y-2">
          {(selected.items as any)?.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">
              No items on this order
            </div>
          )}
          {(selected.items as any)?.map((it: any, idx: number) => (
            <div
              key={it.id || idx}
              className="rounded-xl border border-slate-100 p-3.5 hover:border-slate-200 transition"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-400 tabular-nums min-w-[20px]">
                      {it.quantity}x
                    </span>
                    <span className="font-semibold text-slate-900">{it.name}</span>
                  </div>
                  {it.selectedModifiers?.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {it.selectedModifiers.map((m: any, mi: number) => (
                        <span
                          key={mi}
                          className="inline-flex items-center gap-1 text-[11px] text-slate-600 px-2 py-0.5 rounded-md bg-brand-50 text-brand-700"
                        >
                          + {m.optionNames?.join(', ')}
                        </span>
                      ))}
                    </div>
                  )}
                  {it.notes && (
                    <div className="mt-1.5 text-[11px] text-slate-500 italic">
                      {it.notes}
                    </div>
                  )}
                </div>
                <div className="text-sm font-semibold text-slate-900 tabular-nums shrink-0">
                  {formatNGN(it.totalAmount)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Totals */}
      <div className="rounded-2xl border border-brand-100 bg-gradient-to-br from-brand-50/60 to-white p-5 space-y-2.5">
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>Subtotal</span>
          <span className="tabular-nums">{formatNGN(subtotal)}</span>
        </div>
        {NGN(selected.taxAmount) > 0 && (
          <div className="flex items-center justify-between text-sm text-slate-600">
            <span>Tax</span>
            <span className="tabular-nums">{formatNGN(selected.taxAmount)}</span>
          </div>
        )}
        {NGN(selected.tipAmount) > 0 && (
          <div className="flex items-center justify-between text-sm text-slate-600">
            <span>Tip</span>
            <span className="tabular-nums">
              {formatNGN(selected.tipAmount ?? 0)}
            </span>
          </div>
        )}
        {NGN(selected.discountAmount) > 0 && (
          <div className="flex items-center justify-between text-sm text-emerald-600">
            <span>Discount</span>
            <span className="tabular-nums">
              -{formatNGN(selected.discountAmount)}
            </span>
          </div>
        )}
        <div className="h-px bg-brand-100/70 my-1" />
        <div className="flex items-center justify-between text-base font-bold text-slate-900">
          <span>Total</span>
          <span className="tabular-nums">{formatNGN(selected.totalAmount)}</span>
        </div>
        <div className="h-px bg-brand-100/70 my-1" />
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-600">Paid</span>
          <span
            className={
              totalPaid > 0
                ? 'text-emerald-600 font-semibold tabular-nums'
                : 'text-slate-400 tabular-nums'
            }
          >
            {formatNGN(totalPaid)}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-600">Balance Due</span>
          <span
            className={
              balance > 0
                ? 'text-rose-600 font-semibold tabular-nums'
                : 'text-emerald-600 font-semibold tabular-nums'
            }
          >
            {formatNGN(balance)}
          </span>
        </div>
      </div>

      {/* Payment history */}
      <div>
        <div className="text-sm font-semibold text-slate-900 mb-3 flex items-center justify-between">
          <span>Payment History</span>
          {paymentsLoading && (
            <span className="text-[11px] text-slate-400">Loading…</span>
          )}
        </div>
        {!paymentsLoading && payments.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">
            No payments recorded yet.
          </div>
        ) : (
          <div className="space-y-2">
            {payments.map((p: any) => {
              const tone =
                String(p.status || '').toUpperCase() === 'FAILED'
                  ? PAYMENT_STATUS_MAP.FAILED
                  : String(p.status || '').toUpperCase() === 'REFUNDED'
                  ? PAYMENT_STATUS_MAP.REFUNDED
                  : PAYMENT_STATUS_MAP.PAID;
              return (
                <div
                  key={sid(p.id ?? p._id)}
                  className="rounded-xl border border-slate-100 p-3.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900">
                          {String(p.method || 'OTHER').replace(/_/g, ' ')}
                        </span>
                        <Badge variant={tone.variant} className="text-[10px]">
                          {tone.label}
                        </Badge>
                      </div>
                      <div className="mt-1 text-[11px] text-slate-400 font-mono">
                        {p.transactionReference
                          ? `Ref: ${p.transactionReference}`
                          : p.provider
                          ? `Provider: ${p.provider}`
                          : 'No reference'}
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-400">
                        {formatDateTime(p.createdAt)}
                      </div>
                      {p.notes && (
                        <div className="mt-1 text-[11px] text-slate-500 italic">
                          {p.notes}
                        </div>
                      )}
                    </div>
                    <div className="text-sm font-bold text-slate-900 tabular-nums shrink-0">
                      {formatNGN(p.amountCents ?? p.amount ?? 0)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {(selected.customerName || selected.notes) && (
        <div className="space-y-3">
          {selected.notes && (
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                Order Notes
              </div>
              <div className="text-sm text-slate-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                {selected.notes}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MarkPaidBody({
  selected,
  form,
  setForm,
}: {
  selected: Order;
  form: PaymentFormState;
  setForm: (f: PaymentFormState) => void;
}) {
  const totalPaid = NGN((selected as any).paidAmount);
  const balance =
    NGN((selected as any).balanceDue) ||
    Math.max(0, NGN(selected.totalAmount) - totalPaid);
  const entered = NGN(form.amountNgn);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 space-y-2">
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>Total</span>
          <span className="tabular-nums font-semibold text-slate-900">
            {formatNGN(selected.totalAmount)}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>Paid already</span>
          <span className="tabular-nums text-emerald-600 font-semibold">
            {formatNGN(totalPaid)}
          </span>
        </div>
        <div className="h-px bg-slate-200 my-0.5" />
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span className="font-semibold text-rose-600">Balance Due</span>
          <span className="tabular-nums font-bold text-rose-600">
            {formatNGN(balance)}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Payment Method
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {PAYMENT_METHOD_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => setForm({ ...form, method: o.value })}
                className={cn(
                  'text-left rounded-xl border-2 p-3 transition-all hover:shadow-sm',
                  form.method === o.value
                    ? 'border-brand-500 bg-brand-50'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                )}
              >
                <div className="text-sm font-semibold text-slate-900">
                  {o.label}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">{o.hint}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <Input
            label="Amount (₦)"
            type="number"
            min="0"
            step="1"
            value={form.amountNgn}
            onChange={(e) => setForm({ ...form, amountNgn: e.target.value })}
            placeholder={String(Math.round(balance))}
            prefix={
              <span className="text-slate-400 text-sm font-medium">₦</span>
            }
          />
          {entered > 0 && Math.abs(entered - balance) > 0.5 && (
            <div className="mt-1 text-[11px] text-slate-500">
              {entered < balance
                ? `Partial payment. New balance: ${formatNGN(balance - entered)}`
                : `Overpayment of ${formatNGN(entered - balance)}`}
            </div>
          )}
        </div>

        <div>
          <Input
            label="Tip / Gratuity (₦)"
            type="number"
            min="0"
            step="1"
            value={form.tipNgn}
            onChange={(e) => setForm({ ...form, tipNgn: e.target.value })}
            placeholder="0"
            prefix={
              <span className="text-slate-400 text-sm font-medium">₦</span>
            }
          />
        </div>

        <div className="sm:col-span-2">
          <Input
            label="Transaction Reference"
            value={form.transactionReference}
            onChange={(e) =>
              setForm({ ...form, transactionReference: e.target.value })
            }
            placeholder="POS RRN / Transfer alert ID / Paystack ref…"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Notes
          </label>
          <textarea
            className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none"
            rows={3}
            placeholder="Anything helpful for audit: customer name, staff member, etc."
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}
