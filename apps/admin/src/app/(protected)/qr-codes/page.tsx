'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { DataTable, Column } from '@/components/ui/Table';
import { Modal } from '@/components/ui/Modal';
import { apiGet, apiPost, unwrapList, sid, sidEq, resolveWebsiteBase } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { formatDateTime, formatNumber } from '@/lib/format';
import { toast } from '@/components/ui/Toast';
import type { QRCode, Table as TableType } from '@prolific/shared-types';

interface QRExtended extends QRCode {
  table?: TableType;
}

// Exactly matches server seed Main Hall zone + Tables page DEFAULT_ZONES so
// the filter dropdown never mismatches against T1..T7 floor plan.
const ZONES = [
  { value: '', label: 'All Zones' },
  { value: 'Main Hall', label: 'Main Hall' },
];

// Canonical 7-table plan mirroring server seed / POS SEEDED_TABLES. Keep this
// in lock-step with seed.service.ts createTablesWithQr SEVEN_TABLE_PLAN and
// the Admin Tables page copy above — render order + name filter key off it.
const SEVEN_TABLE_PLAN: Array<{ name: string; capacity: number; zone: string }> = [
  { name: 'T1', capacity: 2, zone: 'Main Hall' },
  { name: 'T2', capacity: 2, zone: 'Main Hall' },
  { name: 'T3', capacity: 4, zone: 'Main Hall' },
  { name: 'T4', capacity: 4, zone: 'Main Hall' },
  { name: 'T5', capacity: 4, zone: 'Main Hall' },
  { name: 'T6', capacity: 6, zone: 'Main Hall' },
  { name: 'T7', capacity: 6, zone: 'Main Hall' },
];
const CANONICAL_TABLE_NAMES = new Set(SEVEN_TABLE_PLAN.map((p) => p.name));
const CANONICAL_ORDER = new Map(SEVEN_TABLE_PLAN.map((p, i) => [p.name, i]));

export default function QRCodesPage() {
  const { branch } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [codes, setCodes] = useState<QRExtended[]>([]);
  const [tables, setTables] = useState<TableType[]>([]);
  const [zoneFilter, setZoneFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<QRExtended[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [generatingMissing, setGeneratingMissing] = useState(false);

  // Resolve Website surface public URL once per render (stable — function has
  // localStorage + env + hostname chain internally, same as POS/api shims).
  const websiteBase = useMemo(() => resolveWebsiteBase(), []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [qrRes, tablesRes]: any = await Promise.all([
        apiGet('/qr-codes'),
        apiGet('/tables'),
      ]);

      const tablesRaw = unwrapList<TableType>(tablesRes);
      // String-normalize ids + restrict to the 7 canonical T1..T7 names so
      // the list stays aligned with POS SEEDED_TABLES regardless of stale
      // extras in Mongo (extras get soft-deactivated on next seed run).
      const normalizedTables: TableType[] = tablesRaw
        .filter((t: any) => CANONICAL_TABLE_NAMES.has(String(t.name || '')))
        .map((t: any) => ({
          ...t,
          id: sid(t.id ?? t._id),
        }))
        .sort((a: any, b: any) => {
          const ai = CANONICAL_ORDER.get(String(a.name || '')) ?? 99;
          const bi = CANONICAL_ORDER.get(String(b.name || '')) ?? 99;
          return ai - bi;
        });
      setTables(normalizedTables);
      const byId = new Map<string, TableType>();
      for (const t of normalizedTables) byId.set(t.id, t);

      const rawQrs = unwrapList<QRCode>(qrRes);
      setCodes(
        rawQrs
          .map((q: any) => {
            const qid = sid(q.id ?? q._id ?? q.qrCodeId ?? q.token);
            const tid = sid(q.tableId);
            return {
              ...q,
              id: qid,
              tableId: tid,
              table: tid ? byId.get(tid) : undefined,
            };
          })
          // Drop any QRs that point at non-canonical tables (e.g. T8+ from
          // old seeds) so we render exactly 7 rows matching POS floor.
          .filter((q: any) => q.table && CANONICAL_TABLE_NAMES.has(String((q.table as any).name || '')))
          // Sort rows T1→T7 so the table column is visually identical to
          // the Admin tables grid and the POS floor plan order.
          .sort((a: any, b: any) => {
            const ai = CANONICAL_ORDER.get(String((a.table as any)?.name || '')) ?? 99;
            const bi = CANONICAL_ORDER.get(String((b.table as any)?.name || '')) ?? 99;
            return ai - bi;
          })
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
    const s = String(search || '').toLowerCase();
    if (s) {
      const tableName = String((q.table as any)?.name || '').toLowerCase();
      const token = String(q.token || '').toLowerCase();
      if (!tableName.includes(s) && !token.includes(s)) return false;
    }
    return true;
  });

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      if (prev.find((x) => sidEq(x.id, id))) return prev.filter((x) => !sidEq(x.id, id));
      const add = filtered.filter((x) => sidEq(x.id, id));
      return [...prev, ...add];
    });
  };
  const selectAll = () => {
    setSelected((prev) => (prev.length === filtered.length && filtered.length > 0 ? [] : [...filtered]));
  };

  // Generate QR image URL pointing at the Website surface — NOT admin origin.
  // Customer scans → lands on www.prolifictables.com/order?table=<token> →
  // resolveTableByIdentifier + joinOrStartTableSession public endpoints take
  // over (pre-wired in Nest). Customer requirement #2 mandates this URL shape
  // (NOT the legacy /t/<token> path).
  const qrDataUrl = (token: string) => {
    const publicUrl = `${websiteBase}/order?table=${encodeURIComponent(token)}`;
    const size = 200;
    const base = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=10&data=`;
    return base + encodeURIComponent(publicUrl);
  };

  const downloadPDF = async () => {
    const targets = selected.length ? selected : filtered;
    if (targets.length === 0) { toast('Select tables to download', { variant: 'warning' }); return; }
    setDownloading(true);
    try {
      const tableIds = targets.map((t) => t.tableId).filter(Boolean);
      const params = new URLSearchParams({ tableIds: tableIds.join(',') });
      // Route through apiGet so we inherit the guarded Render wake-up cycle +
      // JWT auth header, instead of raw fetch that would 401 / timeout.
      const payload: any = await apiGet(`/qr-codes/pdf?${params.toString()}`);
      // Controller returns {qrPacks:[...], layout:{...}} directly (no .data
      // envelope) — keep dual-shape guard in case it changes later.
      const qrPacks: any[] = payload?.qrPacks ?? payload?.data?.qrPacks ?? [];
      if (!qrPacks.length) {
        toast('No QR packs returned', { variant: 'warning' });
        return;
      }

      // Merge tokens generated from server (generate-on-empty, never overwrite
      // existing printed codes) into the list so the preview modal renders the
      // exact same tokens the PDF will print.
      const now = new Date();
      const next: QRExtended[] = qrPacks.map((p) => ({
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
          zone: p.zone || 'Main Hall',
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

  const generateMissingQrs = async () => {
    const existingTableIds = new Set(codes.map((c) => sid(c.tableId)).filter(Boolean));
    const missingTables = tables.filter((t) => !existingTableIds.has(sid(t.id)));
    if (missingTables.length === 0) {
      toast('All tables already have QR codes', { variant: 'success' });
      return;
    }
    setGeneratingMissing(true);
    try {
      await Promise.all(
        missingTables.map((t) => apiPost(`/qr-codes/tables/${encodeURIComponent(sid(t.id))}/regenerate`, {}))
      );
      toast('QR codes generated for new tables', { description: `${missingTables.length} table(s) now have a permanent QR code — print & tape to the table.`, variant: 'success' });
      fetchAll();
    } catch (err: any) {
      toast('Generate failed', { description: err.message, variant: 'error' });
    } finally {
      setGeneratingMissing(false);
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
        `${websiteBase}/order?table=${encodeURIComponent(q.token)}`,
        q.isActive ? 'Active' : 'Inactive',
        formatDateTime(q.createdAt),
      ]);
    });
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `qr-codes-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    toast('CSV downloaded', { variant: 'success' });
  };

  const downloadJSON = () => {
    const targets = selected.length ? selected : filtered;
    // Website URLs embedded in JSON dump too — so operators can paste into
    // sticker printers without running the Admin UI.
    const enriched = targets.map((q) => ({
      token: q.token,
      tableName: (q.table as any)?.name || '',
      zone: (q.table as any)?.zone || '',
      capacity: (q.table as any)?.capacity,
      url: `${websiteBase}/order?table=${encodeURIComponent(q.token)}`,
      isActive: q.isActive,
      createdAt: q.createdAt,
    }));
    const blob = new Blob([JSON.stringify(enriched, null, 2)], { type: 'application/json' });
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
          checked={!!selected.find((s) => sidEq(s.id, r.id))}
          onChange={() => toggleSelect(sid(r.id))}
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
            src={qrDataUrl(r.token)}
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
      render: (r) => `${(r.table as any)?.capacity ?? '—'} pax`,
    },
    {
      key: 'url',
      title: 'Public URL',
      className: 'text-xs text-slate-500',
      render: (r) => (
        <div className="font-mono truncate max-w-[220px]" title={`${websiteBase}/order?table=${r.token}`}>
          {`${websiteBase}/order?table=${r.token}`}
        </div>
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
          <Button variant="outline" loading={generatingMissing} onClick={generateMissingQrs}>
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
        <div className="px-5 py-4 border-b border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            placeholder="Search table or token..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            prefix={
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" strokeLinecap="round" strokeLinejoin="round" /></svg>
            }
          />
          <Select options={ZONES} value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)} />
        </div>
        <DataTable
          columns={columns}
          data={filtered}
          rowKey={(r) => sid(r.id)}
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
                  key={sid(q.id)}
                  className="rounded-2xl border-2 border-slate-200 bg-white p-4 flex flex-col items-center text-center shadow-sm hover:border-brand-200 transition print:shadow-none print:break-inside-avoid"
                  style={{ printColorAdjust: 'exact' } as React.CSSProperties}
                >
                  <div className="w-full aspect-square max-w-[200px] mx-auto rounded-xl bg-slate-50 p-3 flex items-center justify-center">
                    <img
                      src={qrDataUrl(q.token)}
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
                    <div className="mt-2 text-[10px] text-slate-500 truncate font-mono">
                      {`${websiteBase}/order?table=${encodeURIComponent(q.token)}`}
                    </div>
                    {tCap !== undefined && (
                      <div className="mt-1 text-xs text-slate-500">
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
