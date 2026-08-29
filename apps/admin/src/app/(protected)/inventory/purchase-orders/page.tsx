'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { DataTable, Column } from '@/components/ui/Table';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/Modal';
import { apiGet, apiPost } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { formatDateTime, formatNGN, formatNumber } from '@/lib/format';
import { toast } from '@/components/ui/Toast';
import type { PurchaseOrder, PurchaseOrderStatus, Supplier, Unit } from '@prolific/shared-types';

interface InventoryItemRow {
  id: string;
  name: string;
  unit: Unit;
  unitCostCents: number;
}

interface CreateLine {
  inventoryItemId: string;
  quantityOrdered: number;
  unitCostCents: number;
}

interface CreateForm {
  supplierId: string;
  expectedDeliveryDate: string;
  notes: string;
  items: CreateLine[];
}

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All Statuses' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'SENT', label: 'Sent' },
  { value: 'PARTIALLY_RECEIVED', label: 'Partially Received' },
  { value: 'RECEIVED', label: 'Received' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

const STATUS_BADGE: Record<string, { variant: any; label: string }> = {
  DRAFT: { variant: 'soft', label: 'Draft' },
  SENT: { variant: 'info', label: 'Sent' },
  PARTIALLY_RECEIVED: { variant: 'warning', label: 'Partial' },
  RECEIVED: { variant: 'success', label: 'Received' },
  CANCELLED: { variant: 'danger', label: 'Cancelled' },
};

const EMPTY: CreateForm = {
  supplierId: '',
  expectedDeliveryDate: '',
  notes: '',
  items: [{ inventoryItemId: '', quantityOrdered: 1, unitCostCents: 0 }],
};

export default function PurchaseOrdersPage() {
  const { branch } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItemRow[]>([]);

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [supplierId, setSupplierId] = useState('');

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY);

  const [receiveTarget, setReceiveTarget] = useState<PurchaseOrder | null>(null);
  const [receiveLoading, setReceiveLoading] = useState(false);

  const [cancelTarget, setCancelTarget] = useState<PurchaseOrder | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  const supplierById = useMemo(() => {
    const map = new Map<string, Supplier>();
    suppliers.forEach((s) => map.set(s.id, s));
    return map;
  }, [suppliers]);

  const itemById = useMemo(() => {
    const map = new Map<string, InventoryItemRow>();
    inventoryItems.forEach((i) => map.set(i.id, i));
    return map;
  }, [inventoryItems]);

  const subtotalCents = useMemo(() => {
    return form.items.reduce((acc, it) => acc + (Number(it.quantityOrdered) || 0) * (Number(it.unitCostCents) || 0), 0);
  }, [form.items]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (status) params.set('status', status);
      if (supplierId) params.set('supplierId', supplierId);
      params.set('limit', '50');

      const [poRes, suppliersRes, invRes]: any = await Promise.all([
        apiGet(`/purchase-orders?${params.toString()}`),
        apiGet('/suppliers?isActive=true'),
        apiGet('/inventory/items?limit=200'),
      ]);

      const poPayload = Array.isArray(poRes) ? poRes : (poRes?.data ?? poRes);
      setRows((poPayload?.data ?? poPayload) as PurchaseOrder[]);

      const sPayload = Array.isArray(suppliersRes) ? suppliersRes : (suppliersRes?.data ?? suppliersRes);
      setSuppliers((sPayload?.data ?? sPayload) as Supplier[]);

      const list = (Array.isArray(invRes) ? invRes : (invRes?.data ?? [])) as any[];
      setInventoryItems(
        list.map((it) => ({
          id: it.id || it._id,
          name: it.name,
          unit: it.unit,
          unitCostCents: it.unitCostCents ?? 0,
        }))
      );
    } catch (err: any) {
      toast('Failed to load purchase orders', { description: err.message, variant: 'error' });
      setRows([]);
      setSuppliers([]);
      setInventoryItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, [branch?.id, status, supplierId]);

  useEffect(() => {
    const t = setTimeout(fetchAll, 250);
    return () => clearTimeout(t);
  }, [q]);

  const openCreate = () => {
    setForm(EMPTY);
    setDrawerOpen(true);
  };

  const addLine = () => {
    setForm((f) => ({ ...f, items: [...f.items, { inventoryItemId: '', quantityOrdered: 1, unitCostCents: 0 }] }));
  };

  const removeLine = (idx: number) => {
    setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
  };

  const updateLine = (idx: number, patch: Partial<CreateLine>) => {
    setForm((f) => ({
      ...f,
      items: f.items.map((l, i) => (i === idx ? { ...l, ...patch } : l)),
    }));
  };

  const save = async () => {
    if (!form.supplierId) {
      toast('Supplier required', { variant: 'warning' });
      return;
    }
    const cleaned = form.items
      .filter((i) => i.inventoryItemId && i.quantityOrdered > 0)
      .map((i) => ({
        inventoryItemId: i.inventoryItemId,
        quantityOrdered: Number(i.quantityOrdered),
        unitCostCents: Number(i.unitCostCents),
      }));
    if (cleaned.length === 0) {
      toast('Add at least one line item', { variant: 'warning' });
      return;
    }

    setSaving(true);
    try {
      await apiPost('/purchase-orders', {
        supplierId: form.supplierId,
        expectedDeliveryDate: form.expectedDeliveryDate ? new Date(form.expectedDeliveryDate) : undefined,
        notes: form.notes || undefined,
        items: cleaned,
      });
      toast('Purchase order created', { variant: 'success' });
      setDrawerOpen(false);
      fetchAll();
    } catch (err: any) {
      toast('Create failed', { description: err.message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const receive = async () => {
    if (!receiveTarget) return;
    setReceiveLoading(true);
    try {
      await apiPost(`/purchase-orders/${receiveTarget.id}/receive`, {});
      toast('Stock received', { variant: 'success' });
      setReceiveTarget(null);
      fetchAll();
    } catch (err: any) {
      toast('Receive failed', { description: err.message, variant: 'error' });
    } finally {
      setReceiveLoading(false);
    }
  };

  const cancelPo = async () => {
    if (!cancelTarget) return;
    setCancelLoading(true);
    try {
      await apiPost(`/purchase-orders/${cancelTarget.id}/cancel`, {});
      toast('PO cancelled', { variant: 'success' });
      setCancelTarget(null);
      fetchAll();
    } catch (err: any) {
      toast('Cancel failed', { description: err.message, variant: 'error' });
    } finally {
      setCancelLoading(false);
    }
  };

  const columns: Column<PurchaseOrder>[] = [
    {
      key: 'orderNumber',
      title: 'PO',
      render: (r) => (
        <div>
          <div className="font-mono font-semibold text-slate-900">{r.orderNumber}</div>
          <div className="text-[11px] text-slate-500">{formatDateTime(r.createdAt)}</div>
        </div>
      ),
    },
    {
      key: 'supplierId',
      title: 'Supplier',
      render: (r) => <span className="text-slate-800">{supplierById.get(r.supplierId)?.name || '—'}</span>,
    },
    {
      key: 'items',
      title: 'Items',
      className: 'tabular-nums text-slate-700',
      render: (r) => `${formatNumber(r.items?.length ?? 0)} lines`,
    },
    {
      key: 'total',
      title: 'Total',
      className: 'text-right font-semibold text-slate-900 tabular-nums',
      render: (r) => formatNGN(r.totalAmount),
    },
    {
      key: 'status',
      title: 'Status',
      render: (r) => {
        const sm = STATUS_BADGE[r.status] || STATUS_BADGE.DRAFT;
        return <Badge variant={sm.variant} dot>{sm.label}</Badge>;
      },
    },
    {
      key: 'actions',
      title: '',
      className: 'text-right w-[210px]',
      render: (r) => (
        <div className="flex items-center justify-end gap-1.5">
          {r.status !== 'RECEIVED' && r.status !== 'CANCELLED' && (
            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setReceiveTarget(r);
              }}
            >
              Receive
            </Button>
          )}
          {r.status !== 'CANCELLED' && r.status !== 'RECEIVED' && (
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setCancelTarget(r);
              }}
            >
              Cancel
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">Purchase Orders</h1>
          <p className="text-sm text-slate-500 mt-1">{formatNumber(rows.length)} POs · {branch?.name || 'All Branches'}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={fetchAll}>Refresh</Button>
          <Button onClick={openCreate}>Create PO</Button>
        </div>
      </div>

      <Card>
        <div className="px-5 py-4 border-b border-slate-100 grid grid-cols-1 sm:grid-cols-4 gap-3">
          <Input placeholder="Search PO number..." value={q} onChange={(e) => setQ(e.target.value)} />
          <Select options={STATUS_OPTIONS} value={status} onChange={(e) => setStatus(e.target.value)} />
          <Select
            options={[
              { value: '', label: 'All Suppliers' },
              ...suppliers.map((s) => ({ value: s.id, label: s.name })),
            ]}
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
          />
          <div className="text-sm text-slate-500 flex items-center">
            Receive posts stock into Inventory
          </div>
        </div>

        <DataTable
          columns={columns}
          data={rows}
          rowKey={(r) => r.id}
          loading={loading}
          emptyText="No purchase orders found"
        />
      </Card>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        size="lg"
        title="Create Purchase Order"
        description="Restock bar and kitchen inventory"
        footer={
          <div className="flex items-center justify-between w-full">
            <div className="text-sm text-slate-600 font-medium">
              Subtotal <span className="font-semibold text-slate-900">{formatNGN(subtotalCents)}</span>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={() => setDrawerOpen(false)}>Cancel</Button>
              <Button loading={saving} onClick={save}>Create</Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="Supplier"
              options={[
                { value: '', label: 'Select supplier' },
                ...suppliers.map((s) => ({ value: s.id, label: s.name })),
              ]}
              value={form.supplierId}
              onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
            />
            <Input
              label="Expected Delivery Date"
              type="date"
              value={form.expectedDeliveryDate}
              onChange={(e) => setForm({ ...form, expectedDeliveryDate: e.target.value })}
            />
          </div>
          <Input
            label="Notes"
            placeholder="Optional"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />

          <div className="rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-slate-500">
              Line Items
            </div>
            <div className="p-4 space-y-3">
              {form.items.map((line, idx) => {
                const item = line.inventoryItemId ? itemById.get(line.inventoryItemId) : undefined;
                return (
                  <div key={idx} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                    <div className="sm:col-span-6">
                      <Select
                        label={idx === 0 ? 'Inventory Item' : ''}
                        options={[
                          { value: '', label: 'Select item' },
                          ...inventoryItems.map((it) => ({ value: it.id, label: `${it.name} (${it.unit})` })),
                        ]}
                        value={line.inventoryItemId}
                        onChange={(e) => {
                          const chosen = e.target.value;
                          const picked = chosen ? itemById.get(chosen) : undefined;
                          updateLine(idx, {
                            inventoryItemId: chosen,
                            unitCostCents: picked ? picked.unitCostCents : line.unitCostCents,
                          });
                        }}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Input
                        label={idx === 0 ? 'Qty' : ''}
                        type="number"
                        min="1"
                        value={String(line.quantityOrdered)}
                        onChange={(e) => updateLine(idx, { quantityOrdered: Number(e.target.value) })}
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <Input
                        label={idx === 0 ? 'Unit Cost (cents)' : ''}
                        type="number"
                        min="0"
                        value={String(line.unitCostCents)}
                        onChange={(e) => updateLine(idx, { unitCostCents: Number(e.target.value) })}
                      />
                      {item && (
                        <div className="text-[11px] text-slate-500 mt-1">
                          Default cost {formatNGN(item.unitCostCents)}
                        </div>
                      )}
                    </div>
                    <div className="sm:col-span-1 flex items-center justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeLine(idx)}
                        disabled={form.items.length === 1}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                );
              })}

              <div className="flex items-center justify-between pt-2">
                <Button variant="outline" onClick={addLine}>Add Line</Button>
                <div className="text-sm text-slate-600">
                  Total <span className="font-semibold text-slate-900">{formatNGN(subtotalCents)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Drawer>

      <ConfirmDialog
        open={!!receiveTarget}
        onClose={() => setReceiveTarget(null)}
        onConfirm={receive}
        title="Receive stock into inventory?"
        description={receiveTarget ? `${receiveTarget.orderNumber} · ${formatNumber(receiveTarget.items?.length ?? 0)} lines` : ''}
        confirmText="Receive"
        loading={receiveLoading}
        variant="primary"
      />

      <ConfirmDialog
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={cancelPo}
        title="Cancel purchase order?"
        description={cancelTarget ? cancelTarget.orderNumber : ''}
        confirmText="Cancel PO"
        loading={cancelLoading}
        variant="danger"
      />
    </div>
  );
}
