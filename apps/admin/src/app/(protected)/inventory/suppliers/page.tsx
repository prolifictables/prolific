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
import { formatNumber } from '@/lib/format';
import { toast } from '@/components/ui/Toast';
import type { Supplier } from '@prolific/shared-types';

type SupplierRow = Supplier & { contactName?: string };

interface FormState {
  id?: string;
  name: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  isActive: boolean;
}

const EMPTY: FormState = {
  name: '',
  contactName: '',
  phone: '',
  email: '',
  address: '',
  isActive: true,
};

export default function SuppliersPage() {
  const { branch } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<SupplierRow[]>([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (status === 'ACTIVE') params.set('isActive', 'true');
      if (status === 'INACTIVE') params.set('isActive', 'false');
      const res: any = await apiGet(`/suppliers?${params.toString()}`);
      const payload = Array.isArray(res) ? res : (res?.data ?? res);
      const list = (payload?.data ?? payload) as SupplierRow[];
      setRows(list);
    } catch (err: any) {
      toast('Failed to load suppliers', { description: err.message, variant: 'error' });
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, [branch?.id, status]);

  useEffect(() => {
    const t = setTimeout(fetchAll, 250);
    return () => clearTimeout(t);
  }, [q]);

  const visible = useMemo(() => {
    if (!q) return rows;
    const needle = q.toLowerCase();
    return rows.filter((s) => {
      return (
        s.name.toLowerCase().includes(needle) ||
        (s.email || '').toLowerCase().includes(needle) ||
        (s.phone || '').toLowerCase().includes(needle)
      );
    });
  }, [rows, q]);

  const openCreate = () => {
    setEditing(false);
    setForm(EMPTY);
    setDrawerOpen(true);
  };

  const openEdit = (r: SupplierRow) => {
    setEditing(true);
    setForm({
      id: r.id,
      name: r.name || '',
      contactName: (r as any).contactName || '',
      phone: r.phone || '',
      email: r.email || '',
      address: r.address || '',
      isActive: r.isActive !== false,
    });
    setDrawerOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast('Name required', { variant: 'warning' });
      return;
    }
    if (!form.phone.trim()) {
      toast('Phone required', { variant: 'warning' });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name,
        contactName: form.contactName || undefined,
        phone: form.phone,
        email: form.email || undefined,
        address: form.address || undefined,
        isActive: form.isActive,
      };
      if (editing && form.id) {
        await apiPatch(`/suppliers/${form.id}`, payload);
        toast('Supplier updated', { variant: 'success' });
      } else {
        await apiPost('/suppliers', payload);
        toast('Supplier created', { variant: 'success' });
      }
      setDrawerOpen(false);
      fetchAll();
    } catch (err: any) {
      toast('Save failed', { description: err.message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<SupplierRow>[] = [
    {
      key: 'name',
      title: 'Supplier',
      render: (r) => (
        <div className="min-w-0">
          <div className="font-semibold text-slate-900 truncate">{r.name}</div>
          <div className="text-[11px] text-slate-500 truncate">{r.email || r.phone}</div>
        </div>
      ),
    },
    {
      key: 'phone',
      title: 'Phone',
      className: 'text-slate-600',
      render: (r) => r.phone,
    },
    {
      key: 'status',
      title: 'Status',
      render: (r) =>
        r.isActive ? (
          <Badge variant="success" dot>Active</Badge>
        ) : (
          <Badge variant="soft" dot>Inactive</Badge>
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
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">Suppliers</h1>
          <p className="text-sm text-slate-500 mt-1">
            {formatNumber(visible.length)} suppliers · {branch?.name || 'All Branches'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={fetchAll}>Refresh</Button>
          <Button onClick={openCreate}>Add Supplier</Button>
        </div>
      </div>

      <Card>
        <div className="px-5 py-4 border-b border-slate-100 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Input placeholder="Search suppliers..." value={q} onChange={(e) => setQ(e.target.value)} />
          <Select
            options={[
              { value: 'ALL', label: 'All' },
              { value: 'ACTIVE', label: 'Active' },
              { value: 'INACTIVE', label: 'Inactive' },
            ]}
            value={status}
            onChange={(e) => setStatus(e.target.value as any)}
          />
          <div className="text-sm text-slate-500 flex items-center">
            Tip: set preferred supplier per inventory item
          </div>
        </div>
        <DataTable
          columns={columns}
          data={visible}
          rowKey={(r) => r.id}
          loading={loading}
          emptyText="No suppliers found"
          onRowClick={(r) => openEdit(r)}
        />
      </Card>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        size="sm"
        title={editing ? 'Edit Supplier' : 'Add Supplier'}
        description="Vendors for bar and kitchen restocking"
        footer={
          <div className="flex items-center justify-end gap-3 w-full">
            <Button variant="outline" onClick={() => setDrawerOpen(false)}>Cancel</Button>
            <Button loading={saving} onClick={save}>{editing ? 'Save' : 'Create'}</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input label="Supplier Name" placeholder="e.g. Guinness Nigeria PLC" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Contact Name" placeholder="Optional" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Phone" placeholder="e.g. 080..." value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <Input label="Email" placeholder="Optional" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <Input label="Address" placeholder="Optional" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <label className="flex items-center gap-2 h-[42px] px-4 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            <span className="text-sm text-slate-700">Active</span>
          </label>
        </div>
      </Drawer>
    </div>
  );
}

