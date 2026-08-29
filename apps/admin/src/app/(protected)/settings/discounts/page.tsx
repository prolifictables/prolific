'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { DataTable, Column } from '@/components/ui/Table';
import { Drawer } from '@/components/ui/Drawer';
import { apiGet, apiPatch, apiPost } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { formatNGN, formatNumber } from '@/lib/format';
import { toast } from '@/components/ui/Toast';
import type { Discount } from '@prolific/shared-types';

interface FormState {
  id?: string;
  name: string;
  type: 'PERCENTAGE' | 'FIXED';
  value: number;
  maxAmount?: number;
  minOrderAmount?: number;
  isActive: boolean;
  requiresManagerApproval: boolean;
  approvalThreshold?: number;
}

const EMPTY: FormState = {
  name: '',
  type: 'PERCENTAGE',
  value: 10,
  maxAmount: undefined,
  minOrderAmount: undefined,
  isActive: true,
  requiresManagerApproval: false,
  approvalThreshold: undefined,
};

export default function DiscountsPage() {
  const { branch } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Discount[]>([]);
  const [q, setQ] = useState('');
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (activeFilter === 'ACTIVE') params.set('isActive', 'true');
      if (activeFilter === 'INACTIVE') params.set('isActive', 'false');
      const res: any = await apiGet(`/discounts?${params.toString()}`);
      const payload = Array.isArray(res) ? res : (res?.data ?? res);
      setRows((payload?.data ?? payload) as Discount[]);
    } catch (err: any) {
      toast('Failed to load discounts', { description: err.message, variant: 'error' });
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, [branch?.id, activeFilter]);

  useEffect(() => {
    const t = setTimeout(fetchAll, 250);
    return () => clearTimeout(t);
  }, [q]);

  const visible = useMemo(() => {
    if (!q) return rows;
    const needle = q.toLowerCase();
    return rows.filter((d) => d.name.toLowerCase().includes(needle));
  }, [rows, q]);

  const openCreate = () => {
    setEditing(false);
    setForm(EMPTY);
    setDrawerOpen(true);
  };

  const openEdit = (d: Discount) => {
    setEditing(true);
    setForm({
      id: d.id,
      name: d.name,
      type: d.type,
      value: d.value,
      maxAmount: d.maxAmount,
      minOrderAmount: d.minOrderAmount,
      isActive: d.isActive,
      requiresManagerApproval: d.requiresManagerApproval,
      approvalThreshold: d.approvalThreshold,
    });
    setDrawerOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast('Name required', { variant: 'warning' });
      return;
    }
    if (form.value < 0) {
      toast('Value must be >= 0', { variant: 'warning' });
      return;
    }
    if (form.type === 'PERCENTAGE' && form.value > 100) {
      toast('Percentage should be <= 100', { variant: 'warning' });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name,
        type: form.type,
        value: form.value,
        maxAmount: form.maxAmount,
        minOrderAmount: form.minOrderAmount,
        isActive: form.isActive,
        requiresManagerApproval: form.requiresManagerApproval,
        approvalThreshold: form.approvalThreshold,
      };

      if (editing && form.id) {
        await apiPatch(`/discounts/${form.id}`, payload);
        toast('Discount updated', { variant: 'success' });
      } else {
        await apiPost('/discounts', payload);
        toast('Discount created', { variant: 'success' });
      }
      setDrawerOpen(false);
      fetchAll();
    } catch (err: any) {
      toast('Save failed', { description: err.message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<Discount>[] = [
    {
      key: 'name',
      title: 'Discount / Happy Hour',
      render: (r) => (
        <div className="min-w-0">
          <div className="font-semibold text-slate-900 truncate">{r.name}</div>
          <div className="text-[11px] text-slate-500">
            {r.type === 'PERCENTAGE' ? `${r.value}% off` : `${formatNGN(r.value)} off`}
          </div>
        </div>
      ),
    },
    {
      key: 'limits',
      title: 'Rules',
      render: (r) => (
        <div className="text-xs text-slate-600 space-y-0.5">
          <div>
            Min order: <span className="font-semibold text-slate-800">{r.minOrderAmount ? formatNGN(r.minOrderAmount) : '—'}</span>
          </div>
          <div>
            Cap: <span className="font-semibold text-slate-800">{r.maxAmount ? formatNGN(r.maxAmount) : '—'}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'approval',
      title: 'Approval',
      render: (r) => (
        r.requiresManagerApproval ? (
          <Badge variant="warning" dot>Manager PIN</Badge>
        ) : (
          <Badge variant="soft" dot>No PIN</Badge>
        )
      ),
    },
    {
      key: 'status',
      title: 'Status',
      render: (r) => (
        r.isActive ? <Badge variant="success" dot>Active</Badge> : <Badge variant="soft" dot>Inactive</Badge>
      ),
    },
    {
      key: 'actions',
      title: '',
      className: 'text-right w-[120px]',
      render: (r) => (
        <div className="flex items-center justify-end">
          <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); openEdit(r); }}>
            Edit
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">Discounts & Happy Hour</h1>
          <p className="text-sm text-slate-500 mt-1">{formatNumber(visible.length)} rules · {branch?.name || 'All Branches'}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={fetchAll}>Refresh</Button>
          <Button onClick={openCreate}>Add Rule</Button>
        </div>
      </div>

      <Card>
        <div className="px-5 py-4 border-b border-slate-100 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Input placeholder="Search rules..." value={q} onChange={(e) => setQ(e.target.value)} />
          <Select
            options={[
              { value: 'ALL', label: 'All' },
              { value: 'ACTIVE', label: 'Active' },
              { value: 'INACTIVE', label: 'Inactive' },
            ]}
            value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value as any)}
          />
          <div className="text-sm text-slate-500 flex items-center">
            Use as “Happy Hour” by naming it and enabling it during your shift
          </div>
        </div>

        <DataTable
          columns={columns}
          data={visible}
          rowKey={(r) => r.id}
          loading={loading}
          emptyText="No discounts found"
          onRowClick={(r) => openEdit(r)}
        />
      </Card>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        size="sm"
        title={editing ? 'Edit Rule' : 'Add Rule'}
        description="Create a discount rule for promos, happy hour, comps, or staff meals"
        footer={
          <div className="flex items-center justify-end gap-3 w-full">
            <Button variant="outline" onClick={() => setDrawerOpen(false)}>Cancel</Button>
            <Button loading={saving} onClick={save}>{editing ? 'Save' : 'Create'}</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input label="Name" placeholder="e.g. Happy Hour (5–7pm) · Cocktails -20%" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Select
            label="Type"
            options={[
              { value: 'PERCENTAGE', label: 'Percentage Off' },
              { value: 'FIXED', label: 'Fixed Amount Off (cents)' },
            ]}
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as any })}
          />
          <Input
            label={form.type === 'PERCENTAGE' ? 'Percent' : 'Amount (cents)'}
            type="number"
            value={String(form.value)}
            onChange={(e) => setForm({ ...form, value: Number(e.target.value) })}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Min order (cents)"
              type="number"
              value={String(form.minOrderAmount ?? '')}
              onChange={(e) => setForm({ ...form, minOrderAmount: e.target.value === '' ? undefined : Number(e.target.value) })}
            />
            <Input
              label="Max discount cap (cents)"
              type="number"
              value={String(form.maxAmount ?? '')}
              onChange={(e) => setForm({ ...form, maxAmount: e.target.value === '' ? undefined : Number(e.target.value) })}
            />
          </div>
          <label className="flex items-center gap-2 h-[42px] px-4 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            <span className="text-sm text-slate-700">Active</span>
          </label>
          <label className="flex items-center gap-2 h-[42px] px-4 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              checked={form.requiresManagerApproval}
              onChange={(e) => setForm({ ...form, requiresManagerApproval: e.target.checked })}
            />
            <span className="text-sm text-slate-700">Require manager approval</span>
          </label>
          {form.requiresManagerApproval && (
            <Input
              label="Approval threshold (cents, optional)"
              type="number"
              value={String(form.approvalThreshold ?? '')}
              onChange={(e) => setForm({ ...form, approvalThreshold: e.target.value === '' ? undefined : Number(e.target.value) })}
            />
          )}
        </div>
      </Drawer>
    </div>
  );
}

