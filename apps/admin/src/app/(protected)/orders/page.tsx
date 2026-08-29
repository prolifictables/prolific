'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { DataTable, Column } from '@/components/ui/Table';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/Modal';
import { apiGet, apiPost } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { formatNGN, formatDateTime, formatRelativeTime, formatNumber } from '@/lib/format';
import { cn } from '@/lib/cn';
import { toast } from '@/components/ui/Toast';
import type { Order, PaymentStatus } from '@prolific/shared-types';

const STATUS_TABS: { value: string; label: string; variant: any }[] = [
  { value: 'ALL', label: 'All', variant: 'soft' },
  { value: 'NEW', label: 'New', variant: 'warning' },
  { value: 'ACCEPTED', label: 'Accepted', variant: 'info' },
  { value: 'PREPARING', label: 'Preparing', variant: 'brand' },
  { value: 'READY', label: 'Ready', variant: 'accent' },
  { value: 'AWAITING_PAYMENT', label: 'Awaiting Payment', variant: 'warning' },
  { value: 'COMPLETED', label: 'Completed', variant: 'success' },
  { value: 'REFUNDED', label: 'Refunded', variant: 'danger' },
  { value: 'VOIDED', label: 'Voided', variant: 'danger' },
];

const ORDER_STATUS_MAP: Record<string, { variant: any; label: string }> = {
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

const PAYMENT_STATUS_MAP: Record<PaymentStatus, { variant: any; label: string }> = {
  UNPAID: { variant: 'danger', label: 'Unpaid' },
  PENDING: { variant: 'warning', label: 'Pending' },
  PARTIALLY_PAID: { variant: 'warning', label: 'Partial' },
  PAID: { variant: 'success', label: 'Paid' },
  FAILED: { variant: 'danger', label: 'Failed' },
  REFUNDED: { variant: 'danger', label: 'Refunded' },
  PARTIALLY_REFUNDED: { variant: 'warning', label: 'Part Refunded' },
};

const SOURCE_OPTIONS = [
  { value: '', label: 'All Channels' },
  { value: 'POS', label: 'POS' },
  { value: 'QR', label: 'QR Order' },
  { value: 'WEBSITE', label: 'Website' },
  { value: 'APP', label: 'Mobile App' },
  { value: 'PHONE', label: 'Phone Order' },
];

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
  const [page, setPage] = useState(1);

  const [selected, setSelected] = useState<Order | null>(null);
  const [showCancel, setShowCancel] = useState(false);
  const [showVoid, setShowVoid] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [voidReason, setVoidReason] = useState('');

  const role = getRole();
  const canVoidRefund = hasValidApprovalToken() || role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'MANAGER';

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (source) params.set('source', source);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (branch?.id) params.set('branchId', branch.id);
      params.set('limit', '50');
      params.set('sort', '-createdAt');

      const res: any = await apiGet(`/orders?${params.toString()}`);
      const rows = Array.isArray(res) ? res : (res?.data ?? []);
      setOrders(rows);
    } catch (err: any) {
      toast('Failed to load orders', { description: err.message, variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [branch?.id, statusFilter, source, dateFrom, dateTo, debouncedSearch, page]);

  const filteredOrders = useMemo(() => {
    if (!search) return orders;
    const q = search.toLowerCase();
    return orders.filter(
      (o) =>
        o.orderNumber.toLowerCase().includes(q) ||
        (o.customerName || '').toLowerCase().includes(q) ||
        (o.customerPhone || '').includes(q)
    );
  }, [orders, search]);

  const columns: Column<Order>[] = [
    {
      key: 'orderNumber',
      title: 'Order',
      className: 'font-mono font-semibold text-slate-900',
      render: (r) => (
        <div>
          <div className="font-mono font-semibold text-slate-900">{r.orderNumber}</div>
          <div className="text-[11px] text-slate-400">{formatDateTime(r.createdAt)}</div>
        </div>
      ),
    },
    {
      key: 'table',
      title: 'Table',
      render: (r) => (
        <Badge variant="soft" className={!r.tableName ? 'opacity-50' : ''}>
          {r.tableName || 'Takeaway'}
        </Badge>
      ),
    },
    {
      key: 'source',
      title: 'Source',
      render: (r) => {
        const map: any = {
          QR: { variant: 'brand', label: 'QR' },
          POS: { variant: 'success', label: 'POS' },
          WEBSITE: { variant: 'info', label: 'Web' },
          APP: { variant: 'accent', label: 'App' },
          PHONE: { variant: 'warning', label: 'Phone' },
        };
        const s = map[r.sourceChannel as any] || { variant: 'soft', label: r.sourceChannel };
        return <Badge variant={s.variant}>{s.label}</Badge>;
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
      render: (r) => (
        <div className="min-w-0">
          <div className="font-medium text-slate-800 truncate max-w-[160px]">{r.customerName || 'Walk-in'}</div>
          {r.customerPhone && <div className="text-[11px] text-slate-400">{r.customerPhone}</div>}
        </div>
      ),
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
        return <Badge variant={sc.variant} dot>{sc.label}</Badge>;
      },
    },
    {
      key: 'payment',
      title: 'Payment',
      render: (r) => {
        const ps = PAYMENT_STATUS_MAP[r.paymentStatus] || PAYMENT_STATUS_MAP.UNPAID;
        return <Badge variant={ps.variant}>{ps.label}</Badge>;
      },
    },
    {
      key: 'paidAmount',
      title: 'Paid',
      className: 'text-right tabular-nums',
      render: (r) => {
        const paid = Number((r as any).paidAmount ?? 0) || 0;
        if (paid <= 0) return <span className="text-slate-400">{formatNGN(0)}</span>;
        return <span className="text-emerald-600 font-semibold">{formatNGN(paid)}</span>;
      },
    },
    {
      key: 'balanceDue',
      title: 'Balance',
      className: 'text-right tabular-nums',
      render: (r) => {
        const balance = Number((r as any).balanceDue ?? 0) || 0;
        if (balance <= 0) return <span className="text-emerald-600">{formatNGN(0)}</span>;
        return <span className="text-rose-600 font-semibold">{formatNGN(balance)}</span>;
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
      className: 'text-right w-[160px]',
      render: (r) => (
        <div className="flex items-center justify-end gap-1.5">
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setSelected(r); }}>
            View
          </Button>
          {r.status !== 'VOIDED' && r.status !== 'REFUNDED' && r.status !== 'COMPLETED' && (
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
      ),
    },
  ];

  const handleCancel = async () => {
    if (!selected) return;
    setActionLoading(true);
    try {
      await apiPost(`/orders/${selected.id}/cancel`, { reason: voidReason || 'Customer cancelled' });
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
      await apiPost(`/orders/${selected.id}/void`, {
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

  const drawerFooter = selected ? (
    <div className="flex items-center justify-between w-full">
      <div className="text-sm">
        {!canVoidRefund && (selected.status === 'COMPLETED' || selected.paymentStatus === 'PAID') && (
          <Badge variant="warning" dot>
            Manager PIN required to void
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-2">
        {selected.status !== 'VOIDED' && selected.status !== 'REFUNDED' && (
          <>
            {(selected.status === 'COMPLETED' || selected.paymentStatus === 'PAID') && (
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
            {selected.status !== 'COMPLETED' && selected.status !== 'CANCELLED' && (
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

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">Orders</h1>
          <p className="text-sm text-slate-500 mt-1">
            {formatNumber(filteredOrders.length)} orders found · {branch?.name || 'All Branches'}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchOrders}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
          </svg>
          Refresh
        </Button>
      </div>

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
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <Input
            placeholder="Search order # / customer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="lg:col-span-2"
            prefix={
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
          rowKey={(r) => r.id}
          loading={loading}
          emptyText="No orders match your filters"
          onRowClick={(r) => setSelected(r)}
        />
      </Card>

      <Drawer
        open={!!selected}
        onClose={() => setSelected(null)}
        side="right"
        size="md"
        title={selected?.orderNumber || ''}
        description={selected ? `${formatRelativeTime(selected.createdAt)} · ${selected.sourceChannel}` : ''}
        footer={drawerFooter}
      >
        {selected && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-slate-50 p-4">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Status</div>
                <div className="mt-2">
                  {(() => { const s = ORDER_STATUS_MAP[selected.status] || ORDER_STATUS_MAP.PENDING; return <Badge variant={s.variant} dot className="text-sm">{s.label}</Badge>; })()}
                </div>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Payment</div>
                <div className="mt-2">
                  {(() => { const p = PAYMENT_STATUS_MAP[selected.paymentStatus] || PAYMENT_STATUS_MAP.UNPAID; return <Badge variant={p.variant} className="text-sm">{p.label}</Badge>; })()}
                </div>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Table</div>
                <div className="mt-1.5 text-sm font-semibold text-slate-900">{selected.tableName || 'Takeaway'}</div>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Source</div>
                <div className="mt-1.5 text-sm font-semibold text-slate-900">{selected.sourceChannel}</div>
              </div>
              <div className="rounded-xl bg-slate-50 p-4 col-span-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Staff</div>
                <div className="mt-1.5 text-sm font-semibold text-slate-900">
                  {(selected as any).employeeName || '—'}
                </div>
                {(selected as any).employeeId && (
                  <div className="mt-1 text-[11px] text-slate-400 font-mono truncate">
                    {(selected as any).employeeId}
                  </div>
                )}
              </div>
            </div>

            <div>
              <div className="text-sm font-semibold text-slate-900 mb-3 flex items-center justify-between">
                <span>Items</span>
                <span className="text-xs text-slate-500 font-normal">{(selected.items as any)?.length || 0} items</span>
              </div>
              <div className="space-y-2">
                {(selected.items as any)?.map((it: any, idx: number) => (
                  <div key={it.id || idx} className="rounded-xl border border-slate-100 p-3.5 hover:border-slate-200 transition">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-400 tabular-nums min-w-[20px]">{it.quantity}x</span>
                          <span className="font-semibold text-slate-900">{it.name}</span>
                        </div>
                        {it.selectedModifiers?.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {it.selectedModifiers.map((m: any, mi: number) => (
                              <span key={mi} className="inline-flex items-center gap-1 text-[11px] text-slate-600 px-2 py-0.5 rounded-md bg-brand-50 text-brand-700">
                                + {m.optionNames?.join(', ')}
                              </span>
                            ))}
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

            <div className="rounded-2xl border border-brand-100 bg-gradient-to-br from-brand-50/60 to-white p-5 space-y-2.5">
              <div className="flex items-center justify-between text-sm text-slate-600">
                <span>Subtotal</span>
                <span className="tabular-nums">{formatNGN(selected.subtotal || selected.totalAmount - (selected.taxAmount || 0) - (selected.tipAmount || 0) + (selected.discountAmount || 0))}</span>
              </div>
              {selected.taxAmount > 0 && (
                <div className="flex items-center justify-between text-sm text-slate-600">
                  <span>Tax</span>
                  <span className="tabular-nums">{formatNGN(selected.taxAmount)}</span>
                </div>
              )}
              {(selected.tipAmount ?? 0) > 0 && (
                <div className="flex items-center justify-between text-sm text-slate-600">
                  <span>Tip</span>
                  <span className="tabular-nums">{formatNGN(selected.tipAmount ?? 0)}</span>
                </div>
              )}
              {selected.discountAmount > 0 && (
                <div className="flex items-center justify-between text-sm text-emerald-600">
                  <span>Discount</span>
                  <span className="tabular-nums">-{formatNGN(selected.discountAmount)}</span>
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
                {(() => {
                  const paid = Number((selected as any).paidAmount ?? 0) || 0;
                  return (
                    <span className={paid > 0 ? 'text-emerald-600 font-semibold tabular-nums' : 'text-slate-400 tabular-nums'}>
                      {formatNGN(paid)}
                    </span>
                  );
                })()}
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600">Balance Due</span>
                {(() => {
                  const balance = Number((selected as any).balanceDue ?? 0) || 0;
                  return (
                    <span className={balance > 0 ? 'text-rose-600 font-semibold tabular-nums' : 'text-emerald-600 font-semibold tabular-nums'}>
                      {formatNGN(balance)}
                    </span>
                  );
                })()}
              </div>
            </div>

            {(selected.customerName || selected.notes) && (
              <div className="space-y-3">
                {selected.customerName && (
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Customer</div>
                    <div className="font-semibold text-slate-900">{selected.customerName}</div>
                    {selected.customerPhone && <div className="text-sm text-slate-500">{selected.customerPhone}</div>}
                  </div>
                )}
                {selected.notes && (
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Notes</div>
                    <div className="text-sm text-slate-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">{selected.notes}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={showCancel}
        onClose={() => { setShowCancel(false); setVoidReason(''); }}
        onConfirm={handleCancel}
        title="Cancel Order"
        description="Cancelling will close this order. This action cannot be undone."
        confirmText="Cancel Order"
        variant="warning"
        loading={actionLoading}
      >
        <div className="mb-2">
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Reason (optional)</label>
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
        onClose={() => { setShowVoid(false); setVoidReason(''); }}
        onConfirm={handleVoid}
        title="Void Order"
        description={canVoidRefund ? 'Voiding will reverse this transaction. This action cannot be undone and is logged for audit.' : 'Manager PIN is required. Please unlock approval first.'}
        confirmText={canVoidRefund ? 'Void Order' : 'Unlock & Void'}
        variant="danger"
        loading={actionLoading}
      >
        {canVoidRefund && (
          <div className="mb-2">
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Void Reason</label>
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
