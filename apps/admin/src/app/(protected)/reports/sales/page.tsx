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
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

type GroupBy = 'DAY' | 'WEEK' | 'MONTH';
type Basis = 'PAYMENTS' | 'ORDERS';

interface SalesRow {
  period: string;
  startDate: string;
  endDate: string;
  orders: number;
  customers: number;
  subtotal: number;
  tax: number;
  tips: number;
  discount: number;
  refunds: number;
  voids: number;
  total: number;
  aov: number;
}

interface CashierRow {
  employeeId: string;
  employeeName: string;
  role: string;
  ordersOpened: number;
  paymentsCollectedCents: number;
  paymentsCount: number;
  voidCount: number;
  refundCount: number;
}

const TABS: { value: GroupBy; label: string }[] = [
  { value: 'DAY', label: 'By Day' },
  { value: 'WEEK', label: 'By Week' },
  { value: 'MONTH', label: 'By Month' },
];

function dateRangeToIso(dateFrom: string, dateTo: string): { fromIso: string; toIso: string } {
  const from = new Date(`${dateFrom}T00:00:00.000Z`);
  const to = new Date(`${dateTo}T23:59:59.999Z`);
  return { fromIso: from.toISOString(), toIso: to.toISOString() };
}

export default function SalesReportPage() {
  const { branch } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [groupBy, setGroupBy] = useState<GroupBy>('DAY');
  const [basis, setBasis] = useState<Basis>('PAYMENTS');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [channel, setChannel] = useState('');
  const [rows, setRows] = useState<SalesRow[]>([]);
  const [cashierLoading, setCashierLoading] = useState(false);
  const [cashiers, setCashiers] = useState<CashierRow[]>([]);
  const [cashierSearch, setCashierSearch] = useState('');

  const fetchReport = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('groupBy', groupBy.toLowerCase());
      params.set('dateFrom', dateFrom);
      params.set('dateTo', dateTo);
      params.set('basis', basis === 'ORDERS' ? 'orders' : 'payments');
      if (branch?.id) params.set('branchId', branch.id);
      const res: any = await apiGet(`/reports/sales?${params.toString()}`);
      const serverRows: any[] = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
      setRows(
        serverRows.map((r: any) => ({
          period: String(r.period || ''),
          startDate: String(r.period || ''),
          endDate: String(r.period || ''),
          orders: Number(r.orderCount || 0),
          customers: Number(r.orderCount || 0),
          subtotal: Number(r.subtotalCents || 0),
          tax: Number(r.taxCents || 0),
          tips: 0,
          discount: Number(r.discountCents || 0),
          refunds: 0,
          voids: 0,
          total: Number(r.totalCents || 0),
          aov: Number(r.aovCents || 0),
        }))
      );
    } catch (err: any) {
      toast('Failed to load sales report', { description: err.message, variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const fetchCashiers = async () => {
    setCashierLoading(true);
    try {
      const { fromIso, toIso } = dateRangeToIso(dateFrom, dateTo);
      const params = new URLSearchParams();
      params.set('from', fromIso);
      params.set('to', toIso);
      params.set('basis', basis === 'ORDERS' ? 'orders' : 'payments');
      const res: any = await apiGet(`/reports/cashiers?${params.toString()}`);
      const rows: any[] = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
      setCashiers(
        rows.map((r: any) => ({
          employeeId: String(r.employeeId || ''),
          employeeName: String(r.employeeName || '—'),
          role: String(r.role || ''),
          ordersOpened: Number(r.ordersOpened || 0),
          paymentsCollectedCents: Number(r.paymentsCollectedCents || 0),
          paymentsCount: Number(r.paymentsCount || 0),
          voidCount: Number(r.voidCount || 0),
          refundCount: Number(r.refundCount || 0),
        }))
      );
    } catch (err: any) {
      toast('Failed to load cashier report', { description: err.message, variant: 'error' });
    } finally {
      setCashierLoading(false);
    }
  };

  useEffect(() => { fetchReport(); }, [branch?.id, groupBy, dateFrom, dateTo, channel, basis]);
  useEffect(() => { fetchCashiers(); }, [dateFrom, dateTo, basis]);

  const totals = useMemo(() => {
    const t = {
      orders: 0, customers: 0, subtotal: 0, tax: 0, tips: 0,
      discount: 0, refunds: 0, voids: 0, total: 0,
    };
    rows.forEach((r) => {
      t.orders += r.orders;
      t.customers += r.customers;
      t.subtotal += r.subtotal;
      t.tax += r.tax;
      t.tips += r.tips;
      t.discount += r.discount;
      t.refunds += r.refunds;
      t.voids += r.voids;
      t.total += r.total;
    });
    return { ...t, aov: t.orders ? Math.round(t.total / t.orders) : 0 };
  }, [rows]);

  const chartData = rows.map((r) => ({
    period: r.period,
    Sales: r.total / 100,
    Orders: r.orders,
    AOV: r.aov / 100,
  }));

  const filteredCashiers = useMemo(() => {
    const q = cashierSearch.trim().toLowerCase();
    if (!q) return cashiers;
    return cashiers.filter((c) => {
      const name = String(c.employeeName || '').toLowerCase();
      const role = String(c.role || '').toLowerCase();
      const id = String(c.employeeId || '').toLowerCase();
      return name.includes(q) || role.includes(q) || id.includes(q);
    });
  }, [cashierSearch, cashiers]);

  const topCashiers = useMemo(() => {
    const sorted = [...filteredCashiers].sort(
      (a, b) => Number(b.paymentsCollectedCents || 0) - Number(a.paymentsCollectedCents || 0)
    );
    return sorted.slice(0, 5);
  }, [filteredCashiers]);

  const exportCSV = () => {
    const headers = ['Period', 'Orders', 'Customers', 'Subtotal', 'Tax', 'Tips', 'Discount', 'Refunds', 'Voids', 'Total', 'AOV'];
    const data = rows.map((r) => [
      r.period, r.orders, r.customers,
      r.subtotal / 100, r.tax / 100, r.tips / 100, r.discount / 100, r.refunds / 100, r.voids / 100, r.total / 100, r.aov / 100,
    ]);
    const csv = [headers, ...data].map((row) => row.map((c) => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sales-report-${groupBy.toLowerCase()}-${dateFrom}-to-${dateTo}.csv`;
    a.click();
    toast('CSV exported', { variant: 'success' });
  };

  const copySummary = async () => {
    const text = [
      `Sales Report (${TABS.find((t) => t.value === groupBy)?.label})`,
      `Period: ${dateFrom} to ${dateTo}`,
      '',
      `Orders: ${formatNumber(totals.orders)}`,
      `Customers: ${formatNumber(totals.customers)}`,
      `Net Sales: ${formatNGN(totals.total)}`,
      `Tax: ${formatNGN(totals.tax)}`,
      `Tips: ${formatNGN(totals.tips)}`,
      `Discounts: ${formatNGN(totals.discount)}`,
      `Refunds: ${formatNGN(totals.refunds)}`,
      `Voids: ${formatNGN(totals.voids)}`,
      `Avg Order Value: ${formatNGN(totals.aov)}`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('Summary copied', { variant: 'success' });
    } catch {
      toast('Copy failed', { variant: 'warning' });
    }
  };

  const columns: Column<SalesRow>[] = [
    { key: 'period', title: 'Period', className: 'font-semibold text-slate-900 whitespace-nowrap', render: (r) => (
      <div>
        <div className="font-semibold text-slate-900">{r.period}</div>
        <div className="text-[11px] text-slate-400 font-mono">{r.startDate}</div>
      </div>
    ) },
    { key: 'orders', title: 'Orders', className: 'tabular-nums text-right', render: (r) => formatNumber(r.orders) },
    { key: 'customers', title: 'Customers', className: 'tabular-nums text-right', render: (r) => formatNumber(r.customers) },
    { key: 'subtotal', title: 'Subtotal', className: 'tabular-nums text-right text-slate-700', render: (r) => formatNGN(r.subtotal) },
    { key: 'tax', title: 'Tax', className: 'tabular-nums text-right text-slate-500', render: (r) => formatNGN(r.tax) },
    { key: 'tips', title: 'Tips', className: 'tabular-nums text-right text-emerald-600', render: (r) => r.tips > 0 ? formatNGN(r.tips) : '—' },
    { key: 'discount', title: 'Discount', className: 'tabular-nums text-right text-amber-600', render: (r) => r.discount > 0 ? `-${formatNGN(r.discount)}` : '—' },
    { key: 'refunds', title: 'Refunds', className: 'tabular-nums text-right text-red-600', render: (r) => r.refunds > 0 ? `-${formatNGN(r.refunds)}` : '—' },
    { key: 'total', title: 'Net Sales', className: 'tabular-nums text-right font-bold text-slate-900', render: (r) => formatNGN(r.total) },
    { key: 'aov', title: 'AOV', className: 'tabular-nums text-right text-slate-600', render: (r) => formatNGN(r.aov) },
  ];

  const cashierColumns: Column<CashierRow>[] = [
    {
      key: 'employeeName',
      title: 'Staff',
      className: 'font-semibold text-slate-900',
      render: (r) => (
        <div className="min-w-0">
          <div className="font-semibold text-slate-900 truncate max-w-[220px]">{r.employeeName || '—'}</div>
          <div className="text-[11px] text-slate-400 font-mono truncate max-w-[220px]">{r.employeeId}</div>
        </div>
      ),
    },
    { key: 'role', title: 'Role', className: 'text-slate-600', render: (r) => r.role || '—' },
    { key: 'ordersOpened', title: 'Orders', className: 'tabular-nums text-right', render: (r) => formatNumber(r.ordersOpened) },
    { key: 'paymentsCount', title: 'Payments', className: 'tabular-nums text-right', render: (r) => formatNumber(r.paymentsCount) },
    {
      key: 'paymentsCollectedCents',
      title: 'Collected',
      className: 'tabular-nums text-right font-semibold text-slate-900',
      render: (r) => formatNGN(r.paymentsCollectedCents),
    },
    {
      key: 'aov',
      title: 'Avg Sale',
      className: 'tabular-nums text-right text-slate-700',
      render: (r) => {
        const denom = Number(r.paymentsCount || 0) > 0 ? Number(r.paymentsCount) : Number(r.ordersOpened || 0);
        const aov = denom > 0 ? Math.floor(Number(r.paymentsCollectedCents || 0) / denom) : 0;
        return aov > 0 ? formatNGN(aov) : '—';
      },
    },
    { key: 'voidCount', title: 'Voids', className: 'tabular-nums text-right text-slate-600', render: (r) => formatNumber(r.voidCount) },
    { key: 'refundCount', title: 'Refunds', className: 'tabular-nums text-right text-slate-600', render: (r) => formatNumber(r.refundCount) },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Badge variant="brand">Reporting</Badge>
            <span>·</span>
            <span>{branch?.name || 'All Branches'}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mt-1.5">Sales Report</h1>
          <p className="text-sm text-slate-500 mt-1">Revenue breakdown, volume trends, and average order value</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" onClick={copySummary}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 mr-1"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Copy Summary
          </Button>
          <Button variant="secondary" onClick={exportCSV}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 mr-1"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Export CSV
          </Button>
        </div>
      </div>

      <Card>
        <div className="px-5 pt-4 pb-2 flex flex-wrap items-center gap-2 border-b border-slate-100">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setGroupBy(t.value)}
              className={cn(
                'px-4 py-2 rounded-xl text-sm font-semibold transition-all',
                groupBy === t.value
                  ? 'bg-brand-600 text-white shadow-soft'
                  : 'text-slate-600 hover:bg-slate-100'
              )}
            >
              {t.label}
            </button>
          ))}
          <div className="h-6 w-px bg-slate-200 mx-2" />
          <div className="flex items-center gap-1.5">
            {([
              { v: 'PAYMENTS', label: 'Payments' },
              { v: 'ORDERS', label: 'Orders' },
            ] as Array<{ v: Basis; label: string }>).map((opt) => (
              <button
                key={opt.v}
                onClick={() => setBasis(opt.v)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border',
                  basis === opt.v
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="h-6 w-px bg-slate-200 mx-2" />
          <div className="flex flex-wrap items-center gap-2 ml-auto">
            <Input type="date" label="" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="!w-[150px]" />
            <span className="text-slate-400 text-sm">to</span>
            <Input type="date" label="" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="!w-[150px]" />
            <Select
              label=""
              options={[
                { value: '', label: 'All Channels' },
                { value: 'POS', label: 'POS' },
                { value: 'QR', label: 'QR Order' },
                { value: 'WEBSITE', label: 'Website' },
                { value: 'APP', label: 'App' },
              ]}
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="!w-[160px]"
            />
            <Button variant="outline" onClick={fetchReport}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M23 4v6h-6M1 20v-6h6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-px bg-slate-100">
          {[
            { label: 'Orders', value: formatNumber(totals.orders), tone: 'text-brand-700', accent: 'bg-brand-50' },
            { label: 'Customers', value: formatNumber(totals.customers), tone: 'text-slate-700', accent: 'bg-slate-50' },
            { label: 'Subtotal', value: formatNGN(totals.subtotal), tone: 'text-slate-800', accent: 'bg-slate-50' },
            { label: 'Tax', value: formatNGN(totals.tax), tone: 'text-slate-600', accent: 'bg-slate-50' },
            { label: 'Tips', value: formatNGN(totals.tips), tone: 'text-emerald-700', accent: 'bg-emerald-50' },
            { label: 'Discounts', value: `-${formatNGN(totals.discount)}`, tone: 'text-amber-700', accent: 'bg-amber-50' },
            { label: 'Refunds/Voids', value: `-${formatNGN(totals.refunds + totals.voids)}`, tone: 'text-red-700', accent: 'bg-red-50' },
            { label: 'Net Sales', value: formatNGN(totals.total), tone: 'text-brand-700 font-bold', accent: 'bg-brand-50' },
          ].map((kpi) => (
            <div key={kpi.label} className={cn('px-4 py-3 bg-white', kpi.accent && `!${kpi.accent}`)}>
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{kpi.label}</div>
              <div className={cn('mt-1 text-lg tabular-nums truncate', kpi.tone)}>{kpi.value}</div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader padded>
            <div>
              <CardTitle>Net Sales Trend</CardTitle>
              <p className="text-sm text-slate-500 mt-0.5">Revenue by period</p>
            </div>
          </CardHeader>
          <div className="h-[280px] px-2 pb-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis dataKey="period" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11 }} dy={8} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={(v) => `₦${(v / 1000).toFixed(0)}K`} />
                <Tooltip
                  cursor={{ fill: '#f8fafc' }}
                  contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                  formatter={(v: any, n: any) => [n === 'Sales' ? `₦${Number(v).toLocaleString()}` : formatNumber(v), n]}
                />
                <Bar dataKey="Sales" fill="#4F46E5" radius={[6, 6, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader padded>
            <div>
              <CardTitle>Orders & AOV</CardTitle>
              <p className="text-sm text-slate-500 mt-0.5">Volume and average order value</p>
            </div>
          </CardHeader>
          <div className="h-[280px] px-2 pb-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis dataKey="period" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11 }} dy={8} />
                <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={(v) => `₦${v}K`} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line yAxisId="left" type="monotone" dataKey="Orders" stroke="#F97316" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                <Line yAxisId="right" type="monotone" dataKey="AOV" stroke="#4F46E5" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader padded className="flex-wrap gap-3">
          <div>
            <CardTitle>Period Breakdown</CardTitle>
            <p className="text-sm text-slate-500 mt-0.5">{formatNumber(rows.length)} periods shown</p>
          </div>
          <Badge variant="soft">{dateFrom} → {dateTo}</Badge>
        </CardHeader>
        <div className="border-t border-slate-100">
          <DataTable
            columns={columns}
            data={rows}
            rowKey={(r) => r.period + r.startDate}
            loading={loading}
            emptyText="No data for selected period"
          />
        </div>
        <div className="px-5 py-4 border-t border-slate-200 bg-slate-50/60 flex flex-wrap items-center gap-4 text-sm">
          <div className="flex-1 flex flex-wrap gap-x-6 gap-y-2">
            <span><span className="text-slate-500">Total Orders:</span> <span className="font-semibold text-slate-900 tabular-nums">{formatNumber(totals.orders)}</span></span>
            <span><span className="text-slate-500">Customers:</span> <span className="font-semibold text-slate-900 tabular-nums">{formatNumber(totals.customers)}</span></span>
            <span><span className="text-slate-500">Gross Subtotal:</span> <span className="font-semibold text-slate-900 tabular-nums">{formatNGN(totals.subtotal + totals.tax + totals.tips)}</span></span>
            <span><span className="text-slate-500">Deductions:</span> <span className="font-semibold text-red-700 tabular-nums">-{formatNGN(totals.discount + totals.refunds + totals.voids)}</span></span>
            <span><span className="text-slate-500">Net Revenue:</span> <span className="font-bold text-brand-700 tabular-nums text-base">{formatNGN(totals.total)}</span></span>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Staff Performance</CardTitle>
        </CardHeader>
        <div className="px-5 pb-5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
            <Input
              placeholder="Search staff name / role..."
              value={cashierSearch}
              onChange={(e) => setCashierSearch(e.target.value)}
              className="sm:max-w-[320px]"
            />
            <div className="ml-auto text-xs text-slate-500">
              {basis === 'PAYMENTS' ? 'Based on PAID payments' : 'Based on PAID orders'}
            </div>
          </div>

          {topCashiers.length > 0 && (
            <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
              {topCashiers.map((c) => (
                <div key={c.employeeId} className="rounded-xl border border-slate-100 bg-white px-3.5 py-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 truncate">
                    {c.employeeName || '—'}
                  </div>
                  <div className="mt-1.5 text-sm font-semibold text-slate-900 tabular-nums">
                    {formatNGN(c.paymentsCollectedCents || 0)}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    {formatNumber(c.paymentsCount || 0)} payments · {formatNumber(c.ordersOpened || 0)} orders
                  </div>
                </div>
              ))}
            </div>
          )}

          <DataTable
            columns={cashierColumns}
            data={filteredCashiers}
            rowKey={(r) => r.employeeId}
            loading={cashierLoading}
            emptyText="No cashier activity in this date range"
          />
        </div>
      </Card>
    </div>
  );
}
