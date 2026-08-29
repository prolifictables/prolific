'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { DataTable, Column } from '@/components/ui/Table';
import { apiGet } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { formatNGN, formatNumber } from '@/lib/format';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';

interface InventoryItemRow {
  id: string;
  sku: string;
  name: string;
  category?: string;
  supplier?: string;
  unit: string;
  currentStock: number;
  minStock: number;
  maxStock?: number;
  reorderPoint: number;
  onOrder?: number;
  lastCost: number;
  avgCost?: number;
  updatedAt: string;
  status: 'OK' | 'LOW' | 'OUT' | 'EXCESS';
}

const STATUS_MAP: Record<InventoryItemRow['status'], { variant: any; label: string }> = {
  OK: { variant: 'success', label: 'In Stock' },
  LOW: { variant: 'warning', label: 'Low Stock' },
  OUT: { variant: 'danger', label: 'Out of Stock' },
  EXCESS: { variant: 'info', label: 'Overstocked' },
};

export default function InventoryReportPage() {
  const { branch } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [supplier, setSupplier] = useState('');
  const [category, setCategory] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [items, setItems] = useState<InventoryItemRow[]>([]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (lowOnly) params.set('includeLowStock', 'true');
      if (branch?.id) params.set('branchId', branch.id);
      const res: any = await apiGet(`/reports/inventory?${params.toString()}`);
      const list: any[] = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
      setItems(
        list.map((r: any) => {
          const current = Number(r.currentQty || 0);
          const min = Number(r.minQty || 0);
          const status: InventoryItemRow['status'] =
            current <= 0 ? 'OUT' : current <= min ? 'LOW' : 'OK';
          return {
            id: String(r.inventoryItemId || r.id),
            sku: String(r.sku || ''),
            name: String(r.name || ''),
            category: r.category ? String(r.category) : undefined,
            supplier: r.supplierId ? String(r.supplierId) : undefined,
            unit: String(r.unit || ''),
            currentStock: current,
            minStock: min,
            maxStock: undefined,
            reorderPoint: min,
            onOrder: 0,
            lastCost: Number(r.unitCostCents || 0),
            avgCost: undefined,
            updatedAt: (r.lastPurchaseDate ? new Date(r.lastPurchaseDate) : new Date()).toISOString(),
            status,
          };
        })
      );
    } catch (err: any) {
      toast('Failed to load inventory report', { description: err.message, variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, [branch?.id, lowOnly]);

  const suppliers = useMemo(() => Array.from(new Set(items.map((i) => i.supplier || '').filter(Boolean))), [items]);
  const categories = useMemo(() => Array.from(new Set(items.map((i) => i.category || '').filter(Boolean))), [items]);

  const filtered = useMemo(() => items.filter((i) => {
    if (lowOnly && i.status === 'OK') return false;
    if (supplier && i.supplier !== supplier) return false;
    if (category && i.category !== category) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!(`${i.name} ${i.sku} ${i.category} ${i.supplier}`.toLowerCase().includes(q))) return false;
    }
    return true;
  }), [items, search, supplier, category, lowOnly]);

  const totals = useMemo(() => {
    const t = { count: filtered.length, lowCount: 0, outCount: 0, value: 0, deficitCount: 0 };
    filtered.forEach((i) => {
      t.value += i.currentStock * i.lastCost;
      if (i.status === 'LOW') t.lowCount++;
      if (i.status === 'OUT') t.outCount++;
      if (i.currentStock < i.minStock) t.deficitCount++;
    });
    return t;
  }, [filtered]);

  const exportCSV = () => {
    const headers = ['SKU', 'Item', 'Category', 'Supplier', 'Unit', 'Current', 'Min', 'Max', 'Reorder', 'On Order', 'Unit Cost (NGN)', 'Status'];
    const data = filtered.map((r) => [
      r.sku, r.name, r.category || '', r.supplier || '', r.unit,
      r.currentStock, r.minStock, r.maxStock || '', r.reorderPoint, r.onOrder || 0,
      r.lastCost / 100, STATUS_MAP[r.status].label,
    ]);
    const csv = [headers, ...data].map((row) => row.map((c) => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `inventory-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    toast('CSV exported', { variant: 'success' });
  };

  const deficitPct = (cur: number, min: number) => cur >= min ? 0 : Math.round(((min - cur) / min) * 100);

  const columns: Column<InventoryItemRow>[] = [
    {
      key: 'item', title: 'Item', render: (r) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="font-semibold text-slate-900 truncate">{r.name}</div>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] font-mono text-slate-400">{r.sku}</span>
            {r.category && <Badge variant="soft">{r.category}</Badge>}
          </div>
        </div>
      ),
    },
    { key: 'supplier', title: 'Supplier', className: 'text-sm text-slate-600', render: (r) => r.supplier || '—' },
    {
      key: 'stock', title: 'Stock Levels', className: 'min-w-[220px]',
      render: (r) => {
        const span = (r.maxStock || r.minStock * 3);
        const pctCur = Math.min(100, Math.round((r.currentStock / span) * 100));
        const pctMin = Math.min(100, Math.round((r.minStock / span) * 100));
        const def = deficitPct(r.currentStock, r.minStock);
        return (
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-semibold tabular-nums text-slate-900">{formatNumber(r.currentStock)} {r.unit}</span>
              <span className="text-slate-500 tabular-nums">Min: {r.minStock}{r.maxStock ? ` / Max: ${r.maxStock}` : ''}</span>
            </div>
            <div className="relative h-2 bg-slate-100 rounded-full overflow-hidden">
              <div className="absolute top-0 left-0 h-full bg-slate-200" style={{ width: `${pctMin}%` }} />
              <div
                className={cn(
                  'absolute top-0 left-0 h-full rounded-full transition-all',
                  r.status === 'OUT' ? 'bg-red-500' : r.status === 'LOW' ? 'bg-amber-500' : r.status === 'EXCESS' ? 'bg-sky-500' : 'bg-emerald-500'
                )}
                style={{ width: `${pctCur}%` }}
              />
            </div>
            {def > 0 && (
              <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                Deficit: -{def}%
              </div>
            )}
          </div>
        );
      },
    },
    { key: 'reorder', title: 'Reorder Point', className: 'tabular-nums text-center text-slate-600', render: (r) => (r.reorderPoint ? `${formatNumber(r.reorderPoint)} ${r.unit}` : '—') },
    { key: 'onOrder', title: 'On Order', className: 'tabular-nums text-center', render: (r) => r.onOrder ? <Badge variant="info">{formatNumber(r.onOrder)} {r.unit}</Badge> : <span className="text-slate-400">—</span> },
    {
      key: 'value', title: 'Unit Cost / Value',
      render: (r) => (
        <div className="text-right">
          <div className="font-semibold text-slate-900 tabular-nums">{formatNGN(r.currentStock * r.lastCost)}</div>
          <div className="text-[11px] text-slate-500 tabular-nums">{formatNGN(r.lastCost)} / {r.unit}</div>
        </div>
      ),
    },
    { key: 'status', title: 'Status', render: (r) => {
      const m = STATUS_MAP[r.status];
      return <Badge variant={m.variant as any} dot>{m.label}</Badge>;
    } },
    { key: 'updated', title: 'Last Updated', className: 'text-[11px] text-slate-500 tabular-nums', render: (r) => {
      const d = new Date(r.updatedAt);
      return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Badge variant="info">Reporting</Badge>
            <span>·</span>
            <span>{branch?.name || 'All Branches'}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mt-1.5">Inventory Report</h1>
          <p className="text-sm text-slate-500 mt-1">Real-time stock levels, deficits, and holding values</p>
        </div>
        <Button variant="secondary" onClick={exportCSV}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 mr-1"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Card className="!p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Items Tracked</div>
          <div className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{formatNumber(totals.count)}</div>
          <div className="text-xs text-slate-500 mt-1">{categories.length} categories</div>
        </Card>
        <Card className="!p-4 border-l-4 !border-l-amber-400">
          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-600">Low Stock</div>
          <div className="mt-1 text-2xl font-bold text-amber-700 tabular-nums">{formatNumber(totals.lowCount)}</div>
          <div className="text-xs text-amber-600/80 mt-1">Below minimum</div>
        </Card>
        <Card className="!p-4 border-l-4 !border-l-red-500">
          <div className="text-[10px] font-bold uppercase tracking-wider text-red-600">Out of Stock</div>
          <div className="mt-1 text-2xl font-bold text-red-700 tabular-nums">{formatNumber(totals.outCount)}</div>
          <div className="text-xs text-red-600/80 mt-1">Needs restock</div>
        </Card>
        <Card className="!p-4 border-l-4 !border-l-brand-500">
          <div className="text-[10px] font-bold uppercase tracking-wider text-brand-600">Total Holding Value</div>
          <div className="mt-1 text-2xl font-bold text-brand-700 tabular-nums">{formatNGN(totals.value)}</div>
          <div className="text-xs text-brand-600/80 mt-1">At current stock</div>
        </Card>
        <Card className="!p-4 border-l-4 !border-l-accent-500">
          <div className="text-[10px] font-bold uppercase tracking-wider text-accent-600">Deficit Alerts</div>
          <div className="mt-1 text-2xl font-bold text-accent-700 tabular-nums">{formatNumber(totals.deficitCount)}</div>
          <div className="text-xs text-accent-600/80 mt-1">Current &lt; Min</div>
        </Card>
      </div>

      <Card>
        <div className="px-5 pt-4 pb-3 border-b border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <Input
            placeholder="Search SKU, name, supplier..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="lg:col-span-2"
            prefix={
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" strokeLinecap="round" strokeLinejoin="round" /></svg>
            }
          />
          <Select
            options={[{ value: '', label: 'All Categories' }, ...categories.map((c) => ({ value: c, label: c }))]}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
          <Select
            options={[{ value: '', label: 'All Suppliers' }, ...suppliers.map((s) => ({ value: s, label: s }))]}
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
          />
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 h-[42px] bg-white">
            <input type="checkbox" id="lowOnly" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
            <label htmlFor="lowOnly" className="text-sm font-medium text-slate-700 cursor-pointer select-none">Show low/out only</label>
          </div>
        </div>
        <DataTable
          columns={columns}
          data={filtered}
          rowKey={(r) => r.id}
          loading={loading}
          emptyText="No inventory items match filters"
        />
      </Card>
    </div>
  );
}
