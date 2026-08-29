'use client';

import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { DataTable, Column } from '@/components/ui/Table';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/Modal';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { formatNumber } from '@/lib/format';
import { toast } from '@/components/ui/Toast';
import type { MenuCategory } from '@prolific/shared-types';

interface FormState {
  id?: string;
  name: string;
  description: string;
  sortOrder: number;
  isActive: boolean;
  imageUrl: string;
}

const EMPTY: FormState = { name: '', description: '', sortOrder: 1, isActive: true, imageUrl: '' };

// Helper: reliably extract the MongoDB ObjectId as a plain string from a row,
// whether it's a raw Mongoose doc (ObjectId on _id) or a shared-types virtualized object.
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
function normalizeRows(input: any): MenuCategory[] {
  const arr = Array.isArray(input) ? input : Array.isArray(input?.data) ? input.data : [];
  return arr.map((r: any) => ({
    ...r,
    id: entityId(r) ?? '',
    restaurantId: String(r.restaurantId ?? r.restaurant_id ?? ''),
    branchId: String(r.branchId ?? r.branch_id ?? ''),
  }));
}

export default function CategoriesPage() {
  const { branch } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [cats, setCats] = useState<MenuCategory[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [del, setDel] = useState<MenuCategory | null>(null);
  const [delLoading, setDelLoading] = useState(false);

  const fetchCats = async () => {
    setLoading(true);
    try {
      const res: any = await apiGet('/menu/categories?sort=sortOrder');
      setCats(normalizeRows(res?.data ?? res));
    } catch (err: any) {
      toast('Failed to load categories', { description: err?.message || 'Server unreachable', variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCats(); }, [branch?.id]);

  const openCreate = () => {
    setEditing(false);
    setForm({ ...EMPTY, sortOrder: (cats?.length || 0) + 1 });
    setDrawerOpen(true);
  };
  const openEdit = (c: MenuCategory) => {
    setEditing(true);
    setForm({
      id: c.id,
      name: c.name,
      description: c.description || '',
      sortOrder: c.sortOrder,
      isActive: c.isActive,
      imageUrl: (c as any).imageUrl || '',
    });
    setDrawerOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) { toast('Name required', { variant: 'warning' }); return; }
    setSaving(true);
    try {
      if (editing) {
        const id = entityId(form) ?? form.id;
        if (!id) { toast('Cannot save: category has no ID', { variant: 'error' }); return; }
        await apiPatch(`/menu/categories/${encodeURIComponent(id)}`, form);
        toast('Category updated', { variant: 'success' });
      } else {
        await apiPost('/menu/categories', form);
        toast('Category created', { variant: 'success' });
      }
      setDrawerOpen(false);
      fetchCats();
    } catch (err: any) {
      toast('Save failed', { description: err?.message || 'Server error', variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const move = async (c: MenuCategory, dir: -1 | 1) => {
    const cId = entityId(c) ?? c.id;
    const idx = cats.findIndex((x) => (entityId(x) ?? x.id) === cId);
    const swap = cats[idx + dir];
    if (!swap || !cId) return;
    const swapId = entityId(swap) ?? swap.id;
    if (!swapId) { toast('Cannot reorder: missing ID on neighbor row', { variant: 'error' }); return; }
    try {
      await apiPatch(`/menu/categories/${encodeURIComponent(cId)}`, { sortOrder: swap.sortOrder });
      await apiPatch(`/menu/categories/${encodeURIComponent(swapId)}`, { sortOrder: c.sortOrder });
      fetchCats();
    } catch (err: any) {
      toast('Reorder failed', { description: err?.message || 'Server error', variant: 'error' });
      fetchCats();
    }
  };

  const handleDel = async () => {
    if (!del) return;
    const id = entityId(del) ?? del.id;
    if (!id) { toast('Cannot delete: category has no ID', { variant: 'error' }); return; }
    setDelLoading(true);
    try {
      await apiDelete(`/menu/categories/${encodeURIComponent(id)}`);
      toast('Deleted', { variant: 'success' });
      setDel(null);
      fetchCats();
    } catch (err: any) {
      toast('Delete failed', { description: err?.message || 'Server error', variant: 'error' });
    } finally {
      setDelLoading(false);
    }
  };

  const sorted = [...cats].sort((a, b) => a.sortOrder - b.sortOrder);

  const columns: Column<MenuCategory>[] = [
    {
      key: 'sort',
      title: '',
      className: 'w-[80px]',
      render: (r) => {
        const idx = sorted.findIndex((s) => s.id === r.id);
        return (
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); move(r, -1); }}
              disabled={idx === 0}
              className="h-8 w-8 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-800 disabled:opacity-30 disabled:hover:bg-transparent flex items-center justify-center transition"
              title="Move up"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M18 15l-6-6-6 6" />
              </svg>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); move(r, 1); }}
              disabled={idx === sorted.length - 1}
              className="h-8 w-8 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-800 disabled:opacity-30 disabled:hover:bg-transparent flex items-center justify-center transition"
              title="Move down"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          </div>
        );
      },
    },
    {
      key: 'name',
      title: 'Name',
      render: (r) => (
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-brand-50 to-accent-50 border border-brand-100/60 flex items-center justify-center text-xs font-bold text-brand-700">
            {r.sortOrder}
          </div>
          <div>
            <div className="font-semibold text-slate-900">{r.name}</div>
            {r.description && <div className="text-xs text-slate-500 mt-0.5 line-clamp-1 max-w-sm">{r.description}</div>}
          </div>
        </div>
      ),
    },
    {
      key: 'items',
      title: 'Sort Order',
      className: 'tabular-nums text-slate-600',
      render: (r) => `#${r.sortOrder}`,
    },
    {
      key: 'active',
      title: 'Status',
      render: (r) => (
        r.isActive ? <Badge variant="success" dot>Active</Badge> : <Badge variant="soft" dot>Hidden</Badge>
      ),
    },
    {
      key: 'actions',
      title: '',
      className: 'text-right w-[180px]',
      render: (r) => (
        <div className="flex items-center justify-end gap-1.5">
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openEdit(r); }}>Edit</Button>
          <Button variant="danger" size="sm" onClick={(e) => { e.stopPropagation(); setDel(r); }}>Delete</Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">Menu Categories</h1>
          <p className="text-sm text-slate-500 mt-1">{formatNumber(sorted.length)} categories · Drag arrows to reorder</p>
        </div>
        <Button onClick={openCreate}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New Category
        </Button>
      </div>

      <Card>
        <DataTable
          columns={columns}
          data={sorted}
          rowKey={(r) => r.id}
          loading={loading}
          emptyText="No categories yet"
          onRowClick={openEdit}
        />
      </Card>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        size="sm"
        title={editing ? 'Edit Category' : 'New Category'}
        description="Organize menu items into logical groups"
        footer={
          <div className="flex items-center justify-end gap-3 w-full">
            <Button variant="outline" onClick={() => setDrawerOpen(false)}>Cancel</Button>
            <Button loading={saving} onClick={save}>{editing ? 'Save' : 'Create'}</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input label="Name" placeholder="e.g. Rice Dishes" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Textarea label="Description" rows={3} placeholder="Short summary" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Sort Order" type="number" min="1" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} />
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Visibility</label>
              <label className="flex items-center gap-2 h-[42px] px-4 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                />
                <span className="text-sm text-slate-700">Show on menu</span>
              </label>
            </div>
          </div>
          <Input label="Image URL (optional)" placeholder="https://..." value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} />
        </div>
      </Drawer>

      <ConfirmDialog
        open={!!del}
        onClose={() => setDel(null)}
        onConfirm={handleDel}
        title="Delete Category"
        description={del ? `Delete "${del.name}"? Items in this category will become uncategorized.` : ''}
        confirmText="Delete"
        loading={delLoading}
      />
    </div>
  );
}
