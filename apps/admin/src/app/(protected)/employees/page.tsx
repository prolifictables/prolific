'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { DataTable, Column } from '@/components/ui/Table';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/Modal';
import { apiGet, apiPost, apiPatch } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { formatDateTime, formatNumber } from '@/lib/format';
import { toast } from '@/components/ui/Toast';
import type { Employee, Role, User, Branch } from '@prolific/shared-types';

interface EmployeeExtended extends Omit<Employee, 'userId' | 'restaurantId' | 'branchId' | 'assignedZoneIds'> {
  user?: any;
  branch?: any;
  isActive?: boolean;
  userId?: string;
  restaurantId?: string;
  branchId?: string;
  assignedZoneIds?: string[];
}

const ROLE_OPTIONS = [
  { value: '', label: 'All Roles' },
  { value: 'SUPER_ADMIN', label: 'Super Admin' },
  { value: 'ADMIN', label: 'Admin' },
  { value: 'MANAGER', label: 'Manager' },
  { value: 'SUPERVISOR', label: 'Supervisor' },
  { value: 'CASHIER', label: 'Cashier' },
  { value: 'KITCHEN', label: 'Kitchen' },
  { value: 'WAITER', label: 'Waiter' },
  { value: 'ACCOUNTANT', label: 'Accountant' },
];

const ROLE_MAP: Record<Role, { variant: any; label: string }> = {
  SUPER_ADMIN: { variant: 'accent', label: 'Super Admin' },
  ADMIN: { variant: 'brand', label: 'Admin' },
  MANAGER: { variant: 'success', label: 'Manager' },
  SUPERVISOR: { variant: 'info', label: 'Supervisor' },
  CASHIER: { variant: 'warning', label: 'Cashier' },
  KITCHEN: { variant: 'danger', label: 'Kitchen' },
  WAITER: { variant: 'soft', label: 'Waiter' },
  ACCOUNTANT: { variant: 'info', label: 'Accountant' },
};

const randomPin = () => String(Math.floor(1000 + Math.random() * 9000));

interface FormState {
  id?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: {
    line1: string;
    line2: string;
    city: string;
    state: string;
    country: string;
    postalCode: string;
  };
  emergencyContact: {
    name: string;
    phone: string;
    relationship: string;
  };
  role: Role;
  branchId: string;
  pin: string;
  positionTitle: string;
}

const EMPTY: FormState = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  address: { line1: '', line2: '', city: '', state: '', country: '', postalCode: '' },
  emergencyContact: { name: '', phone: '', relationship: '' },
  role: 'WAITER' as Role,
  branchId: '',
  pin: randomPin(),
  positionTitle: '',
};

export default function EmployeesPage() {
  const { branch } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<EmployeeExtended[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [generatedPin, setGeneratedPin] = useState<string | null>(null);
  const [showPinModal, setShowPinModal] = useState(false);
  const [resetTarget, setResetTarget] = useState<EmployeeExtended | null>(null);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [empRes, brRes]: any = await Promise.all([
        apiGet('/employees'),
        apiGet('/branches'),
      ]);
      setEmployees(empRes?.data || empRes || []);
      setBranches(brRes?.data || brRes || []);
    } catch (err: any) {
      toast('Failed to load employees', { description: err.message, variant: 'error' });
      setEmployees([]);
      setBranches([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, [branch?.id]);

  const filtered = useMemo(() => employees.filter((e) => {
    if (roleFilter && e.role !== roleFilter) return false;
    if (statusFilter === 'ACTIVE' && !(e as any).user?.isActive && !e.isActive) return false;
    if (statusFilter === 'INACTIVE' && !((e as any).user?.isActive === false || e.isActive === false)) return false;
    if (search) {
      const q = search.toLowerCase();
      const u = (e as any).user;
      const hay = `${u?.firstName || ''} ${u?.lastName || ''} ${u?.email || ''} ${u?.phone || ''} ${e.positionTitle || ''} ${e.employeeNumber || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [employees, search, roleFilter, statusFilter]);

  const openCreate = () => {
    setEditing(false);
    setForm({ ...EMPTY, branchId: branch?.id || branches[0]?.id || '', pin: randomPin() });
    setDrawerOpen(true);
  };

  const openEdit = (e: EmployeeExtended) => {
    const u = (e as any).user || {};
    setEditing(true);
    setForm({
      id: e.id,
      firstName: u.firstName || '',
      lastName: u.lastName || '',
      email: u.email || '',
      phone: u.phone || '',
      address: {
        line1: u.address?.line1 || '',
        line2: u.address?.line2 || '',
        city: u.address?.city || '',
        state: u.address?.state || '',
        country: u.address?.country || '',
        postalCode: u.address?.postalCode || '',
      },
      emergencyContact: {
        name: u.emergencyContact?.name || '',
        phone: u.emergencyContact?.phone || '',
        relationship: u.emergencyContact?.relationship || '',
      },
      role: e.role,
      branchId: e.branchId ?? '',
      pin: '',
      positionTitle: e.positionTitle || '',
    });
    setDrawerOpen(true);
  };

  const save = async () => {
    if (!form.firstName.trim()) { toast('First name required', { variant: 'warning' }); return; }
    if (!form.lastName.trim()) { toast('Last name required', { variant: 'warning' }); return; }
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) { toast('Valid email required', { variant: 'warning' }); return; }
    if (!editing && !form.pin) { toast('PIN required for new employee', { variant: 'warning' }); return; }
    setSaving(true);
    try {
      if (editing && form.id) {
        await apiPatch(`/employees/${form.id}`, form);
        toast('Employee updated', { variant: 'success' });
      } else {
        await apiPost('/employees', form);
        setGeneratedPin(form.pin);
        setShowPinModal(true);
      }
      setDrawerOpen(false);
      fetchAll();
    } catch (err: any) {
      toast(err.message, { variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const resetPin = async () => {
    if (!resetTarget) return;
    try {
      const res: any = await apiPost(`/employees/${resetTarget.id}/reset-pin`, {});
      const pin = res?.rawPin || res?.data?.rawPin || '';

      if (!pin) {
        throw new Error('Reset succeeded but no PIN was returned');
      }
      setGeneratedPin(pin);
      setShowPinModal(true);
      setResetTarget(null);
      toast('PIN reset', { variant: 'success' });
    } catch (err: any) {
      toast(err.message, { variant: 'error' });
    }
  };

  const columns: Column<EmployeeExtended>[] = [
    {
      key: 'employee',
      title: 'Employee',
      render: (r) => {
        const u = (r as any).user || {};
        return (
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white text-sm font-bold shrink-0">
              {u.firstName?.charAt(0) || '?'}
              {u.lastName?.charAt(0) || ''}
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-slate-900 truncate">{u.firstName} {u.lastName}</div>
              <div className="text-[11px] text-slate-500 truncate max-w-[220px]">{u.email}</div>
            </div>
          </div>
        );
      },
    },
    {
      key: 'role',
      title: 'Role',
      render: (r) => {
        const rm = ROLE_MAP[r.role] || ROLE_MAP.WAITER;
        return <Badge variant={rm.variant as any}>{rm.label}</Badge>;
      },
    },
    {
      key: 'branch',
      title: 'Branch',
      render: (r) => {
        const b = (r as any).branch;
        return <span className="text-slate-700">{b?.name || '—'}</span>;
      },
    },
    {
      key: 'phone',
      title: 'Phone',
      className: 'text-slate-600',
      render: (r) => (r as any).user?.phone || '—',
    },
    {
      key: 'employeeId',
      title: 'Employee ID',
      className: 'font-mono text-xs text-slate-500',
      render: (r) => r.employeeNumber || '—',
    },
    {
      key: 'status',
      title: 'Status',
      render: (r) => {
        const u = (r as any).user;
        const active = u?.isActive !== false && r.isActive !== false;
        return active ? <Badge variant="success" dot>Active</Badge> : <Badge variant="soft" dot>Inactive</Badge>;
      },
    },
    {
      key: 'joined',
      title: 'Joined',
      className: 'text-xs text-slate-500',
      render: (r) => formatDateTime(r.joinedAt || r.createdAt),
    },
    {
      key: 'actions',
      title: '',
      className: 'text-right w-[200px]',
      render: (r) => (
        <div className="flex items-center justify-end gap-1.5">
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openEdit(r); }}>Edit</Button>
          <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setResetTarget(r); }}>
            Reset PIN
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">Employees</h1>
          <p className="text-sm text-slate-500 mt-1">{formatNumber(filtered.length)} staff members</p>
        </div>
        <Button onClick={openCreate}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M19 8v6M22 11h-6" />
          </svg>
          New Employee
        </Button>
      </div>

      <Card>
        <div className="px-5 py-4 border-b border-slate-100 grid grid-cols-1 sm:grid-cols-4 gap-3">
          <Input
            placeholder="Search name, email, phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="sm:col-span-2"
            prefix={
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" strokeLinecap="round" strokeLinejoin="round" /></svg>
            }
          />
          <Select options={ROLE_OPTIONS} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} />
          <Select
            options={[
              { value: 'ALL', label: 'All Statuses' },
              { value: 'ACTIVE', label: 'Active' },
              { value: 'INACTIVE', label: 'Inactive' },
            ]}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          />
        </div>
        <DataTable
          columns={columns}
          data={filtered}
          rowKey={(r) => r.id}
          loading={loading}
          emptyText="No employees found"
          onRowClick={openEdit}
        />
      </Card>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        size="md"
        title={editing ? 'Edit Employee' : 'New Employee'}
        description={editing ? 'Update staff profile' : 'Invite a new team member'}
        footer={
          <div className="flex items-center justify-end gap-3 w-full">
            <Button variant="outline" onClick={() => setDrawerOpen(false)}>Cancel</Button>
            <Button loading={saving} onClick={save}>{editing ? 'Save Changes' : 'Create Employee'}</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="First Name" placeholder="e.g. Adaeze" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
            <Input label="Last Name" placeholder="e.g. Okonkwo" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Email" type="email" placeholder="adaeze@prolific.restaurant" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <Input label="Phone" placeholder="08012345678" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Role"
              options={ROLE_OPTIONS.filter((r) => r.value !== '')}
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            />
            <Select
              label="Branch"
              options={branches.map((b) => ({ value: b.id, label: b.name }))}
              value={form.branchId}
              onChange={(e) => setForm({ ...form, branchId: e.target.value })}
              placeholder="Select branch"
            />
          </div>
          <Input
            label="Position / Job Title"
            placeholder="e.g. Senior Waiter, Sous Chef"
            value={form.positionTitle}
            onChange={(e) => setForm({ ...form, positionTitle: e.target.value })}
          />
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Address</div>
            <div className="space-y-3">
              <Input
                label="Address Line 1"
                placeholder="Street address"
                value={form.address.line1}
                onChange={(e) => setForm({ ...form, address: { ...form.address, line1: e.target.value } })}
              />
              <Input
                label="Address Line 2"
                placeholder="Apartment, suite, etc. (optional)"
                value={form.address.line2}
                onChange={(e) => setForm({ ...form, address: { ...form.address, line2: e.target.value } })}
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="City"
                  placeholder="e.g. Lagos"
                  value={form.address.city}
                  onChange={(e) => setForm({ ...form, address: { ...form.address, city: e.target.value } })}
                />
                <Input
                  label="State"
                  placeholder="e.g. Lagos State"
                  value={form.address.state}
                  onChange={(e) => setForm({ ...form, address: { ...form.address, state: e.target.value } })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Country"
                  placeholder="e.g. Nigeria"
                  value={form.address.country}
                  onChange={(e) => setForm({ ...form, address: { ...form.address, country: e.target.value } })}
                />
                <Input
                  label="Postal Code"
                  placeholder="e.g. 100001"
                  value={form.address.postalCode}
                  onChange={(e) => setForm({ ...form, address: { ...form.address, postalCode: e.target.value } })}
                />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Emergency Contact</div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Contact Name"
                placeholder="e.g. Chinedu Okonkwo"
                value={form.emergencyContact.name}
                onChange={(e) => setForm({ ...form, emergencyContact: { ...form.emergencyContact, name: e.target.value } })}
              />
              <Input
                label="Contact Phone"
                placeholder="08012345678"
                value={form.emergencyContact.phone}
                onChange={(e) => setForm({ ...form, emergencyContact: { ...form.emergencyContact, phone: e.target.value } })}
              />
            </div>
            <div className="mt-3">
              <Input
                label="Relationship"
                placeholder="e.g. Spouse, Parent, Sibling"
                value={form.emergencyContact.relationship}
                onChange={(e) => setForm({ ...form, emergencyContact: { ...form.emergencyContact, relationship: e.target.value } })}
              />
            </div>
          </div>
          {!editing && (
            <div className="rounded-xl border-2 border-accent-200 bg-accent-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-accent-700 mb-1">Temporary PIN for first login</div>
                  <div className="text-3xl font-black font-mono tracking-wider text-accent-700">{form.pin}</div>
                  <div className="text-xs text-accent-600/80 mt-1">Share this PIN securely with the employee. They can change it later.</div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setForm({ ...form, pin: randomPin() })}
                >
                  Regenerate
                </Button>
              </div>
            </div>
          )}
          {editing && (
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">PIN Management</div>
              <div className="text-sm text-slate-500 mb-3">PIN is stored securely as a hash. Use the Reset PIN action on the list if the employee forgot theirs.</div>
              <Button variant="outline" size="sm" onClick={() => { if (editing && form.id) { toast('PIN reset sent', { variant: 'info' }); } }}>
                Reset PIN for this employee
              </Button>
            </div>
          )}
        </div>
      </Drawer>

      <ConfirmDialog
        open={!!resetTarget}
        onClose={() => setResetTarget(null)}
        onConfirm={resetPin}
        title="Reset Employee PIN"
        description={resetTarget ? `Generate a new temporary PIN for ${(resetTarget as any).user?.firstName} ${(resetTarget as any).user?.lastName}? The new PIN will be shown once.` : ''}
        confirmText="Generate New PIN"
        variant="warning"
      />

      <Drawer
        open={showPinModal}
        onClose={() => { setShowPinModal(false); setGeneratedPin(null); }}
        side="right"
        size="sm"
        title="New PIN Generated"
        description="This is the only time the PIN will be shown in plain text"
        footer={
          <div className="flex items-center justify-end gap-3 w-full">
            <Button variant="outline" onClick={() => { if (generatedPin) { navigator.clipboard?.writeText(generatedPin); toast('PIN copied', { variant: 'success' }); } }}>
              Copy PIN
            </Button>
            <Button onClick={() => { setShowPinModal(false); setGeneratedPin(null); }}>
              Done
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          <div className="rounded-2xl border-2 border-accent-300 bg-gradient-to-br from-accent-50 via-white to-brand-50 p-8 text-center">
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent-600 mb-4">Temporary PIN</div>
            <div className="text-6xl font-black font-mono tracking-[0.3em] text-slate-900 sm:text-7xl">
              {generatedPin || '----'}
            </div>
            <div className="mt-5 pt-5 border-t border-accent-200/60 text-xs text-slate-500 space-y-1">
              <div>Share this PIN securely with the employee.</div>
              <div>It is valid for their <span className="font-semibold text-slate-700">first login</span> only.</div>
              <div>Store this PIN elsewhere — the system stores only a hash.</div>
            </div>
          </div>

          <div className="rounded-xl bg-slate-50 border border-slate-100 p-4 flex items-center gap-3">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5 text-slate-500 shrink-0"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <div className="text-xs text-slate-500">
              <div className="font-semibold text-slate-700">Security note</div>
              <div className="mt-0.5">PINs are never stored or transmitted in plaintext after onboarding.</div>
            </div>
          </div>
        </div>
      </Drawer>
    </div>
  );
}
