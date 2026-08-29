'use client';

import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { DataTable, Column } from '@/components/ui/Table';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/Modal';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { formatNGN, formatNumber } from '@/lib/format';
import { toast } from '@/components/ui/Toast';
import type { MenuModifier, ModifierOption } from '@prolific/shared-types';

type OptionForm = Omit<ModifierOption, 'id'> & { _id: string };

interface ModifierForm {
  id?: string;
  name: string;
  description: string;
  multiSelect: boolean;
  required: boolean;
  minSelections: number;
  maxSelections: number;
  options: OptionForm[];
}

const uid = () => Math.random().toString(36).slice(2, 10);

const EMPTY: ModifierForm = {
  name: '',
  description: '',
  multiSelect: false,
  required: false,
  minSelections: 0,
  maxSelections: 1,
  options: [{ _id: uid(), name: '', priceDelta: 0, isDefault: false }],
};

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
function normalizeRows(input: any): MenuModifier[] {
  const arr = Array.isArray(input) ? input : Array.isArray(input?.data) ? input.data : [];
  return arr.map((r: any) => ({
    ...r,
    id: entityId(r) ?? '',
    options: Array.isArray(r.options)
      ? r.options.map((o: any) => ({ ...o, id: entityId(o) ?? String(o.id ?? o._id ?? uid()) }))
      : [],
  }));
}

export default function ModifiersPage() {
  const { branch } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [mods, setMods] = useState<MenuModifier[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ModifierForm>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [del, setDel] = useState<MenuModifier | null>(null);
  const [delLoading, setDelLoading] = useState(false);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const res: any = await apiGet('/menu/modifiers');
      setMods(normalizeRows(res?.data ?? res));
    } catch (err: any) {
      toast('Failed to load modifiers', { description: err?.message || 'Server unreachable', variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, [branch?.id]);

  const openCreate = () => {
    setEditing(false);
    setForm({ ...EMPTY, options: [{ _id: uid(), name: '', priceDelta: 0, isDefault: false }] });
    setDrawerOpen(true);
  };

  const openEdit = (m: MenuModifier) => {
    setEditing(true);
    setForm({
      id: m.id,
      name: m.name,
      description: m.description || '',
      multiSelect: m.multiSelect,
      required: m.required,
      minSelections: m.minSelections,
      maxSelections: m.maxSelections,
      options: m.options.map((o) => ({ ...o, _id: o.id || uid() })),
    });
    setDrawerOpen(true);
  };

  const addOption = () => {
    setForm({
      ...form,
      options: [...form.options, { _id: uid(), name: '', priceDelta: 0, isDefault: false }],
    });
  };

  const removeOption = (_id: string) => {
    if (form.options.length <= 1) return;
    setForm({ ...form, options: form.options.filter((o) => o._id !== _id) });
  };

  const updateOption = (_id: string, patch: Partial<OptionForm>) => {
    setForm({
      ...form,
      options: form.options.map((o) => (o._id === _id ? { ...o, ...patch } : o)),
    });
  };

  const save = async () => {
    if (!form.name.trim()) { toast('Name required', { variant: 'warning' }); return; }
    const validOpts = form.options.filter((o) => o.name.trim());
    if (validOpts.length === 0) { toast('At least one option required', { variant: 'warning' }); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        options: validOpts.map(({ _id, ...rest }) => rest),
      };
      if (editing) {
        const id = entityId(form) ?? form.id;
        if (!id) { toast('Cannot save: modifier has no ID', { variant: 'error' }); return; }
        await apiPatch(`/menu/modifiers/${encodeURIComponent(id)}`, payload);
        toast('Modifier updated', { variant: 'success' });
      } else {
        await apiPost('/menu/modifiers', payload);
        toast('Modifier created', { variant: 'success' });
      }
      setDrawerOpen(false);
      fetchAll();
    } catch (err: any) {
      toast('Save failed', { description: err?.message || 'Server error', variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleDel = async () => {
    if (!del) return;
    const id = entityId(del) ?? del.id;
    if (!id) { toast('Cannot delete: modifier has no ID', { variant: 'error' }); return; }
    setDelLoading(true);
    try {
      await apiDelete(`/menu/modifiers/${encodeURIComponent(id)}`);
      toast('Deleted', { variant: 'success' });
      setDel(null);
      fetchAll();
    } catch (err: any) {
      toast('Delete failed', { description: err?.message || 'Server error', variant: 'error' });
    } finally {
      setDelLoading(false);
    }
  };

  const columns: Column<MenuModifier>[] = [
    {
      key: 'name',
      title: 'Modifier',
      render: (r) => (
        <div>
          <div className="font-semibold text-slate-900 flex items-center gap-2 flex-wrap">
            {r.name}
            {r.required && <Badge variant="danger" className="text-[10px] !px-1.5 !py-0.5">Required</Badge>}
          </div>
          {r.description && <div className="text-xs text-slate-500 mt-0.5 line-clamp-1 max-w-md">{r.description}</div>}
        </div>
      ),
    },
    {
      key: 'type',
      title: 'Type',
      render: (r) => (
        <Badge variant={r.multiSelect ? 'brand' : 'info'}>
          {r.multiSelect ? 'Multi-select' : 'Single'}
        </Badge>
      ),
    },
    {
      key: 'selections',
      title: 'Selections',
      className: 'tabular-nums text-slate-600',
      render: (r) => (
        <span>
          {r.minSelections === r.maxSelections ? r.maxSelections : `${r.minSelections}-${r.maxSelections}`}
        </span>
      ),
    },
    {
      key: 'options',
      title: 'Options',
      render: (r) => (
        <div className="flex flex-wrap gap-1 max-w-xs">
          {r.options.slice(0, 4).map((o, i) => (
            <Badge key={o.id || i} variant="soft" className="!text-[11px]">
              {o.name}
              {o.priceDelta > 0 && <span className="ml-1 opacity-75">+{formatNGN(o.priceDelta)}</span>}
            </Badge>
          ))}
          {r.options.length > 4 && (
            <Badge variant="outline" className="!text-[11px]">+{r.options.length - 4} more</Badge>
          )}
        </div>
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
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">Menu Modifiers</h1>
          <p className="text-sm text-slate-500 mt-1">{formatNumber(mods.length)} modifier groups · Customization options for items</p>
        </div>
        <Button onClick={openCreate}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New Modifier
        </Button>
      </div>

      <Card>
        <DataTable
          columns={columns}
          data={mods}
          rowKey={(r) => r.id}
          loading={loading}
          emptyText="No modifiers yet"
          onRowClick={openEdit}
        />
      </Card>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        size="lg"
        title={editing ? 'Edit Modifier' : 'New Modifier'}
        description="Define item customization options"
        footer={
          <div className="flex items-center justify-end gap-3 w-full">
            <Button variant="outline" onClick={() => setDrawerOpen(false)}>Cancel</Button>
            <Button loading={saving} onClick={save}>{editing ? 'Save' : 'Create'}</Button>
          </div>
        }
      >
        <div className="space-y-5">
          <Input label="Modifier Name" placeholder="e.g. Extra Protein" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Description (optional)" placeholder="Short note shown to customers" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Selection Mode</label>
              <div className="flex rounded-xl border border-slate-200 p-1 gap-1">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, multiSelect: false, maxSelections: Math.max(1, form.minSelections) })}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${!form.multiSelect ? 'bg-brand-600 text-white shadow-soft' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  Single
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, multiSelect: true })}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${form.multiSelect ? 'bg-brand-600 text-white shadow-soft' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  Multi-select
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Required</label>
              <div className="flex rounded-xl border border-slate-200 p-1 gap-1">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, required: false, minSelections: 0 })}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${!form.required ? 'bg-slate-100 text-slate-800' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  Optional
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, required: true, minSelections: 1 })}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${form.required ? 'bg-red-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  Required
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Min Selections"
              type="number"
              min="0"
              value={form.minSelections}
              onChange={(e) => setForm({ ...form, minSelections: Math.max(0, Number(e.target.value)) })}
            />
            <Input
              label="Max Selections"
              type="number"
              min="1"
              value={form.maxSelections}
              onChange={(e) => setForm({ ...form, maxSelections: Math.max(1, Number(e.target.value)) })}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold text-slate-900">
                Options <span className="text-slate-400 font-normal">({form.options.length})</span>
              </div>
              <Button variant="outline" size="sm" onClick={addOption}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add Option
              </Button>
            </div>
            <div className="space-y-2">
              {form.options.map((o, idx) => (
                <div key={o._id} className="flex items-end gap-2 p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <div className="h-9 w-9 shrink-0 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-xs font-bold text-slate-500">
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <Input
                      label=""
                      placeholder="Option name"
                      value={o.name}
                      onChange={(e) => updateOption(o._id, { name: e.target.value })}
                    />
                  </div>
                  <div className="w-[140px] shrink-0">
                    <Input
                      label=""
                      type="number"
                      inputMode="decimal"
                      placeholder="+ Price (NGN)"
                      value={o.priceDelta / 100}
                      onChange={(e) => updateOption(o._id, { priceDelta: Math.round(Number(e.target.value || 0) * 100) })}
                      prefix={<span className="text-xs text-slate-400">₦</span>}
                    />
                  </div>
                  <label className="flex flex-col items-center gap-1 px-1 pb-3 shrink-0">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Default</span>
                    <input
                      type={form.multiSelect ? 'checkbox' : 'radio'}
                      name={`def-${form.id || 'new'}`}
                      checked={o.isDefault}
                      onChange={(e) => {
                        if (form.multiSelect) {
                          updateOption(o._id, { isDefault: e.target.checked });
                        } else {
                          setForm({
                            ...form,
                            options: form.options.map((x) => ({ ...x, isDefault: x._id === o._id })),
                          });
                        }
                      }}
                      className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => removeOption(o._id)}
                    disabled={form.options.length <= 1}
                    className="h-9 w-9 shrink-0 rounded-lg text-slate-400 hover:bg-white hover:text-red-600 transition disabled:opacity-30 disabled:hover:text-slate-400 disabled:hover:bg-transparent flex items-center justify-center mb-1.5"
                    title="Remove"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                      <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Drawer>

      <ConfirmDialog
        open={!!del}
        onClose={() => setDel(null)}
        onConfirm={handleDel}
        title="Delete Modifier"
        description={del ? `Delete "${del.name}"? Items using this modifier will no longer show these options.` : ''}
        confirmText="Delete"
        loading={delLoading}
      />
    </div>
  );
}
