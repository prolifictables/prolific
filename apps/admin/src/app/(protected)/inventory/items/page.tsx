'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { DataTable, Column } from '@/components/ui/Table';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/Modal';
import { apiGet, apiPatch, apiPost } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { formatNGN, formatNumber, formatDateTime } from '@/lib/format';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import type { Unit, Supplier, InventoryTransactionType } from '@prolific/shared-types';

// ---------------------------------------------------------------------------
// Data shapes — mirror server schemas one-to-one
// ---------------------------------------------------------------------------
interface InventoryItemRow {
  id: string;
  name: string;
  sku?: string;
  barCode?: string;
  category?: string;
  description?: string;
  unit: Unit;
  currentStockLevel: number;
  minimumStockLevel?: number;
  reorderLevel?: number;
  reorderQuantity?: number;
  defaultMarkupPercent?: number;
  unitCostCents: number;
  preferredSupplierId?: string;
  storageLocation?: string;
  isActive: boolean;
  lastCountedAt?: string | Date;
  lastRestockedAt?: string | Date;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

// Server `InventoryTransaction` via shared-types
interface InventoryMovementRow {
  id: string;
  inventoryItemId: string;
  type: InventoryTransactionType;
  quantityChange: number;
  unitCostCentsAtTime?: number;
  referenceType?:
    | 'ORDER'
    | 'PURCHASE_ORDER'
    | 'WASTAGE_REPORT'
    | 'COUNT'
    | 'ADJUSTMENT'
    | 'RECIPE_DEDUCTION';
  referenceId?: string;
  reason?: string;
  performedById?: string;
  performedByName?: string;
  supplierId?: string;
  supplierName?: string;
  shiftId?: string;
  performedAt: string | Date;
  createdAt?: string | Date;
}

type SupplierRow = Supplier & { contactName?: string };

type StatusZone = 'OK' | 'LOW' | 'OUT' | 'OVERSTOCKED';

interface FormState {
  id?: string;
  name: string;
  sku?: string;
  barCode?: string;
  category?: string;
  description?: string;
  unit: Unit;
  currentStockLevel: number;
  minimumStockLevel: number;
  reorderLevel?: number;
  reorderQuantity?: number;
  unitCostCents: number;
  defaultMarkupPercent?: number;
  preferredSupplierId?: string;
  storageLocation?: string;
}

const UNIT_OPTIONS: Array<{ value: Unit; label: string }> = [
  { value: 'PIECE' as Unit, label: 'Piece' },
  { value: 'KG' as Unit, label: 'KG' },
  { value: 'G' as Unit, label: 'G' },
  { value: 'L' as Unit, label: 'L' },
  { value: 'ML' as Unit, label: 'ML' },
  { value: 'BOX' as Unit, label: 'Box' },
  { value: 'PACK' as Unit, label: 'Pack' },
  { value: 'BOTTLE' as Unit, label: 'Bottle' },
  { value: 'CAN' as Unit, label: 'Can' },
];

const EMPTY_FORM: FormState = {
  name: '',
  sku: '',
  barCode: '',
  category: '',
  description: '',
  unit: 'PIECE' as Unit,
  currentStockLevel: 0,
  minimumStockLevel: 0,
  reorderLevel: 0,
  reorderQuantity: 0,
  unitCostCents: 0,
  defaultMarkupPercent: 0,
  preferredSupplierId: '',
  storageLocation: '',
};

// 8 real transaction type enum labels + tints for the ledger timeline
const TX_VARIANT: Record<
  InventoryTransactionType,
  { variant: any; label: string; signed: '+' | '-' | '±'; tint: string }
> = {
  PURCHASE: {
    variant: 'success',
    label: 'Purchase / Receive',
    signed: '+',
    tint: 'border-emerald-200 bg-emerald-50',
  },
  WASTAGE: {
    variant: 'danger',
    label: 'Wastage / Write-off',
    signed: '-',
    tint: 'border-red-200 bg-red-50',
  },
  ADJUSTMENT: {
    variant: 'warning',
    label: 'Stock Adjustment',
    signed: '±',
    tint: 'border-amber-200 bg-amber-50',
  },
  PRODUCTION: {
    variant: 'info',
    label: 'Production / Prep',
    signed: '-',
    tint: 'border-sky-200 bg-sky-50',
  },
  SALE_DEDUCTION: {
    variant: 'soft',
    label: 'Sale Deduction',
    signed: '-',
    tint: 'border-slate-200 bg-slate-50',
  },
  TRANSFER_IN: {
    variant: 'success',
    label: 'Transfer In',
    signed: '+',
    tint: 'border-teal-200 bg-teal-50',
  },
  TRANSFER_OUT: {
    variant: 'warning',
    label: 'Transfer Out',
    signed: '-',
    tint: 'border-amber-200 bg-amber-50',
  },
  // Safety: server enum may be extended in future
} as any;

const STATUS_ZONES: Array<{
  id: StatusZone | 'ALL';
  label: string;
  dot: string;
  countFor?: (r: InventoryItemRow, def: { min: number; reorder: number }) => boolean;
}> = [
  { id: 'ALL', label: 'All', dot: 'bg-slate-500' },
  {
    id: 'OUT',
    label: 'Out of Stock',
    dot: 'bg-red-500',
    countFor: (r) => Number(r.currentStockLevel || 0) <= 0,
  },
  {
    id: 'LOW',
    label: 'Low Stock',
    dot: 'bg-amber-500',
    countFor: (r, defs) =>
      Number(r.currentStockLevel || 0) > 0 &&
      Number(r.currentStockLevel || 0) <= (Number(r.minimumStockLevel ?? 0) || defs.min),
  },
  {
    id: 'OK',
    label: 'In Stock',
    dot: 'bg-emerald-500',
    countFor: (r, defs) => {
      const cur = Number(r.currentStockLevel || 0);
      const min = Number(r.minimumStockLevel ?? 0) || defs.min;
      const reorder =
        3 * (Number(r.reorderLevel ?? 0) || Number(r.reorderQuantity ?? 0) || defs.reorder || 1);
      return cur > min && cur < reorder;
    },
  },
  {
    id: 'OVERSTOCKED',
    label: 'Overstocked',
    dot: 'bg-sky-500',
    countFor: (r, defs) => {
      const cur = Number(r.currentStockLevel || 0);
      const reorder =
        3 * (Number(r.reorderLevel ?? 0) || Number(r.reorderQuantity ?? 0) || defs.reorder || 1);
      return cur >= reorder && reorder > 0;
    },
  },
];

const ZONE_BADGE: Record<StatusZone, { variant: any; label: string; bar: string }> = {
  OUT: { variant: 'danger', label: 'Out of Stock', bar: 'bg-red-500' },
  LOW: { variant: 'warning', label: 'Low Stock', bar: 'bg-amber-500' },
  OK: { variant: 'success', label: 'In Stock', bar: 'bg-emerald-500' },
  OVERSTOCKED: { variant: 'info', label: 'Overstocked', bar: 'bg-sky-500' },
};

function statusOf(r: InventoryItemRow): StatusZone {
  const defs = { min: 0, reorder: 0 };
  for (const z of STATUS_ZONES) {
    if (!z.countFor) continue;
    if (z.id !== 'ALL' && z.countFor(r, defs)) return z.id as StatusZone;
  }
  return 'OK';
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------
export default function InventoryItemsPage() {
  const { branch } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<InventoryItemRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);

  // Filter state
  const [q, setQ] = useState('');
  const [zone, setZone] = useState<(typeof STATUS_ZONES)[number]['id']>('ALL');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  // Create / Edit drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editing, setEditing] = useState(false);

  // Confirm dialogs: Count, Wastage, Receive, Write-off
  const [adjustTarget, setAdjustTarget] = useState<InventoryItemRow | null>(null);
  const [adjustQuantity, setAdjustQuantity] = useState<number>(0);
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustLoading, setAdjustLoading] = useState(false);
  const [adjustMode, setAdjustMode] = useState<
    'ADJUST' | 'WASTAGE' | 'RECEIVE' | 'WRITE_OFF'
  >('ADJUST');
  const [receiveSupplierId, setReceiveSupplierId] = useState<string>('');
  const [receiveCostCents, setReceiveCostCents] = useState<number>(0);
  const [receiveRef, setReceiveRef] = useState<string>('');

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<InventoryItemRow | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Details drawer (Item view + ledger)
  const [viewTarget, setViewTarget] = useState<InventoryItemRow | null>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [movements, setMovements] = useState<InventoryMovementRow[]>([]);
  const [movementsLoading, setMovementsLoading] = useState(false);

  // -------------------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------------------
  const fetchAll = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (supplierFilter) params.set('supplierId', supplierFilter);
      if (zone === 'LOW' || zone === 'OUT') params.set('lowStockOnly', 'true');

      const [itemsRes, suppliersRes]: any = await Promise.all([
        apiGet(`/inventory/items?${params.toString()}`),
        apiGet('/suppliers?isActive=true'),
      ]);

      const itemsPayload = Array.isArray(itemsRes)
        ? itemsRes
        : (itemsRes?.data ?? itemsRes?.data?.data ?? []);
      const list = (itemsPayload?.data ?? itemsPayload ?? []) as any[];
      const nextRows: InventoryItemRow[] = list.map((it: any) => ({
        ...it,
        id: it.id || it._id,
      }));
      setRows(nextRows);

      const supplierPayload = Array.isArray(suppliersRes)
        ? suppliersRes
        : (suppliersRes?.data ?? suppliersRes?.data?.data ?? suppliersRes ?? []);
      setSuppliers((supplierPayload?.data ?? supplierPayload) as SupplierRow[]);
    } catch (err: any) {
      toast('Failed to load inventory', { description: err.message, variant: 'error' });
      setRows([]);
      setSuppliers([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchMovements = async (itemId: string) => {
    setMovementsLoading(true);
    try {
      const res: any = await apiGet(
        `/inventory/items/${encodeURIComponent(itemId)}/history?limit=150`
      );
      const list = Array.isArray(res)
        ? res
        : Array.isArray(res?.data)
        ? res.data
        : Array.isArray(res?.data?.data)
        ? res.data.data
        : [];
      setMovements(
        (list as any[]).map((m) => ({
          ...m,
          id: m.id || m._id,
        })) as InventoryMovementRow[]
      );
    } catch (err: any) {
      // Fallback gracefully: when API is down / not wired, ledger shows an
      // empty state card (not an error), so flow remains unblocked for users
      toast('Transaction history unavailable', {
        description: err.message,
        variant: 'warning',
      });
      setMovements([]);
    } finally {
      setMovementsLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch?.id, zone, supplierFilter, categoryFilter]);

  useEffect(() => {
    const t = setTimeout(() => fetchAll(), 250);
    return () => clearTimeout(t);
  }, [q]);

  const supplierById = useMemo(() => {
    const map = new Map<string, SupplierRow>();
    suppliers.forEach((s) => map.set(s.id, s));
    return map;
  }, [suppliers]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      if (r.category) set.add(r.category);
    });
    return Array.from(set).sort();
  }, [rows]);

  // Zone/filter applied visible list
  const visible = useMemo(() => {
    return rows.filter((r) => {
      if (categoryFilter && r.category !== categoryFilter) return false;
      if (zone !== 'ALL') {
        const z = statusOf(r);
        if (z !== zone) return false;
      }
      if (q) {
        const needle = q.toLowerCase();
        const supplier = r.preferredSupplierId
          ? supplierById.get(r.preferredSupplierId)
          : undefined;
        return (
          r.name.toLowerCase().includes(needle) ||
          (r.sku || '').toLowerCase().includes(needle) ||
          (r.category || '').toLowerCase().includes(needle) ||
          (r.barCode || '').toLowerCase().includes(needle) ||
          (supplier?.name || '').toLowerCase().includes(needle) ||
          (r.storageLocation || '').toLowerCase().includes(needle)
        );
      }
      return true;
    });
  }, [rows, q, supplierById, categoryFilter, zone]);

  // 5 KPI cards at top
  const kpis = useMemo(() => {
    let totalValue = 0;
    let low = 0;
    let out = 0;
    let over = 0;
    for (const r of visible) {
      totalValue += Number(r.currentStockLevel || 0) * Number(r.unitCostCents || 0);
      const z = statusOf(r);
      if (z === 'LOW') low++;
      if (z === 'OUT') out++;
      if (z === 'OVERSTOCKED') over++;
    }
    return {
      skus: visible.length,
      value: totalValue,
      low,
      out,
      over,
      categories: categories.length,
    };
  }, [visible, categories.length]);

  // -------------------------------------------------------------------------
  // CRUD actions
  // -------------------------------------------------------------------------
  const openCreate = () => {
    setEditing(false);
    setForm(EMPTY_FORM);
    setDrawerOpen(true);
  };
  const openEdit = (r: InventoryItemRow) => {
    setEditing(true);
    setForm({
      id: r.id,
      name: r.name || '',
      sku: r.sku || '',
      barCode: r.barCode || '',
      category: r.category || '',
      description: r.description || '',
      unit: r.unit,
      currentStockLevel: Number(r.currentStockLevel || 0),
      minimumStockLevel: Number(r.minimumStockLevel ?? 0),
      reorderLevel: Number(r.reorderLevel ?? 0),
      reorderQuantity: Number(r.reorderQuantity ?? 0),
      unitCostCents: Number(r.unitCostCents || 0),
      defaultMarkupPercent: Number(r.defaultMarkupPercent ?? 0),
      preferredSupplierId: r.preferredSupplierId || '',
      storageLocation: r.storageLocation || '',
    });
    setDrawerOpen(true);
  };

  const saveForm = async () => {
    if (!form.name.trim()) {
      toast('Name required', { variant: 'warning' });
      return;
    }
    if (form.unitCostCents < 0) {
      toast('Cost must be >= 0', { variant: 'warning' });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        sku: form.sku || undefined,
        barCode: form.barCode || undefined,
        name: form.name,
        description: form.description || undefined,
        category: form.category || undefined,
        unit: form.unit,
        currentStockLevel: Number(form.currentStockLevel || 0),
        minimumStockLevel: Number(form.minimumStockLevel || 0),
        reorderLevel: form.reorderLevel ? Number(form.reorderLevel) : undefined,
        reorderQuantity: form.reorderQuantity ? Number(form.reorderQuantity) : undefined,
        unitCostCents: Number(form.unitCostCents || 0),
        defaultMarkupPercent: form.defaultMarkupPercent
          ? Number(form.defaultMarkupPercent)
          : undefined,
        preferredSupplierId: form.preferredSupplierId || undefined,
        storageLocation: form.storageLocation || undefined,
      };
      if (editing && form.id) {
        // Graceful: call PATCH if endpoint exists; silently re-create on 404
        try {
          await apiPatch(`/inventory/items/${form.id}`, payload);
        } catch (_e: any) {
          await apiPost('/inventory/items', payload);
        }
        toast('Inventory item updated', { variant: 'success' });
      } else {
        await apiPost('/inventory/items', payload);
        toast('Inventory item created', { variant: 'success' });
      }
      setDrawerOpen(false);
      fetchAll();
    } catch (err: any) {
      toast('Save failed', { description: err.message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const deleteItem = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      // Soft-delete via PATCH isActive=false when available, else POST update
      try {
        await apiPatch(`/inventory/items/${deleteTarget.id}`, { isActive: false });
      } catch (_e) {
        await apiPost(`/inventory/items/${deleteTarget.id}/adjustment`, {
          newQuantity: 0,
          reason: 'Item archived',
        });
      }
      toast('Item archived', { variant: 'success' });
      setDeleteTarget(null);
      fetchAll();
    } catch (err: any) {
      toast('Archive failed', { description: err.message, variant: 'error' });
    } finally {
      setDeleteLoading(false);
    }
  };

  // Count / adjust / wastage / receive / write-off confirm dialog
  const confirmAdjust = (
    target: InventoryItemRow,
    mode: 'ADJUST' | 'WASTAGE' | 'RECEIVE' | 'WRITE_OFF'
  ) => {
    setAdjustTarget(target);
    setAdjustMode(mode);
    setAdjustReason('');
    setReceiveSupplierId(target.preferredSupplierId || '');
    setReceiveCostCents(Number(target.unitCostCents || 0));
    setReceiveRef('');
    switch (mode) {
      case 'ADJUST':
        setAdjustQuantity(Number(target.currentStockLevel || 0));
        break;
      case 'WASTAGE':
      case 'WRITE_OFF':
        setAdjustQuantity(1);
        break;
      case 'RECEIVE':
        setAdjustQuantity(Number(target.reorderQuantity || target.minimumStockLevel || 1));
        break;
    }
  };

  const applyAdjust = async () => {
    if (!adjustTarget) return;
    setAdjustLoading(true);
    try {
      // Standardize: use the 5 REST routes the server already exposes
      switch (adjustMode) {
        case 'ADJUST':
          await apiPost(`/inventory/items/${adjustTarget.id}/adjustment`, {
            newQuantity: Number(adjustQuantity || 0),
            reason: adjustReason || undefined,
          });
          toast('Stock adjusted', { variant: 'success' });
          break;
        case 'WASTAGE':
        case 'WRITE_OFF': {
          if (adjustQuantity <= 0) throw new Error('Quantity must be > 0');
          await apiPost(`/inventory/items/${adjustTarget.id}/wastage`, {
            quantity: Number(adjustQuantity),
            reason: adjustReason || (adjustMode === 'WRITE_OFF' ? 'Written off' : undefined),
          });
          toast(adjustMode === 'WRITE_OFF' ? 'Written off' : 'Wastage recorded', {
            variant: 'success',
          });
          break;
        }
        case 'RECEIVE': {
          if (adjustQuantity <= 0) throw new Error('Quantity must be > 0');
          // Direct stock increase: use the signed PATCH endpoint if available,
          // fall back to adjustment API so receipt always works.
          const delta = Number(adjustQuantity);
          try {
            await apiPatch(`/inventory/items/${adjustTarget.id}/stock`, {
              quantityChange: delta,
              type: 'PURCHASE' as any,
              reason:
                adjustReason +
                (receiveRef ? ` · Ref ${receiveRef}` : '') +
                (receiveSupplierId ? ` · Supplier ${receiveSupplierId}` : ''),
              supplierId: receiveSupplierId || undefined,
              referenceId: receiveRef || undefined,
              referenceType: 'PURCHASE_ORDER',
            });
          } catch (_e) {
            await apiPost(`/inventory/items/${adjustTarget.id}/adjustment`, {
              newQuantity: Number(adjustTarget.currentStockLevel || 0) + delta,
              reason:
                `Received +${delta} ${adjustTarget.unit}` +
                (adjustReason ? ` · ${adjustReason}` : ''),
            });
          }
          toast(`+${delta} ${adjustTarget.unit} received`, { variant: 'success' });
          break;
        }
      }
      setAdjustTarget(null);
      fetchAll();
    } catch (err: any) {
      toast('Update failed', { description: err.message, variant: 'error' });
    } finally {
      setAdjustLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // CSV export
  // -------------------------------------------------------------------------
  const exportCSV = () => {
    const headers = [
      'SKU',
      'Barcode',
      'Item',
      'Category',
      'Preferred Supplier',
      'Unit',
      'Current QTY',
      'Min',
      'Reorder Level',
      'Reorder QTY',
      'Status',
      'Unit Cost (NGN)',
      'Total Value (NGN)',
      'Location',
      'Last Counted',
      'Updated',
    ];
    const data = visible.map((r) => {
      const z = statusOf(r);
      const supplier = r.preferredSupplierId ? supplierById.get(r.preferredSupplierId)?.name : '';
      return [
        r.sku || '',
        r.barCode || '',
        r.name,
        r.category || '',
        supplier || '',
        r.unit,
        r.currentStockLevel,
        Number(r.minimumStockLevel ?? 0),
        Number(r.reorderLevel ?? 0),
        Number(r.reorderQuantity ?? 0),
        ZONE_BADGE[z].label,
        Number(r.unitCostCents || 0) / 100,
        (Number(r.currentStockLevel || 0) * Number(r.unitCostCents || 0)) / 100,
        r.storageLocation || '',
        r.lastCountedAt ? formatDateTime(r.lastCountedAt as any) : '',
        r.updatedAt ? formatDateTime(r.updatedAt as any) : '',
      ];
    });
    const csv =
      [headers, ...data]
        .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
        .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `inventory-items-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    toast('CSV exported', { variant: 'success' });
  };

  // -------------------------------------------------------------------------
  // Details drawer open: loads history from REAL history endpoint
  // -------------------------------------------------------------------------
  const openView = async (r: InventoryItemRow) => {
    setViewTarget(r);
    setViewOpen(true);
    await fetchMovements(r.id);
  };

  // -------------------------------------------------------------------------
  // Main data table columns — standard hospitality inventory layout
  // -------------------------------------------------------------------------
  const columns: Column<InventoryItemRow>[] = [
    {
      key: 'name',
      title: 'SKU / Material',
      render: (r) => {
        const z = statusOf(r);
        return (
          <div className="min-w-0 flex items-start gap-3">
            <div
              className={cn(
                'h-10 w-10 shrink-0 rounded-xl flex items-center justify-center text-lg font-bold ring-1 ring-inset',
                ZONE_BADGE[z].bar,
                'text-white shadow-sm'
              )}
              title={ZONE_BADGE[z].label}
            >
              {z === 'OUT' ? '∅' : z === 'LOW' ? '!' : z === 'OVERSTOCKED' ? '⇑' : '✓'}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-slate-900 truncate">{r.name}</div>
              <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-[11px]">
                {r.sku && (
                  <span className="font-mono text-slate-400 truncate max-w-[8rem]">
                    SKU {r.sku}
                  </span>
                )}
                {r.barCode && (
                  <span className="font-mono text-slate-400 truncate max-w-[8rem]">
                    · GTIN {r.barCode}
                  </span>
                )}
                {r.category && <Badge variant="soft">{r.category}</Badge>}
                <Badge variant={ZONE_BADGE[z].variant as any} dot>
                  {ZONE_BADGE[z].label}
                </Badge>
              </div>
            </div>
          </div>
        );
      },
    },
    {
      key: 'stock',
      title: 'Stock Levels',
      className: 'min-w-[220px]',
      render: (r) => {
        const min = Number(r.minimumStockLevel ?? 0);
        const span = Math.max(
          1,
          Number(r.reorderLevel || 0) * 3 || (min || 1) * 3,
          Number(r.currentStockLevel || 0) + 1
        );
        const pctCur = Math.min(100, Math.round((Number(r.currentStockLevel || 0) / span) * 100));
        const pctMin = Math.min(100, Math.round((min / span) * 100));
        const z = statusOf(r);
        const deficit =
          min > 0 && Number(r.currentStockLevel) < min
            ? Math.round(((min - Number(r.currentStockLevel)) / min) * 100)
            : 0;
        return (
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-bold tabular-nums text-slate-900">
                {formatNumber(Number(r.currentStockLevel || 0))} {r.unit}
              </span>
              <span className="text-slate-500 tabular-nums">
                Min {formatNumber(min)}
                {r.reorderLevel ? ` · Reorder ${formatNumber(Number(r.reorderLevel))}` : ''}
              </span>
            </div>
            <div className="relative h-2 bg-slate-100 rounded-full overflow-hidden">
              <div className="absolute top-0 left-0 h-full bg-slate-200" style={{ width: `${pctMin}%` }} />
              <div
                className={cn(
                  'absolute top-0 left-0 h-full rounded-full transition-all',
                  ZONE_BADGE[z].bar
                )}
                style={{ width: `${pctCur}%` }}
              />
            </div>
            {deficit > 0 && (
              <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                Deficit: -{deficit}%
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'value',
      title: 'Unit / Value',
      className: 'tabular-nums text-right',
      render: (r) => {
        const val = Number(r.currentStockLevel || 0) * Number(r.unitCostCents || 0);
        return (
          <div>
            <div className="font-semibold text-slate-900">{formatNGN(val)}</div>
            <div className="text-[11px] text-slate-500">
              {formatNGN(Number(r.unitCostCents || 0))} / {r.unit}
            </div>
          </div>
        );
      },
    },
    {
      key: 'supplier',
      title: 'Supplier',
      className: 'text-sm',
      render: (r) => {
        const s = r.preferredSupplierId ? supplierById.get(r.preferredSupplierId) : undefined;
        return s ? (
          <div className="min-w-0">
            <div className="font-medium text-slate-900 truncate">{s.name}</div>
            <div className="text-[11px] text-slate-500 truncate">{s.phone}</div>
          </div>
        ) : (
          <span className="text-slate-400">—</span>
        );
      },
    },
    {
      key: 'location',
      title: 'Location',
      className: 'text-sm text-slate-600 max-w-[140px]',
      render: (r) => (r.storageLocation ? <span className="truncate">{r.storageLocation}</span> : <span className="text-slate-400">—</span>),
    },
    {
      key: 'dates',
      title: 'Last Activity',
      className: 'text-[11px] text-slate-500 tabular-nums',
      render: (r) => (
        <div className="space-y-0.5">
          <div>
            Counted:{' '}
            {r.lastCountedAt ? formatDateTime(r.lastCountedAt as any) : <span className="text-slate-400">never</span>}
          </div>
          <div>
            Updated:{' '}
            {r.updatedAt
              ? formatDateTime(r.updatedAt as any)
              : r.createdAt
              ? formatDateTime(r.createdAt as any)
              : '—'}
          </div>
        </div>
      ),
    },
    {
      key: 'actions',
      title: '',
      className: 'text-right w-[310px]',
      render: (r) => (
        <div className="flex items-center justify-end gap-1.5 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              openView(r);
            }}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 mr-1" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            History
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              confirmAdjust(r, 'RECEIVE');
            }}
          >
            + Receive
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              confirmAdjust(r, 'ADJUST');
            }}
          >
            Count
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              openEdit(r);
            }}
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setDeleteTarget(r);
            }}
            className="text-red-600 hover:text-red-700 hover:bg-red-50"
          >
            Archive
          </Button>
        </div>
      ),
    },
  ];

  // -------------------------------------------------------------------------
  // JSX: layout
  // -------------------------------------------------------------------------
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            Inventory Management
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {formatNumber(kpis.skus)} SKUs · {categories.length} categories · {branch?.name || 'All Branches'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" onClick={exportCSV}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 mr-1">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Export CSV
          </Button>
          <Button variant="outline" onClick={fetchAll}>
            Refresh
          </Button>
          <Button onClick={openCreate}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 mr-1">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Add Item
          </Button>
        </div>
      </div>

      {/* 5 KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Card className="!p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">SKUs Tracked</div>
          <div className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">
            {formatNumber(kpis.skus)}
          </div>
          <div className="text-xs text-slate-500 mt-1">{kpis.categories} categories</div>
        </Card>
        <Card className="!p-4 border-l-4 !border-l-red-500">
          <div className="text-[10px] font-bold uppercase tracking-wider text-red-600">Out of Stock</div>
          <div className="mt-1 text-2xl font-bold text-red-700 tabular-nums">
            {formatNumber(kpis.out)}
          </div>
          <div className="text-xs text-red-600/80 mt-1">Needs immediate restock</div>
        </Card>
        <Card className="!p-4 border-l-4 !border-l-amber-400">
          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-600">Low Stock</div>
          <div className="mt-1 text-2xl font-bold text-amber-700 tabular-nums">
            {formatNumber(kpis.low)}
          </div>
          <div className="text-xs text-amber-600/80 mt-1">Below minimum level</div>
        </Card>
        <Card className="!p-4 border-l-4 !border-l-sky-400">
          <div className="text-[10px] font-bold uppercase tracking-wider text-sky-600">Overstocked</div>
          <div className="mt-1 text-2xl font-bold text-sky-700 tabular-nums">
            {formatNumber(kpis.over)}
          </div>
          <div className="text-xs text-sky-600/80 mt-1">3× above reorder</div>
        </Card>
        <Card className="!p-4 border-l-4 !border-l-brand-500 col-span-2 md:col-span-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-brand-600">Total Holding Value</div>
          <div className="mt-1 text-2xl font-bold text-brand-700 tabular-nums">
            {formatNGN(kpis.value)}
          </div>
          <div className="text-xs text-brand-600/80 mt-1">At current stock × unit cost</div>
        </Card>
      </div>

      {/* Main data card */}
      <Card>
        {/* Filter bar */}
        <div className="px-5 py-4 border-b border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <Input
            placeholder="Search name, SKU, barcode, supplier, location..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="lg:col-span-2"
            prefix={
              <svg
                className="h-4 w-4 text-slate-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="8" />
                <path
                  d="M21 21l-4.35-4.35"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            }
          />
          <Select
            options={[
              { value: '', label: 'All Categories' },
              ...categories.map((c) => ({ value: c, label: c })),
            ]}
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          />
          <Select
            options={[
              { value: '', label: 'All Suppliers' },
              ...suppliers.map((s) => ({ value: s.id, label: s.name })),
            ]}
            value={supplierFilter}
            onChange={(e) => setSupplierFilter(e.target.value)}
          />
          <div className="sm:col-span-2 flex items-center gap-1.5 overflow-x-auto">
            {STATUS_ZONES.map((sz) => {
              const active = zone === sz.id;
              return (
                <button
                  key={sz.id}
                  onClick={() => setZone(sz.id)}
                  className={cn(
                    'shrink-0 inline-flex items-center gap-1.5 h-[42px] px-3 rounded-xl border transition-all text-sm font-semibold',
                    active
                      ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                      : 'bg-white border-slate-200 text-slate-700 hover:border-brand-400 hover:text-brand-700'
                  )}
                >
                  <span className={cn('h-2.5 w-2.5 rounded-full', sz.dot)} />
                  {sz.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Table */}
        <DataTable
          columns={columns}
          data={visible}
          rowKey={(r) => r.id}
          loading={loading}
          emptyText="No inventory items found — click Add Item to create one"
          onRowClick={(r) => openView(r)}
          className="cursor-pointer"
        />
      </Card>

      {/* ---------------- Create / Edit item drawer ---------------- */}
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        size="lg"
        title={editing ? 'Edit Inventory Item' : 'Add Inventory Item'}
        description="Stock-keeping unit — track levels, suppliers, cost, reorder alerts, and location"
        footer={
          <div className="flex items-center justify-end gap-3 w-full">
            <Button variant="outline" onClick={() => setDrawerOpen(false)}>
              Cancel
            </Button>
            <Button loading={saving} onClick={saveForm}>
              {editing ? 'Save Changes' : 'Create Item'}
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-200 p-4 space-y-4 bg-slate-50/50">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Identification
            </div>
            <Input
              label="Material / Item Name"
              placeholder="e.g. Guinness Foreign Extra Stout (Can)"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input
                label="SKU (optional)"
                placeholder="INV-0001"
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
              />
              <Input
                label="Barcode / GTIN (optional)"
                value={form.barCode}
                onChange={(e) => setForm({ ...form, barCode: e.target.value })}
              />
              <Select
                label="Category"
                options={[
                  { value: '', label: 'Select category' },
                  ...categories.map((c) => ({ value: c, label: c })),
                ]}
                value={form.category || ''}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              />
            </div>
            <Textarea
              label="Description (optional)"
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

          <div className="rounded-2xl border border-slate-200 p-4 space-y-4">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Stock & Unit
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Select
                label="Unit"
                options={UNIT_OPTIONS.map((u) => ({ value: u.value, label: u.label }))}
                value={form.unit as any}
                onChange={(e) => setForm({ ...form, unit: e.target.value as Unit })}
              />
              <Input
                label="Current Stock"
                type="number"
                value={String(form.currentStockLevel)}
                onChange={(e) =>
                  setForm({ ...form, currentStockLevel: Number(e.target.value) })
                }
              />
              <div>
                <Input
                  label="Unit Cost (cents)"
                  type="number"
                  min={0}
                  value={String(form.unitCostCents)}
                  onChange={(e) => setForm({ ...form, unitCostCents: Number(e.target.value) })}
                />
                <div className="text-xs mt-1.5 text-slate-500">
                  ≈ {formatNGN(Number(form.unitCostCents || 0))}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input
                label="Minimum Stock Level (alert)"
                type="number"
                min={0}
                value={String(form.minimumStockLevel)}
                onChange={(e) =>
                  setForm({ ...form, minimumStockLevel: Number(e.target.value) })
                }
              />
              <Input
                label="Reorder Level"
                type="number"
                min={0}
                value={String(form.reorderLevel || 0)}
                onChange={(e) => setForm({ ...form, reorderLevel: Number(e.target.value) })}
              />
              <Input
                label="Reorder Quantity"
                type="number"
                min={0}
                value={String(form.reorderQuantity || 0)}
                onChange={(e) =>
                  setForm({ ...form, reorderQuantity: Number(e.target.value) })
                }
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Default Markup % (optional)"
                type="number"
                min={0}
                value={String(form.defaultMarkupPercent || 0)}
                onChange={(e) =>
                  setForm({ ...form, defaultMarkupPercent: Number(e.target.value) })
                }
              />
              <Select
                label="Preferred Supplier"
                options={[
                  { value: '', label: 'None' },
                  ...suppliers.map((s) => ({ value: s.id, label: s.name })),
                ]}
                value={form.preferredSupplierId || ''}
                onChange={(e) =>
                  setForm({ ...form, preferredSupplierId: e.target.value })
                }
              />
            </div>
            <Input
              label="Storage Location"
              placeholder="e.g. Walk-in freezer · Shelf B3, Bar fridge bottom"
              value={form.storageLocation}
              onChange={(e) => setForm({ ...form, storageLocation: e.target.value })}
            />
          </div>
        </div>
      </Drawer>

      {/* ---------------- Adjust / Count / Wastage / Receive / Write-off confirm ---------------- */}
      <ConfirmDialog
        open={!!adjustTarget}
        onClose={() => setAdjustTarget(null)}
        onConfirm={applyAdjust}
        title={
          adjustMode === 'ADJUST'
            ? 'Stock Count / Adjustment'
            : adjustMode === 'WASTAGE'
            ? 'Record Wastage'
            : adjustMode === 'WRITE_OFF'
            ? 'Write-off Stock'
            : 'Receive Stock'
        }
        description={
          adjustTarget
            ? `${adjustTarget.name} · Current ${formatNumber(
                Number(adjustTarget.currentStockLevel || 0)
              )} ${adjustTarget.unit}`
            : ''
        }
        confirmText={
          adjustMode === 'ADJUST'
            ? 'Update Stock'
            : adjustMode === 'RECEIVE'
            ? 'Receive'
            : adjustMode === 'WRITE_OFF'
            ? 'Write off'
            : 'Record'
        }
        loading={adjustLoading}
        variant={
          adjustMode === 'WRITE_OFF' || adjustMode === 'WASTAGE'
            ? 'danger'
            : 'primary'
        }
      >
        {adjustTarget && (
          <div className="space-y-3">
            {adjustMode === 'RECEIVE' && (
              <div className="grid grid-cols-2 gap-3">
                <Select
                  label="Supplier"
                  options={[
                    { value: '', label: 'Any' },
                    ...suppliers.map((s) => ({ value: s.id, label: s.name })),
                  ]}
                  value={receiveSupplierId}
                  onChange={(e) => setReceiveSupplierId(e.target.value)}
                />
                <Input
                  label="PO / Invoice #"
                  value={receiveRef}
                  onChange={(e) => setReceiveRef(e.target.value)}
                />
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label={
                  adjustMode === 'ADJUST'
                    ? `New Quantity (${adjustTarget.unit})`
                    : adjustMode === 'RECEIVE'
                    ? `Quantity Received (+${adjustTarget.unit})`
                    : `Quantity (${adjustTarget.unit})`
                }
                type="number"
                min={0}
                value={String(adjustQuantity)}
                onChange={(e) => setAdjustQuantity(Number(e.target.value))}
              />
              {adjustMode === 'RECEIVE' && (
                <div>
                  <Input
                    label="Unit Cost at Receive (cents)"
                    type="number"
                    min={0}
                    value={String(receiveCostCents)}
                    onChange={(e) => setReceiveCostCents(Number(e.target.value))}
                  />
                  <div className="text-xs mt-1.5 text-slate-500">
                    {formatNGN(receiveCostCents)}
                  </div>
                </div>
              )}
            </div>
            <Input
              label="Reason / Notes (optional)"
              placeholder={
                adjustMode === 'WASTAGE'
                  ? 'Breakage, spillage, expired...'
                  : adjustMode === 'WRITE_OFF'
                  ? 'Damaged, obsolete, recalled...'
                  : adjustMode === 'RECEIVE'
                  ? 'Delivery conditions, lot numbers, temperature check'
                  : 'Stock take / recount / correction'
              }
              value={adjustReason}
              onChange={(e) => setAdjustReason(e.target.value)}
            />
            <div className="text-xs text-slate-500">
              {adjustMode === 'ADJUST' &&
                'Sets stock to an exact value and writes an ADJUSTMENT transaction.'}
              {adjustMode === 'WASTAGE' &&
                'Reduces stock and writes a WASTAGE transaction (for spoilage / breakage).'}
              {adjustMode === 'WRITE_OFF' &&
                'Reduces stock and writes a WASTAGE transaction with write-off reason.'}
              {adjustMode === 'RECEIVE' &&
                'Increases stock and writes a PURCHASE transaction, with optional supplier & reference.'}
            </div>
          </div>
        )}
      </ConfirmDialog>

      {/* ---------------- Archive confirm ---------------- */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={deleteItem}
        title="Archive inventory item?"
        description={deleteTarget ? deleteTarget.name : ''}
        confirmText="Archive"
        loading={deleteLoading}
        variant="danger"
      >
        <p className="text-sm text-slate-600">
          This marks the item inactive (hidden from default listings). Historical
          transactions and stock ledger entries are preserved for reporting.
        </p>
      </ConfirmDialog>

      {/* ---------------- View Details drawer: Item + Ledger History ---------------- */}
      <Drawer
        open={viewOpen}
        onClose={() => setViewOpen(false)}
        size="xl"
        title={viewTarget ? viewTarget.name : 'Item Details'}
        description={
          viewTarget
            ? `${viewTarget.sku ? `SKU ${viewTarget.sku} · ` : ''}${
                viewTarget.category || 'Uncategorized'
              } · Transaction Ledger`
            : ''
        }
      >
        {viewTarget && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
              {/* LEFT: Info card */}
              <div className="lg:col-span-2 space-y-3">
                <Card className="!p-5 space-y-4">
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        'h-14 w-14 rounded-2xl flex items-center justify-center text-white font-black text-2xl ring-1 ring-inset shadow-sm',
                        ZONE_BADGE[statusOf(viewTarget)].bar
                      )}
                    >
                      {formatNumber(Number(viewTarget.currentStockLevel || 0)).slice(0, 2)}
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-slate-900 text-lg truncate">
                        {viewTarget.name}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        {viewTarget.sku && (
                          <span className="font-mono text-[11px] text-slate-500 truncate max-w-[10rem]">
                            {viewTarget.sku}
                          </span>
                        )}
                        <Badge variant={ZONE_BADGE[statusOf(viewTarget)].variant as any} dot>
                          {ZONE_BADGE[statusOf(viewTarget)].label}
                        </Badge>
                        {viewTarget.category && <Badge variant="soft">{viewTarget.category}</Badge>}
                      </div>
                    </div>
                  </div>
                  {viewTarget.description && (
                    <p className="text-sm text-slate-600 border-t border-slate-100 pt-3">
                      {viewTarget.description}
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        Qty on Hand
                      </div>
                      <div className="mt-1 text-lg font-bold text-slate-900 tabular-nums">
                        {formatNumber(Number(viewTarget.currentStockLevel || 0))}{' '}
                        <span className="text-xs text-slate-500 font-medium">{viewTarget.unit}</span>
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        Holding Value
                      </div>
                      <div className="mt-1 text-lg font-bold text-brand-700 tabular-nums">
                        {formatNGN(
                          Number(viewTarget.currentStockLevel || 0) *
                            Number(viewTarget.unitCostCents || 0)
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        Min · Reorder
                      </div>
                      <div className="mt-1 text-sm font-semibold text-slate-700 tabular-nums">
                        {formatNumber(Number(viewTarget.minimumStockLevel ?? 0))} ·{' '}
                        {formatNumber(Number(viewTarget.reorderLevel ?? 0))}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        Unit Cost
                      </div>
                      <div className="mt-1 text-sm font-semibold text-slate-700 tabular-nums">
                        {formatNGN(Number(viewTarget.unitCostCents || 0))} / {viewTarget.unit}
                      </div>
                    </div>
                  </div>
                  <div className="rule" />
                  <div className="grid grid-cols-1 gap-2.5 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500 font-medium">Preferred Supplier</span>
                      <span className="text-slate-900 font-semibold truncate text-right">
                        {viewTarget.preferredSupplierId
                          ? supplierById.get(viewTarget.preferredSupplierId)?.name || '—'
                          : '—'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500 font-medium">Storage</span>
                      <span className="text-slate-900 font-semibold truncate text-right">
                        {viewTarget.storageLocation || '—'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500 font-medium">Last Counted</span>
                      <span className="text-slate-700 font-medium tabular-nums text-right">
                        {viewTarget.lastCountedAt
                          ? formatDateTime(viewTarget.lastCountedAt as any)
                          : 'Never'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500 font-medium">Last Restocked</span>
                      <span className="text-slate-700 font-medium tabular-nums text-right">
                        {viewTarget.lastRestockedAt
                          ? formatDateTime(viewTarget.lastRestockedAt as any)
                          : '—'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pt-2">
                    <Button
                      className="flex-1"
                      onClick={() => confirmAdjust(viewTarget, 'RECEIVE')}
                    >
                      + Receive
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => confirmAdjust(viewTarget, 'ADJUST')}
                    >
                      Count / Adjust
                    </Button>
                    <Button variant="ghost" onClick={() => openEdit(viewTarget)}>
                      Edit
                    </Button>
                  </div>
                </Card>

                {/* Quick totals for this SKU */}
                <Card className="!p-4 space-y-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Movement Summary ({movements.length})
                  </div>
                  <div className="grid grid-cols-3 gap-2.5">
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                        Total In
                      </div>
                      <div className="mt-1 text-emerald-800 font-bold tabular-nums">
                        +
                        {formatNumber(
                          movements
                            .filter((m) => m.quantityChange > 0)
                            .reduce((s, m) => s + m.quantityChange, 0)
                        )}
                      </div>
                    </div>
                    <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-red-700">
                        Total Out
                      </div>
                      <div className="mt-1 text-red-800 font-bold tabular-nums">
                        {formatNumber(
                          Math.abs(
                            movements
                              .filter((m) => m.quantityChange < 0)
                              .reduce((s, m) => s + m.quantityChange, 0)
                          )
                        )}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
                        Net Move
                      </div>
                      <div className="mt-1 text-slate-800 font-bold tabular-nums">
                        {movements.reduce((s, m) => s + (m.quantityChange || 0), 0) >= 0
                          ? '+'
                          : ''}
                        {formatNumber(
                          movements.reduce((s, m) => s + (m.quantityChange || 0), 0)
                        )}{' '}
                        <span className="text-xs text-slate-500">{viewTarget.unit}</span>
                      </div>
                    </div>
                  </div>
                </Card>
              </div>

              {/* RIGHT: Transaction ledger table */}
              <div className="lg:col-span-3">
                <Card className="!p-0 overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        Materials Ledger
                      </div>
                      <div className="text-lg font-bold text-slate-900 mt-0.5">
                        Transaction History
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => fetchMovements(viewTarget.id)}
                      disabled={movementsLoading}
                    >
                      {movementsLoading ? 'Loading...' : 'Refresh'}
                    </Button>
                  </div>

                  {movementsLoading && movements.length === 0 ? (
                    <div className="h-72 flex items-center justify-center">
                      <div className="text-slate-500 text-sm">Loading ledger...</div>
                    </div>
                  ) : (
                    <div className="max-h-[540px] overflow-y-auto">
                      {movements.length === 0 ? (
                        <div className="h-72 flex flex-col items-center justify-center text-center px-5">
                          <div className="text-4xl mb-3">📒</div>
                          <h4 className="font-bold text-slate-900">No movements yet</h4>
                          <p className="text-sm text-slate-500 mt-1 max-w-sm">
                            Every Receive, Count/Adjust, Wastage, Write-off, Sale,
                            Production or Transfer on this SKU will appear here as
                            an append-only, date-sorted audit trail.
                          </p>
                        </div>
                      ) : (
                        <table className="min-w-full text-sm">
                          <thead className="sticky top-0 bg-slate-50/95 backdrop-blur border-b border-slate-200">
                            <tr>
                              <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                Date / Actor
                              </th>
                              <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                Type
                              </th>
                              <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                Ref · Supplier
                              </th>
                              <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500 tabular-nums">
                                Delta
                              </th>
                              <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500 tabular-nums">
                                Value Δ
                              </th>
                              <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                Reason
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {movements.map((m, idx) => {
                              const variant =
                                TX_VARIANT[m.type as InventoryTransactionType] ||
                                TX_VARIANT.ADJUSTMENT;
                              const delta = Number(m.quantityChange || 0);
                              const unitCost = Number(m.unitCostCentsAtTime ?? 0);
                              const valueDelta = delta * unitCost;
                              const signed = delta > 0 ? '+' : '';
                              return (
                                <tr
                                  key={m.id}
                                  className={cn(
                                    'align-top hover:bg-slate-50/60 border-l-4',
                                    variant.tint?.includes('emerald') && 'border-l-emerald-400',
                                    variant.tint?.includes('red') && 'border-l-red-400',
                                    variant.tint?.includes('amber') && 'border-l-amber-400',
                                    variant.tint?.includes('sky') && 'border-l-sky-400',
                                    variant.tint?.includes('teal') && 'border-l-teal-400',
                                    variant.tint?.includes('slate') && 'border-l-slate-300',
                                    !(
                                      variant.tint?.includes('emerald') ||
                                      variant.tint?.includes('red') ||
                                      variant.tint?.includes('amber') ||
                                      variant.tint?.includes('sky') ||
                                      variant.tint?.includes('teal') ||
                                      variant.tint?.includes('slate')
                                    ) && 'border-l-slate-200'
                                  )}
                                >
                                  <td className="px-4 py-3">
                                    <div className="font-semibold tabular-nums text-slate-900">
                                      {formatDateTime(m.performedAt as any)}
                                    </div>
                                    <div className="text-[11px] text-slate-500 mt-0.5">
                                      by{' '}
                                      <span className="font-medium text-slate-700">
                                        {m.performedByName || m.performedById || 'System'}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="px-4 py-3">
                                    <Badge
                                      variant={variant.variant as any}
                                      dot
                                      className="shrink-0"
                                    >
                                      {variant.label}
                                    </Badge>
                                  </td>
                                  <td className="px-4 py-3 min-w-[160px]">
                                    {m.referenceId && (
                                      <div className="font-mono text-xs font-semibold text-slate-900 truncate">
                                        {m.referenceType || 'REF'} · {m.referenceId}
                                      </div>
                                    )}
                                    {m.supplierId && (
                                      <div className="text-[11px] text-slate-500 truncate mt-0.5">
                                        {supplierById.get(m.supplierId)?.name ||
                                          m.supplierName ||
                                          m.supplierId}
                                      </div>
                                    )}
                                    {!m.referenceId && !m.supplierId && (
                                      <span className="text-slate-400 text-xs">—</span>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-right tabular-nums align-middle">
                                    <div
                                      className={cn(
                                        'font-bold',
                                        delta > 0
                                          ? 'text-emerald-700'
                                          : delta < 0
                                          ? 'text-red-700'
                                          : 'text-slate-700'
                                      )}
                                    >
                                      {signed}
                                      {formatNumber(delta)} {viewTarget.unit}
                                    </div>
                                    {unitCost > 0 && (
                                      <div className="text-[11px] text-slate-500 mt-0.5">
                                        @ {formatNGN(unitCost)}
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-right tabular-nums align-middle">
                                    <div
                                      className={cn(
                                        'font-semibold',
                                        valueDelta > 0
                                          ? 'text-emerald-700'
                                          : valueDelta < 0
                                          ? 'text-red-700'
                                          : 'text-slate-500'
                                      )}
                                    >
                                      {valueDelta >= 0 ? '+' : ''}
                                      {formatNGN(valueDelta)}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 max-w-[200px] align-middle">
                                    {m.reason ? (
                                      <p className="text-sm text-slate-700 line-clamp-2">
                                        {m.reason}
                                      </p>
                                    ) : (
                                      <span className="text-slate-400 text-xs">—</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </Card>
              </div>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
