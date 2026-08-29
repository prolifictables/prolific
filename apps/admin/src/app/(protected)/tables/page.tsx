'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/Modal';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { formatNGN, formatDateTime, formatNumber } from '@/lib/format';
import { cn } from '@/lib/cn';
import { toast } from '@/components/ui/Toast';
import type { QRCode, Table as TableType, TableSession, TableSessionStatus } from '@prolific/shared-types';

type TableStatus = 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'DIRTY';

const STATUS_MAP: Record<TableStatus, { variant: any; label: string; ring: string; bg: string }> = {
  AVAILABLE: { variant: 'success', label: 'Available', ring: 'ring-emerald-500/20', bg: 'bg-emerald-50 border-emerald-200' },
  OCCUPIED: { variant: 'brand', label: 'Occupied', ring: 'ring-brand-500/20', bg: 'bg-brand-50 border-brand-200' },
  RESERVED: { variant: 'accent', label: 'Reserved', ring: 'ring-accent-500/20', bg: 'bg-accent-50 border-accent-200' },
  DIRTY: { variant: 'warning', label: 'Dirty', ring: 'ring-amber-500/20', bg: 'bg-amber-50 border-amber-200' },
};

const STATUS_OPTIONS = [
  { value: 'ALL', label: 'All Statuses' },
  { value: 'AVAILABLE', label: 'Available' },
  { value: 'OCCUPIED', label: 'Occupied' },
  { value: 'RESERVED', label: 'Reserved' },
  { value: 'DIRTY', label: 'Dirty' },
];

const DEFAULT_ZONES = [
  { value: '', label: 'All Zones' },
  { value: 'Main Floor', label: 'Main Floor' },
  { value: 'Bar', label: 'Bar' },
  { value: 'VIP', label: 'VIP' },
  { value: 'Outdoor', label: 'Outdoor' },
  { value: 'Private', label: 'Private Room' },
];

interface FormState {
  id?: string;
  name: string;
  capacity: number;
  zone: string;
  floor: string;
  isActive: boolean;
}

const EMPTY: FormState = { name: '', capacity: 4, zone: 'Main Floor', floor: '1', isActive: true };

export default function TablesPage() {
  const router = useRouter();
  const { branch } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [tables, setTables] = useState<(TableType & { _status?: TableStatus; _session?: TableSession | null; _qr?: QRCode | null })[]>([]);
  const [zones, setZones] = useState(DEFAULT_ZONES);
  const [zoneFilter, setZoneFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [search, setSearch] = useState('');

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [del, setDel] = useState<TableType | null>(null);
  const [delLoading, setDelLoading] = useState(false);
  const [regeneratingQrId, setRegeneratingQrId] = useState<string | null>(null);
  const [qrDownloadLoadingId, setQrDownloadLoadingId] = useState<string | null>(null);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [tablesRes, sessionsRes, zonesRes, qrsRes]: any = await Promise.all([
        apiGet('/tables'),
        apiGet('/table-sessions?status=OPEN,AWAITING_PAYMENT,PARTIALLY_PAID'),
        apiGet('/tables/zones'),
        apiGet('/qr-codes').catch(() => ({ data: [] })),
      ]);

      const rawTables = Array.isArray(tablesRes) ? tablesRes : (tablesRes?.data ?? []);
      const sessions = Array.isArray(sessionsRes) ? sessionsRes : (sessionsRes?.data ?? sessionsRes ?? []);
      const qrs = Array.isArray(qrsRes) ? qrsRes : (qrsRes?.data ?? qrsRes ?? []);

      const activeSessionByTableId = new Map<string, any>();
      (sessions as any[]).forEach((s) => {
        const tid = String(s.tableId || '');
        if (!tid) return;
        if (!activeSessionByTableId.has(tid)) activeSessionByTableId.set(tid, s);
      });

      const defaultQrByTableId = new Map<string, any>();
      (qrs as any[]).forEach((q) => {
        const tid = String(q.tableId || '');
        if (!tid) return;
        const isActive = q.isActive === true;
        const isDefault = q.isDefault === true || q.isDefault === undefined;
        if (!isActive) return;
        if (!defaultQrByTableId.has(tid) || isDefault) defaultQrByTableId.set(tid, q);
      });
      const activeTableIds = new Set(
        (sessions as any[])
          .map((s) => String(s.tableId || ''))
          .filter(Boolean)
          .filter(Boolean)
      );

      const nextZones = Array.isArray(zonesRes) ? zonesRes : (zonesRes?.data ?? []);
      if (nextZones.length > 0) {
        setZones([{ value: '', label: 'All Zones' }, ...nextZones.map((z: string) => ({ value: z, label: z }))]);
      } else {
        setZones(DEFAULT_ZONES);
      }

      setTables(
        rawTables.map((t: any) => {
          const id = String(t.id || t._id || '');
          return {
            ...t,
            id,
            _status: activeTableIds.has(id) ? 'OCCUPIED' : 'AVAILABLE',
            _session: activeSessionByTableId.get(id) ?? null,
            _qr: defaultQrByTableId.get(id) ?? null,
          };
        })
      );
    } catch (err: any) {
      toast(err.message, { variant: 'error' });
      setTables([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    let t: any = null;
    const run = async () => {
      await fetchAll();
      if (cancelled) return;
      t = setInterval(() => { void fetchAll(); }, 15000);
    };
    void run();
    return () => {
      cancelled = true;
      if (t) clearInterval(t);
    };
  }, [branch?.id]);

  const filtered = tables.filter((t) => {
    if (zoneFilter && t.zone !== zoneFilter) return false;
    if (statusFilter !== 'ALL' && (t as any)._status !== statusFilter) return false;
    if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (!t.isActive) return false;
    return true;
  });

  const counts = {
    total: tables.filter((t) => t.isActive).length,
    available: tables.filter((t) => (t as any)._status === 'AVAILABLE' && t.isActive).length,
    occupied: tables.filter((t) => (t as any)._status === 'OCCUPIED' && t.isActive).length,
    dirty: tables.filter((t) => (t as any)._status === 'DIRTY' && t.isActive).length,
  };

  const openCreate = () => {
    setEditing(false);
    setForm({ ...EMPTY, name: `Table ${tables.length + 1}` });
    setDrawerOpen(true);
  };

  const openEdit = (t: TableType) => {
    setEditing(true);
    setForm({
      id: String((t as any).id || (t as any)._id || ''),
      name: t.name,
      capacity: t.capacity,
      zone: t.zone || 'Main Floor',
      floor: t.floor || '1',
      isActive: t.isActive,
    });
    setDrawerOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) { toast('Name required', { variant: 'warning' }); return; }
    if (!form.capacity || form.capacity < 1) { toast('Capacity required', { variant: 'warning' }); return; }
    setSaving(true);
    try {
      if (editing && form.id) {
        await apiPatch(`/tables/${form.id}`, form);
        toast('Table updated', { variant: 'success' });
      } else {
        await apiPost('/tables', form);
        toast('Table created', { variant: 'success' });
      }
      setDrawerOpen(false);
      fetchAll();
    } catch (err: any) {
      toast(err.message, { variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleDel = async () => {
    if (!del) return;
    setDelLoading(true);
    try {
      await apiDelete(`/tables/${encodeURIComponent(String((del as any).id || (del as any)._id || ''))}`);
      toast('Deleted', { variant: 'success' });
      setDel(null);
      fetchAll();
    } catch (err: any) {
      toast(err.message, { variant: 'error' });
    } finally {
      setDelLoading(false);
    }
  };

  const grouped = filtered.reduce((acc: Record<string, typeof filtered>, t) => {
    const z = t.zone || 'Unassigned';
    if (!acc[z]) acc[z] = [];
    acc[z].push(t);
    return acc;
  }, {});

  const selected = useMemo(() => {
    if (!selectedId) return null;
    return tables.find((t) => String(t.id) === String(selectedId)) ?? null;
  }, [selectedId, tables]);

  const sessionTone = (status?: TableSessionStatus | string | null) => {
    const s = String(status || '').toUpperCase();
    if (s === 'AWAITING_PAYMENT' || s === 'PARTIALLY_PAID') return { variant: 'warning', label: 'Awaiting Payment' };
    if (s === 'OPEN') return { variant: 'brand', label: 'Open' };
    return { variant: 'soft', label: s ? s.replace(/_/g, ' ') : '—' };
  };

  const handleRegenerateQr = async (tableId: string) => {
    setRegeneratingQrId(tableId);
    try {
      await apiPost(`/qr-codes/tables/${encodeURIComponent(tableId)}/regenerate`, {});
      toast('QR regenerated', { variant: 'success' });
      await fetchAll();
    } catch (err: any) {
      toast('Failed to regenerate QR', { description: err?.message || 'Server error', variant: 'error' });
    } finally {
      setRegeneratingQrId(null);
    }
  };

  const handleDownloadQr = async (tableId: string) => {
    setQrDownloadLoadingId(tableId);
    try {
      const res: any = await apiGet(`/qr-codes/pdf?tableIds=${encodeURIComponent(tableId)}`);
      const packs = res?.data?.qrPacks ?? res?.qrPacks ?? [];
      const pack = Array.isArray(packs) ? packs[0] : null;
      const url = pack?.downloadUrl ? String(pack.downloadUrl) : '';
      if (!url) {
        toast('QR not available', { variant: 'warning' });
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
      toast('Failed to download QR', { description: err?.message || 'Server error', variant: 'error' });
    } finally {
      setQrDownloadLoadingId(null);
    }
  };

  const viewOrdersForTable = (tableId: string) => {
    router.push(`/orders?tableId=${encodeURIComponent(tableId)}`);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">Tables & Floor Plan</h1>
          <p className="text-sm text-slate-500 mt-1">
            {formatNumber(counts.total)} active tables · {formatNumber(counts.available)} available · {formatNumber(counts.occupied)} occupied · {formatNumber(counts.dirty)} need cleaning
          </p>
        </div>
        <Button onClick={openCreate}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add Table
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="!border-emerald-200 !bg-emerald-50/50">
          <div className="p-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-600">Available</div>
              <div className="mt-1 text-2xl font-bold text-emerald-700 tabular-nums">{counts.available}</div>
            </div>
            <div className="h-11 w-11 rounded-xl bg-emerald-100 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5 text-emerald-600"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
          </div>
        </Card>
        <Card className="!border-brand-200 !bg-brand-50/50">
          <div className="p-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-brand-600">Occupied</div>
              <div className="mt-1 text-2xl font-bold text-brand-700 tabular-nums">{counts.occupied}</div>
            </div>
            <div className="h-11 w-11 rounded-xl bg-brand-100 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5 text-brand-600"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
          </div>
        </Card>
        <Card className="!border-amber-200 !bg-amber-50/50">
          <div className="p-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-amber-600">Dirty</div>
              <div className="mt-1 text-2xl font-bold text-amber-700 tabular-nums">{counts.dirty}</div>
            </div>
            <div className="h-11 w-11 rounded-xl bg-amber-100 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5 text-amber-600"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
          </div>
        </Card>
        <Card className="!border-slate-200 !bg-slate-50/50">
          <div className="p-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Total Active</div>
              <div className="mt-1 text-2xl font-bold text-slate-800 tabular-nums">{counts.total}</div>
            </div>
            <div className="h-11 w-11 rounded-xl bg-slate-200 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5 text-slate-600"><rect x="3" y="6" width="18" height="10" rx="2" /><path d="M8 16v4M16 16v4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <div className="px-5 py-4 border-b border-slate-100 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Input
            placeholder="Search tables..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            prefix={
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" strokeLinecap="round" strokeLinejoin="round" /></svg>
            }
          />
          <Select options={zones} value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)} />
          <Select options={STATUS_OPTIONS} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} />
        </div>

        <div className="p-5 space-y-6">
          {loading ? (
            <div className="flex flex-col items-center gap-3 py-16">
              <svg className="animate-spin h-8 w-8 text-brand-600" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                <path fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" className="opacity-75" />
              </svg>
              <span className="text-sm text-slate-500">Loading tables...</span>
            </div>
          ) : Object.keys(grouped).length === 0 ? (
            <div className="text-center py-16 text-slate-400 text-sm">No tables match your filters</div>
          ) : (
            Object.entries(grouped).map(([zone, ztables]) => (
              <div key={zone}>
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">{zone}</h3>
                  <span className="h-px flex-1 bg-slate-100" />
                  <span className="text-xs font-semibold text-slate-400">{ztables.length} tables</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                  {ztables.map((t) => {
                    const tid = String((t as any).id || (t as any)._id || '');
                    const s = (t as any)._status || 'AVAILABLE';
                    const sm = STATUS_MAP[s as TableStatus] || STATUS_MAP.AVAILABLE;
                    const session = (t as any)._session as TableSession | null;
                    const sessTone = sessionTone(session?.status);
                    return (
                      <button
                        key={tid}
                        onClick={() => setSelectedId(tid)}
                        className={cn(
                          'group relative rounded-2xl border-2 p-4 text-left transition-all hover:scale-[1.02] hover:shadow-md ring-2 ring-transparent hover:ring-opacity-50',
                          sm.bg,
                          sm.ring
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-black text-2xl sm:text-3xl text-slate-900 tracking-tight leading-none">
                            {t.name.replace(/^Table\s?|^Bar\s?|^VIP\s?/g, '')}
                          </div>
                          <Badge variant={sm.variant as any} className="text-[10px] !px-1.5 !py-0.5 shrink-0">
                            {sm.label}
                          </Badge>
                        </div>
                        <div className="mt-4 flex items-center gap-2 text-xs text-slate-600">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" />
                          </svg>
                          <span className="font-semibold">{t.capacity} person{t.capacity > 1 ? 's' : ''}</span>
                          <span className="text-slate-300">·</span>
                          <span className="text-slate-500">{t.zone || ''}</span>
                        </div>
                        {session && (
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <Badge variant={sessTone.variant as any} className="text-[10px] !px-1.5 !py-0.5">
                              {sessTone.label}
                            </Badge>
                            <div className="text-[11px] font-bold text-slate-700 tabular-nums">
                              {formatNGN(Number((session as any).balanceDue ?? (session as any).balanceDueCents ?? 0))}
                            </div>
                          </div>
                        )}
                        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-slate-400">
                            <circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />
                          </svg>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        size="sm"
        title={editing ? 'Edit Table' : 'Add New Table'}
        description={editing ? 'Update table label, zone, and capacity' : 'Register a new table or booth'}
        footer={
          <div className="flex items-center justify-between w-full">
            <div>
              {editing && form.id && (
                <Button
                  variant="danger"
                  onClick={() => {
                    setDrawerOpen(false);
                    setDel({ id: form.id, name: form.name } as any);
                  }}
                >
                  Delete
                </Button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={() => setDrawerOpen(false)}>Cancel</Button>
              <Button loading={saving} onClick={save}>{editing ? 'Save Changes' : 'Create Table'}</Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <Input label="Table Name / Label" placeholder="e.g. Table 7, Bar 2, VIP 1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Capacity" type="number" min="1" placeholder="4" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} />
            <Input label="Floor" placeholder="1" value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} />
          </div>
          <Select
            label="Zone"
            options={zones.filter((z) => z.value !== '')}
            value={form.zone}
            onChange={(e) => setForm({ ...form, zone: e.target.value })}
          />
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Status</label>
            <label className="flex items-center gap-2 h-[42px] px-4 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              <span className="text-sm text-slate-700">Active (visible to staff)</span>
            </label>
          </div>
        </div>
      </Drawer>

      <Drawer
        open={!!selected}
        onClose={() => setSelectedId(null)}
        size="sm"
        title={selected ? selected.name : 'Table'}
        description={selected ? `${selected.zone || 'Unassigned'} · ${selected.capacity} seats` : ''}
        footer={
          selected ? (
            <div className="flex items-center justify-between w-full">
              <div>
                <Button
                  variant="danger"
                  onClick={() => {
                    setSelectedId(null);
                    setDel({ id: selected.id, name: selected.name } as any);
                  }}
                >
                  Delete
                </Button>
              </div>
              <div className="flex items-center gap-3">
                <Button variant="outline" onClick={() => setSelectedId(null)}>Close</Button>
                <Button onClick={() => openEdit(selected)}>Edit</Button>
              </div>
            </div>
          ) : null
        }
      >
        {selected && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={() => viewOrdersForTable(selected.id)}
              >
                View Orders
              </Button>
              <Button
                variant="outline"
                loading={qrDownloadLoadingId === selected.id}
                onClick={() => handleDownloadQr(selected.id)}
              >
                Download QR
              </Button>
              <Button
                variant="success"
                loading={regeneratingQrId === selected.id}
                onClick={() => handleRegenerateQr(selected.id)}
              >
                Regenerate QR
              </Button>
              <Button
                variant="outline"
                onClick={fetchAll}
              >
                Refresh
              </Button>
            </div>

            <Card>
              <CardHeader padded>
                <CardTitle className="text-base">Live Session</CardTitle>
              </CardHeader>
              <div className="px-5 pb-5">
                {selected._session ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      {(() => {
                        const tone = sessionTone(selected._session?.status);
                        return <Badge variant={tone.variant as any} dot>{tone.label}</Badge>;
                      })()}
                      <div className="text-xs text-slate-500">
                        Opened {formatDateTime((selected._session as any).openedAt)}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Total</div>
                        <div className="mt-1 text-lg font-bold text-slate-900 tabular-nums">
                          {formatNGN(Number((selected._session as any).totalAmount ?? 0))}
                        </div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Balance Due</div>
                        <div className="mt-1 text-lg font-bold text-slate-900 tabular-nums">
                          {formatNGN(Number((selected._session as any).balanceDue ?? 0))}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-slate-500">No active session on this table.</div>
                )}
              </div>
            </Card>

            <Card>
              <CardHeader padded>
                <CardTitle className="text-base">QR Code</CardTitle>
              </CardHeader>
              <div className="px-5 pb-5 space-y-2">
                {selected._qr?.token ? (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-slate-900">Token</div>
                      <div className="font-mono text-sm font-bold text-slate-900">{selected._qr.token}</div>
                    </div>
                    <div className="text-xs text-slate-500">
                      Created {formatDateTime((selected._qr as any).createdAt)}
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-slate-500">
                    QR metadata is not available for your role, or a QR hasn’t been generated yet.
                  </div>
                )}
              </div>
            </Card>
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={!!del}
        onClose={() => setDel(null)}
        onConfirm={handleDel}
        title="Delete Table"
        description={del ? `Delete "${del.name}"? Table session history will be retained.` : ''}
        confirmText="Delete"
        loading={delLoading}
      />
    </div>
  );
}
