'use client';

import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { DataTable, Column } from '@/components/ui/Table';
import { Modal } from '@/components/ui/Modal';
import { apiGet, apiPost } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { formatDateTime, formatNumber } from '@/lib/format';
import { toast } from '@/components/ui/Toast';
import { API_BASE_URL } from '@/lib/api-client';
import type { QRCode, Table as TableType } from '@prolific/shared-types';

interface QRExtended extends QRCode {
  table?: TableType;
}

const ZONES = [
  { value: '', label: 'All Zones' },
  { value: 'Main Floor', label: 'Main Floor' },
  { value: 'Bar', label: 'Bar' },
  { value: 'VIP', label: 'VIP' },
  { value: 'Outdoor', label: 'Outdoor' },
  { value: 'Private', label: 'Private Room' },
];

export default function QRCodesPage() {
  const { branch, accessToken } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [codes, setCodes] = useState<QRExtended[]>([]);
  const [tables, setTables] = useState<TableType[]>([]);
  const [zoneFilter, setZoneFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<QRExtended[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [qrRes, tablesRes]: any = await Promise.all([
        apiGet('/qr-codes'),
        apiGet('/tables'),
      ]);

      const tables: TableType[] = (Array.isArray(tablesRes) ? tablesRes : (tablesRes?.data ?? [])).map((t: any) => ({
        ...t,
        id: String(t.id || t._id || ''),
      }));
      setTables(tables);

      const rawQrs: QRCode[] = Array.isArray(qrRes) ? qrRes : (qrRes?.data ?? []);

      if (rawQrs.length === 0) {
        setCodes([]);
        return;
      }

      setCodes(
        rawQrs.map((q: any) => ({
          ...q,
          id: String(q.id || q._id || q.qrCodeId || q.token),
          tableId: q.tableId,
          table: tables.find((t) => t.id === q.tableId),
        }))
      );
    } catch (err: any) {
      toast(err.message, { variant: 'error' });
      setCodes([]);
      setTables([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, [branch?.id]);

  const filtered = codes.filter((q) => {
    if (zoneFilter && (q.table as any)?.zone !== zoneFilter) return false;
    if (search && !(q.table as any)?.name?.toLowerCase().includes(search.toLowerCase()) && !q.token.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const toggleSelect = (id: string) => {
    setSelected((s) => s.find((x) => x.id === id) ? s.filter((x) => x.id !== id) : [...s, ...filtered.filter((x) => x.id === id)]);
  };
  const selectAll = () => setSelected(selected.length === filtered.length ? [] : [...filtered]);

  const qrDataUrl = (token: string, tableName: string) => {
    const text = `${window.location.origin}/t/${token}`;
    const size = 200;
    const base = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=10&data=`;
    return base + encodeURIComponent(text);
  };

  const downloadPDF = async () => {
    const targets = selected.length ? selected : filtered;
    if (targets.length === 0) { toast('Select tables to download', { variant: 'warning' }); return; }
    setDownloading(true);
    try {
      const tableIds = targets.map((t) => t.tableId).filter(Boolean);
      const params = new URLSearchParams({ tableIds: tableIds.join(',') });
      const url = `${API_BASE_URL}/qr-codes/pdf?${params.toString()}`;
      const res = await fetch(url, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload: any = await res.json().catch(() => null);
      const qrPacks = payload?.qrPacks ?? payload?.data?.qrPacks;
      if (!qrPacks || !Array.isArray(qrPacks)) {
        setShowPreview(true);
        toast('QR pack ready', { variant: 'success' });
        return;
      }

      const now = new Date();
      const next: QRExtended[] = qrPacks.map((p: any) => ({
        id: `${p.token}`,
        restaurantId: '',
        branchId: '',
        token: p.token,
        tableId: '',
        isActive: true,
        createdAt: now as any,
        updatedAt: now as any,
        table: {
          id: '',
          restaurantId: '',
          branchId: '',
          name: p.tableName || 'Table',
          capacity: 0,
          zone: p.zone,
          isActive: true,
          qrCodeId: '',
          createdAt: new Date() as any,
          updatedAt: new Date() as any,
        } as any,
      }));
      setCodes(next);
      setSelected([]);
      setShowPreview(true);
      toast('QR pack ready', { variant: 'success' });
    } catch (err: any) {
      toast(err.message, { variant: 'error' });
    } finally {
      setDownloading(false);
    }
  };

  const regenerateMissing = async () => {
    const existingTableIds = new Set(codes.map((c) => c.tableId).filter(Boolean));
    const missingTables = tables.filter((t) => !existingTableIds.has(t.id));
    if (missingTables.length === 0) {
      toast('All tables already have QR codes', { variant: 'success' });
      return;
    }
    setRegenerating(true);
    try {
      await Promise.all(
        missingTables.map((t) => apiPost(`/qr-codes/tables/${t.id}/regenerate`, {}))
      );
      toast('QR codes generated', { description: `${missingTables.length} table(s) updated`, variant: 'success' });
      fetchAll();
    } catch (err: any) {
      toast('Generate failed', { description: err.message, variant: 'error' });
    } finally {
      setRegenerating(false);
    }
  };

  const handlePrint = () => {
    setPrinting(true);
    setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 300);
  };

  const downloadCSV = () => {
    const targets = selected.length ? selected : filtered;
    const rows = [['Table', 'Zone', 'Token', 'URL', 'Status', 'Created']];
    targets.forEach((q) => {
      rows.push([
        (q.table as any)?.name || '',
        (q.table as any)?.zone || '',
        q.token,
        `${window.location.origin}/t/${q.token}`,
        q.isActive ? 'Active' : 'Inactive',
        formatDateTime(q.createdAt),
      ]);
    });
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `qr-codes-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    toast('CSV downloaded', { variant: 'success' });
  };

  const downloadJSON = () => {
    const targets = selected.length ? selected : filtered;
    const blob = new Blob([JSON.stringify(targets, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `qr-codes-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    toast('JSON downloaded', { variant: 'success' });
  };

  const columns: Column<QRExtended>[] = [
    {
      key: 'select',
      title: (
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            checked={selected.length === filtered.length && filtered.length > 0}
            onChange={selectAll}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ),
      className: 'w-[50px]',
      render: (r) => (
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          checked={!!selected.find((s) => s.id === r.id)}
          onChange={() => toggleSelect(r.id)}
          onClick={(e) => e.stopPropagation()}
        />
      ),
    },
    {
      key: 'preview',
      title: '',
      className: 'w-[70px]',
      render: (r) => (
        <div className="h-12 w-12 rounded-lg bg-white border border-slate-200 p-1.5">
          <img
            src={qrDataUrl(r.token, (r.table as any)?.name || '')}
            alt={`QR ${r.token}`}
            className="h-full w-full object-contain"
            loading="lazy"
          />
        </div>
      ),
    },
    {
      key: 'table',
      title: 'Table',
      render: (r) => (
        <div>
          <div className="font-semibold text-slate-900">{(r.table as any)?.name || '—'}</div>
          <div className="text-[11px] text-slate-500">{(r.table as any)?.zone || 'Unassigned'}</div>
        </div>
      ),
    },
    {
      key: 'token',
      title: 'Token',
      className: 'font-mono font-semibold text-brand-700',
      render: (r) => r.token,
    },
    {
      key: 'capacity',
      title: 'Capacity',
      className: 'tabular-nums text-slate-600',
      render: (r) => `${(r.table as any)?.capacity || '—'} pax`,
    },
    {
      key: 'status',
      title: 'Status',
      render: (r) => (
        r.isActive ? <Badge variant="success" dot>Active</Badge> : <Badge variant="soft" dot>Inactive</Badge>
      ),
    },
    {
      key: 'created',
      title: 'Created',
      className: 'text-slate-500 text-xs',
      render: (r) => formatDateTime(r.createdAt),
    },
  ];

  const previewCodes = selected.length ? selected : filtered;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">QR Codes</h1>
          <p className="text-sm text-slate-500 mt-1">{formatNumber(filtered.length)} codes generated · {formatNumber(selected.length)} selected</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" loading={regenerating} onClick={regenerateMissing}>
            Generate Missing
          </Button>
          <Button variant="secondary" loading={downloading} onClick={downloadPDF}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <path d="M14 2v6h6M12 18v-6M9 15h6" />
            </svg>
            Download PDF
          </Button>
          <Button variant="outline" onClick={handlePrint}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z" />
            </svg>
            Print
          </Button>
          <Button variant="ghost" onClick={downloadCSV}>
            CSV
          </Button>
          <Button variant="ghost" onClick={downloadJSON}>
            JSON
          </Button>
        </div>
      </div>

      <Card>
        <div className="px-5 py-4 border-b border-slate-100 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Input
            placeholder="Search table or token..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            prefix={
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" strokeLinecap="round" strokeLinejoin="round" /></svg>
            }
          />
          <Select options={ZONES} value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)} />
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
          emptyText="No QR codes found"
        />
      </Card>

      <Modal
        open={showPreview}
        onClose={() => setShowPreview(false)}
        size="xl"
        title={`${previewCodes.length} QR Code${previewCodes.length > 1 ? 's' : ''} — Preview`}
        description="Review before printing. Individual codes are per table."
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap pb-2 border-b border-slate-100">
            <div className="text-xs text-slate-500">{formatNumber(previewCodes.length)} sheets · Use browser print for paper output</div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={downloadCSV}>Export CSV</Button>
              <Button size="sm" onClick={handlePrint}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 mr-1"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z" strokeLinecap="round" strokeLinejoin="round" /></svg>
                Print All
              </Button>
            </div>
          </div>
          <div className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 ${printing ? 'print-only' : ''}`}>
            {previewCodes.map((q) => {
              const tName = (q.table as any)?.name || 'Table';
              const tZone = (q.table as any)?.zone || '';
              const tCap = (q.table as any)?.capacity;
              return (
                <div
                  key={q.id}
                  className="rounded-2xl border-2 border-slate-200 bg-white p-4 flex flex-col items-center text-center shadow-sm hover:border-brand-200 transition print:shadow-none print:break-inside-avoid"
                  style={{ printColorAdjust: 'exact' } as React.CSSProperties}
                >
                  <div className="w-full aspect-square max-w-[200px] mx-auto rounded-xl bg-slate-50 p-3 flex items-center justify-center">
                    <img
                      src={qrDataUrl(q.token, tName)}
                      alt={`QR ${q.token}`}
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <div className="mt-3 w-full">
                    <div className="text-xl font-black text-slate-900 tracking-tight leading-none">{tName}</div>
                    {tZone && <div className="mt-1 text-xs font-semibold text-slate-500 uppercase tracking-wider">{tZone}</div>}
                    <div className="mt-2 font-mono text-xs font-bold text-brand-700 bg-brand-50 inline-block px-2 py-1 rounded-md">
                      {q.token}
                    </div>
                    {tCap !== undefined && (
                      <div className="mt-2 text-xs text-slate-500">
                        Seats <span className="font-semibold text-slate-700">{tCap}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Modal>
    </div>
  );
}
