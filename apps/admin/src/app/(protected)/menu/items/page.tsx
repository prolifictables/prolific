'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { DataTable, Column } from '@/components/ui/Table';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/Modal';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { formatNGN, formatDateTime, formatNumber } from '@/lib/format';
import { cn } from '@/lib/cn';
import { toast } from '@/components/ui/Toast';
import type { MenuItem, MenuItemStatus, MenuCategory, MenuModifier, Tax } from '@prolific/shared-types';

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'AVAILABLE', label: 'Available' },
  { value: 'OUT_OF_STOCK', label: 'Out of Stock' },
  { value: 'DISABLED', label: 'Disabled' },
  { value: 'SCHEDULED', label: 'Scheduled' },
];

const STATUS_MAP: Record<MenuItemStatus, { variant: any; label: string }> = {
  AVAILABLE: { variant: 'success', label: 'Available' },
  OUT_OF_STOCK: { variant: 'danger', label: 'Out of Stock' },
  DISABLED: { variant: 'soft', label: 'Disabled' },
  SCHEDULED: { variant: 'brand', label: 'Scheduled' },
};

interface ItemForm {
  id?: string;
  name: string;
  categoryId: string;
  price: string;
  description: string;
  imageUrl: string;
  status: MenuItemStatus;
  modifierIds: string[];
  taxIds: string[];
  isTaxable: boolean;
  scheduleStart: string;
  scheduleEnd: string;
}

const EMPTY_FORM: ItemForm = {
  name: '',
  categoryId: '',
  price: '',
  description: '',
  imageUrl: '',
  status: 'AVAILABLE' as MenuItemStatus,
  modifierIds: [],
  taxIds: [],
  isTaxable: true,
  scheduleStart: '',
  scheduleEnd: '',
};

// Helper: reliably extract the MongoDB ObjectId as a plain string from a row.
// Raw Mongoose documents use `_id` (ObjectId type), but shared-types define `id` (string).
// Safely handle paginated wrappers, virtualized fields, and raw bson ObjectIds.
function entityId(row: any): string | null {
  if (!row) return null;
  const raw = row._id ?? row.id ?? undefined;
  if (raw == null) return null;
  if (typeof raw === 'string') return raw || null;
  if (typeof raw.toString === 'function') {
    const s = raw.toString();
    return s || null;
  }
  return null;
}
// Normalize an array of API rows so the shared-types expected fields are plain strings/numbers
// and every row has a reliable `.id` that write URLs can use.
function normalizeItemRows(input: any): MenuItem[] {
  const arr = Array.isArray(input) ? input : Array.isArray(input?.data) ? input.data : [];
  return arr.map((r: any) => ({
    ...r,
    id: entityId(r) ?? '',
    categoryId: String(r.categoryId ?? r.category_id ?? ''),
    restaurantId: String(r.restaurantId ?? r.restaurant_id ?? ''),
    branchId: String(r.branchId ?? r.branch_id ?? ''),
    price: Number(r.price ?? r.priceCents ?? 0),
    modifierIds: Array.isArray(r.modifierIds) ? r.modifierIds.map(String) : [],
    taxIds: Array.isArray(r.taxIds) ? r.taxIds.map(String) : [],
  }));
}
function normalizeCategoryRows(input: any): MenuCategory[] {
  const arr = Array.isArray(input) ? input : Array.isArray(input?.data) ? input.data : [];
  return arr.map((r: any) => ({
    ...r,
    id: entityId(r) ?? '',
    restaurantId: String(r.restaurantId ?? r.restaurant_id ?? ''),
    branchId: String(r.branchId ?? r.branch_id ?? ''),
  }));
}
function normalizeModifierRows(input: any): MenuModifier[] {
  const arr = Array.isArray(input) ? input : Array.isArray(input?.data) ? input.data : [];
  return arr.map((r: any) => ({
    ...r,
    id: entityId(r) ?? '',
    options: Array.isArray(r.options)
      ? r.options.map((o: any) => ({ ...o, id: entityId(o) ?? String(o.id ?? o._id ?? '') }))
      : [],
  }));
}

export default function MenuItemsPage() {
  const { branch } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [modifiers, setModifiers] = useState<MenuModifier[]>([]);
  const [taxes, setTaxes] = useState<Tax[]>([]);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ItemForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [deleteItem, setDeleteItem] = useState<MenuItem | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [toggleStatusLoadingId, setToggleStatusLoadingId] = useState<string | null>(null);

  const fetchAll = async () => {
    setLoading(true);
    try {
      // Critical reads fail loudly (items / cats / mods). Optional taxes gracefully fall back to [].
      const [itemsRes, catsRes, modsRes] = await Promise.all([
        apiGet<any>('/menu/items?limit=200&sort=-updatedAt'),
        apiGet<any>('/menu/categories'),
        apiGet<any>('/menu/modifiers'),
      ]);
      // Taxes is optional — if the endpoint is not yet implemented, just show empty list in the drawer.
      const taxesRes = await apiGet<any>(
        branch?.id ? `/taxes?branchId=${encodeURIComponent(branch.id)}` : '/taxes'
      ).catch(() => ({ data: [] }));
      // Normalize rows (Mongoose _id → shared-types id string; unwrap paginated wrappers if present)
      setItems(normalizeItemRows(itemsRes?.data ?? itemsRes));
      setCategories(normalizeCategoryRows(catsRes?.data ?? catsRes));
      setModifiers(normalizeModifierRows(modsRes?.data ?? modsRes));
      const rawTaxes = taxesRes?.data ?? taxesRes ?? [];
      setTaxes(Array.isArray(rawTaxes) ? rawTaxes.map((t: any) => ({ ...t, id: entityId(t) ?? '' })) : []);
    } catch (err: any) {
      toast('Failed to load menu data', { description: err?.message || 'Server unreachable', variant: 'error' });
      // Ensure partial loads never leave stale state
      setItems([]);
      setCategories([]);
      setModifiers([]);
      setTaxes([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, [branch?.id]);

  const filtered = useMemo(() => {
    let list = items;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((i) => i.name.toLowerCase().includes(q));
    }
    if (categoryFilter) list = list.filter((i) => i.categoryId === categoryFilter);
    if (statusFilter) list = list.filter((i) => i.status === statusFilter);
    return list;
  }, [items, search, categoryFilter, statusFilter]);

  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name || '—';

  const openCreate = () => {
    setEditing(false);
    setForm({ ...EMPTY_FORM, price: '' });
    setDrawerOpen(true);
  };
  const openEdit = (item: MenuItem) => {
    setEditing(true);
    setForm({
      id: item.id,
      name: item.name,
      categoryId: item.categoryId,
      price: String(item.price / 100),
      description: item.description || '',
      imageUrl: item.imageUrl || '',
      status: item.status,
      modifierIds: item.modifierIds || [],
      taxIds: item.taxIds || [],
      isTaxable: item.isTaxable,
      scheduleStart: '',
      scheduleEnd: '',
    });
    setDrawerOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast('Name required', { variant: 'warning' }); return; }
    if (!form.categoryId) { toast('Category required', { variant: 'warning' }); return; }
    if (!form.price || Number(form.price) <= 0) { toast('Valid price required', { variant: 'warning' }); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        price: Math.round(Number(form.price) * 100),
      };
      if (editing) {
        const editId = entityId(form) ?? form.id;
        if (!editId) { toast('Cannot save: item has no ID', { variant: 'error' }); return; }
        await apiPatch(`/menu/items/${encodeURIComponent(editId)}`, payload);
        toast('Item updated', { variant: 'success' });
      } else {
        await apiPost('/menu/items', payload);
        toast('Item created', { variant: 'success' });
      }
      setDrawerOpen(false);
      fetchAll();
    } catch (err: any) {
      toast('Save failed', { description: err?.message || 'Server error', variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleMarkOOS = async (item: MenuItem) => {
    const id = entityId(item) ?? item.id;
    if (!id) { toast('Cannot update: item has no ID', { variant: 'error' }); return; }
    try {
      await apiPatch(`/menu/items/${encodeURIComponent(id)}`, { status: item.status === 'OUT_OF_STOCK' ? 'AVAILABLE' : 'OUT_OF_STOCK' });
      toast(`Marked ${item.status === 'OUT_OF_STOCK' ? 'Available' : 'Out of Stock'}`, { variant: 'success' });
      fetchAll();
    } catch (err: any) {
      toast('Update failed', { description: err?.message || 'Server error', variant: 'error' });
    }
  };

  const handleEnable = async (item: MenuItem) => {
    const id = entityId(item) ?? item.id;
    if (!id) { toast('Cannot enable: item has no ID', { variant: 'error' }); return; }
    setToggleStatusLoadingId(id);
    try {
      await apiPatch(`/menu/items/${encodeURIComponent(id)}`, { status: 'AVAILABLE' });
      toast('Item enabled', { variant: 'success' });
      fetchAll();
    } catch (err: any) {
      toast('Enable failed', { description: err?.message || 'Server error', variant: 'error' });
    } finally {
      setToggleStatusLoadingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteItem) return;
    const id = entityId(deleteItem) ?? deleteItem.id;
    if (!id) { toast('Cannot disable: item has no ID', { variant: 'error' }); return; }
    setDeleteLoading(true);
    try {
      await apiDelete(`/menu/items/${encodeURIComponent(id)}`);
      toast('Item disabled', { variant: 'success' });
      setDeleteItem(null);
      fetchAll();
    } catch (err: any) {
      toast('Disable failed', { description: err?.message || 'Server error', variant: 'error' });
    } finally {
      setDeleteLoading(false);
    }
  };

  const columns: Column<MenuItem>[] = [
    {
      key: 'item',
      title: 'Item',
      render: (r) => (
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 border border-slate-200 flex items-center justify-center text-slate-400 shrink-0 overflow-hidden">
            {r.imageUrl ? (
              <img src={r.imageUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                <path d="M12 2a10 10 0 0110 10c0 5-3 7-10 7S2 17 2 12A10 10 0 0112 2z" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M2 12h20M12 2v20" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-slate-900 truncate">{r.name}</div>
            <div className="text-[11px] text-slate-400">{formatDateTime(r.updatedAt)}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'category',
      title: 'Category',
      render: (r) => <span className="text-slate-700">{categoryName(r.categoryId)}</span>,
    },
    {
      key: 'price',
      title: 'Price',
      className: 'tabular-nums font-semibold text-slate-900 text-right',
      render: (r) => formatNGN(r.price),
    },
    {
      key: 'status',
      title: 'Status',
      render: (r) => {
        const s = STATUS_MAP[r.status] || STATUS_MAP.AVAILABLE;
        return <Badge variant={s.variant} dot>{s.label}</Badge>;
      },
    },
    {
      key: 'actions',
      title: '',
      className: 'text-right w-[220px]',
      render: (r) => (
        <div className="flex items-center justify-end gap-1.5">
          <Button
            variant="outline"
            size="sm"
            disabled={r.status === 'DISABLED'}
            onClick={(e) => { e.stopPropagation(); handleMarkOOS(r); }}
          >
            {r.status === 'OUT_OF_STOCK' ? 'In Stock' : 'Mark OOS'}
          </Button>
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openEdit(r); }}>
            Edit
          </Button>
          {r.status === 'DISABLED' ? (
            <Button
              variant="success"
              size="sm"
              loading={toggleStatusLoadingId === (r.id || entityId(r))}
              onClick={(e) => { e.stopPropagation(); handleEnable(r); }}
            >
              Enable
            </Button>
          ) : (
            <Button variant="danger" size="sm" onClick={(e) => { e.stopPropagation(); setDeleteItem(r); }}>
              Disable
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
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">Menu Items</h1>
          <p className="text-sm text-slate-500 mt-1">{formatNumber(filtered.length)} items across {categories.length} categories</p>
        </div>
        <Button onClick={openCreate}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New Item
        </Button>
      </div>

      <Card>
        <div className="px-5 py-4 border-b border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Input
            placeholder="Search items..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            prefix={
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
            }
          />
          <Select
            options={[{ value: '', label: 'All Categories' }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          />
          <Select
            options={STATUS_OPTIONS}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          />
          <Button variant="outline" onClick={fetchAll}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <path d="M23 4v6h-6M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
            Refresh
          </Button>
        </div>
        <DataTable
          columns={columns}
          data={filtered}
          rowKey={(r) => r.id}
          loading={loading}
          emptyText="No items found"
          onRowClick={openEdit}
        />
      </Card>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        size="md"
        title={editing ? 'Edit Menu Item' : 'New Menu Item'}
        description={editing ? 'Update item details and availability' : 'Create a new menu item'}
        footer={
          <div className="flex items-center justify-end gap-3 w-full">
            <Button variant="outline" onClick={() => setDrawerOpen(false)}>Cancel</Button>
            <Button loading={saving} onClick={handleSave}>
              {editing ? 'Save Changes' : 'Create Item'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input
            label="Name"
            placeholder="e.g. Jollof Rice & Chicken"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Category"
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              placeholder="Select category"
            />
            <Input
              label="Price (NGN)"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
            />
          </div>
          <Textarea
            label="Description"
            rows={3}
            placeholder="Short dish description for customers"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <Input
            label="Image URL"
            placeholder="https://..."
            value={form.imageUrl}
            onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
          />
          <Select
            label="Availability Status"
            options={STATUS_OPTIONS.filter((o) => o.value !== '')}
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as MenuItemStatus })}
          />

          <div>
            <div className="text-sm font-semibold text-slate-900 mb-2">Modifiers</div>
            <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 max-h-48 overflow-y-auto scrollbar-thin">
              {modifiers.length === 0 ? (
                <div className="p-4 text-sm text-slate-500 text-center">No modifiers found</div>
              ) : modifiers.map((m) => (
                <label key={m.id} className="flex items-center gap-3 p-3 hover:bg-slate-50 cursor-pointer transition">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                    checked={form.modifierIds.includes(m.id)}
                    onChange={(e) => {
                      const set = new Set(form.modifierIds);
                      if (e.target.checked) set.add(m.id); else set.delete(m.id);
                      setForm({ ...form, modifierIds: [...set] });
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-900">{m.name}</div>
                    <div className="text-[11px] text-slate-500">{m.multiSelect ? 'Multi-select' : 'Single select'} · {m.options.length} options{m.required ? ' · Required' : ''}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="text-sm font-semibold text-slate-900 mb-2">Taxes</div>
            <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 max-h-40 overflow-y-auto scrollbar-thin">
              {taxes.length === 0 ? (
                <div className="p-4 text-sm text-slate-500 text-center">No taxes configured</div>
              ) : taxes.map((t) => (
                <label key={t.id} className="flex items-center gap-3 p-3 hover:bg-slate-50 cursor-pointer transition">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                    checked={form.taxIds.includes(t.id)}
                    onChange={(e) => {
                      const set = new Set(form.taxIds);
                      if (e.target.checked) set.add(t.id); else set.delete(t.id);
                      setForm({ ...form, taxIds: [...set] });
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-900">{t.name}</div>
                    <div className="text-[11px] text-slate-500">{t.rate}% rate</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="rounded-xl bg-slate-50 border border-slate-100 p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Scheduled Availability</div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Start" type="datetime-local" value={form.scheduleStart} onChange={(e) => setForm({ ...form, scheduleStart: e.target.value })} />
              <Input label="End" type="datetime-local" value={form.scheduleEnd} onChange={(e) => setForm({ ...form, scheduleEnd: e.target.value })} />
            </div>
          </div>
        </div>
      </Drawer>

      <ConfirmDialog
        open={!!deleteItem}
        onClose={() => setDeleteItem(null)}
        onConfirm={handleDelete}
        title="Disable Menu Item"
        description={
          deleteItem
            ? `Disable "${deleteItem.name}"? It will stop showing on the Website and POS. You can re-enable it later by setting its status back to Available.`
            : ''
        }
        confirmText="Disable Item"
        loading={deleteLoading}
      />
    </div>
  );
}
