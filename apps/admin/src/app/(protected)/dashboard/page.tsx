'use client';

import { useEffect, useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { apiGet } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { createAdminSocket } from '@/lib/socket';
import { formatNGN, formatNumber, formatRelativeTime, formatPercent } from '@/lib/format';
import { cn } from '@/lib/cn';
import { toast } from '@/components/ui/Toast';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import type { Order, OrderStatus } from '@prolific/shared-types';

interface DashboardStats {
  todaySales: number;
  todayOrders: number;
  pendingOrders: number;
  aov: number;
  mtdSales: number;
  priorMtdSales: number;
  lowStockCount: number;
}

interface SalesChartDatum {
  day: string;
  sales: number;
  orders: number;
}

interface TopItem {
  name: string;
  quantity: number;
  revenue: number;
  percentage: number;
}

const ORDER_STATUS_COLORS: Record<string, { variant: any; label: string }> = {
  PENDING: { variant: 'warning', label: 'Pending' },
  RECEIVED: { variant: 'warning', label: 'Received' },
  ACCEPTED: { variant: 'info', label: 'Accepted' },
  PREPARING: { variant: 'brand', label: 'Preparing' },
  READY: { variant: 'accent', label: 'Ready' },
  SERVED: { variant: 'brand', label: 'Served' },
  AWAITING_PAYMENT: { variant: 'warning', label: 'Awaiting Payment' },
  PARTIALLY_PAID: { variant: 'warning', label: 'Partially Paid' },
  PAID: { variant: 'success', label: 'Paid' },
  COMPLETED: { variant: 'success', label: 'Completed' },
  CANCELLED: { variant: 'soft', label: 'Cancelled' },
  REFUNDED: { variant: 'danger', label: 'Refunded' },
  VOIDED: { variant: 'danger', label: 'Voided' },
  ON_HOLD: { variant: 'soft', label: 'On Hold' },
};

const KPI = ({
  title,
  value,
  delta,
  icon,
  tone = 'brand',
  suffix,
}: {
  title: string;
  value: string;
  delta?: number;
  icon: React.ReactNode;
  tone?: 'brand' | 'accent' | 'success' | 'warning' | 'danger';
  suffix?: React.ReactNode;
}) => {
  const positive = (delta ?? 0) >= 0;
  const toneBg: Record<string, string> = {
    brand: 'bg-brand-50 text-brand-600',
    accent: 'bg-accent-50 text-accent-600',
    success: 'bg-emerald-50 text-emerald-600',
    warning: 'bg-amber-50 text-amber-600',
    danger: 'bg-red-50 text-red-600',
  };
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium uppercase tracking-wider text-slate-400">
              {title}
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <div className="text-2xl font-bold text-slate-900 tracking-tight tabular-nums truncate">
                {value}
              </div>
              {suffix}
            </div>
            {delta !== undefined && (
              <div className={cn(
                'mt-2 inline-flex items-center gap-1 text-xs font-semibold',
                positive ? 'text-emerald-600' : 'text-red-600'
              )}>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={cn('h-3.5 w-3.5', !positive && 'rotate-180')}
                >
                  <path d="M7 17l10-10M7 7h10v10" />
                </svg>
                {formatPercent(Math.abs(delta))}
                <span className="text-slate-400 font-normal ml-0.5">vs last wk</span>
              </div>
            )}
          </div>
          <div className={cn('h-11 w-11 rounded-xl flex items-center justify-center shrink-0', toneBg[tone])}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default function DashboardPage() {
  const { branch, accessToken } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats>({
    todaySales: 0,
    todayOrders: 0,
    pendingOrders: 0,
    aov: 0,
    mtdSales: 0,
    priorMtdSales: 0,
    lowStockCount: 0,
  });
  const [salesChart, setSalesChart] = useState<SalesChartDatum[]>([]);
  const [topItems, setTopItems] = useState<TopItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    try {
      const branchQuery = branch?.id
        ? `?branchId=${encodeURIComponent(branch.id)}`
        : '';
      const [statsRes, chartRes, itemsRes, ordersRes]: any = await Promise.all([
        branch?.id
          ? apiGet(`/reports/dashboard/stats${branchQuery}`)
          : Promise.resolve({
              data: {
                todaySales: 0,
                todayOrders: 0,
                pendingOrders: 0,
                aov: 0,
                mtdSales: 0,
                priorMtdSales: 0,
                lowStockCount: 0,
              },
            }),
        branch?.id
          ? apiGet(`/reports/dashboard/sales-7d${branchQuery}`)
          : Promise.resolve({ data: [] }),
        branch?.id
          ? apiGet(`/reports/dashboard/top-items${branchQuery}`)
          : Promise.resolve({ data: [] }),
        branch?.id
          ? apiGet(`/orders?limit=8&sort=-createdAt&branchId=${encodeURIComponent(branch.id)}`)
          : Promise.resolve({ data: [] }),
      ]);

      const s = statsRes?.data || statsRes;
      setStats(typeof s === 'object' && 'todaySales' in s ? s : (statsRes as any));
      setSalesChart(chartRes?.data || chartRes);
      setTopItems(itemsRes?.data || itemsRes);
      setOrders(ordersRes?.data || ordersRes);
    } catch (err: any) {
      toast('Dashboard error', { description: err.message, variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [branch?.id]);

  useEffect(() => {
    if (!accessToken || !branch?.id) return;
    const socket = createAdminSocket({
      branchId: branch.id,
      accessToken,
      handlers: {
        onOrderNew: () => {
          fetchData();
        },
        onOrderStatus: () => {
          fetchData();
        },
      },
    });
    return () => {
      if (socket) socket.disconnect();
    };
  }, [accessToken, branch?.id]);

  const mtdDelta = useMemo(() => {
    if (!stats.priorMtdSales) return 0;
    return ((stats.mtdSales - stats.priorMtdSales) / stats.priorMtdSales) * 100;
  }, [stats.mtdSales, stats.priorMtdSales]);

  const chartData = salesChart.map((d) => ({
    ...d,
    salesNGN: d.sales / 100,
  }));

  return (
    <div className="space-y-6">
      {!branch?.id && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <div className="flex items-start gap-4">
            <div className="h-10 w-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-amber-700">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-amber-900">Select a branch first</h3>
              <p className="text-sm text-amber-800 mt-1">
                You're signed in as a super admin. Please select a branch from the header dropdown above to view dashboard metrics.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <span>{new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</span>
            <span className="text-slate-300">·</span>
            <span>{branch?.name || 'All Branches'}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mt-1.5">
            Performance Dashboard
          </h1>
        </div>
        <Button
          variant="outline"
          size="sm"
          loading={refreshing}
          onClick={async () => {
            setRefreshing(true);
            await fetchData();
            setRefreshing(false);
          }}
          disabled={!branch?.id}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
          </svg>
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 gap-4">
        <KPI
          title="Today's Sales"
          value={formatNGN(stats.todaySales)}
          tone="brand"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
            </svg>
          }
        />
        <KPI
          title="Orders Today"
          value={formatNumber(stats.todayOrders)}
          tone="accent"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <path d="M9 2h6a2 2 0 012 2v1h1a3 3 0 013 3v11a3 3 0 01-3 3H7a3 3 0 01-3-3V8a3 3 0 013-3h1V4a2 2 0 012-2z" />
            </svg>
          }
        />
        <KPI
          title="Pending Orders"
          value={formatNumber(stats.pendingOrders)}
          tone="warning"
          suffix={
            stats.pendingOrders > 0 ? (
              <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
            ) : undefined
          }
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          }
        />
        <KPI
          title="Avg Order Value"
          value={formatNGN(stats.aov)}
          tone="success"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <path d="M3 3v18h18" />
              <polyline points="7 14 12 9 16 13 20 8" />
            </svg>
          }
        />
        <KPI
          title="MTD Sales"
          value={formatNGN(stats.mtdSales)}
          delta={mtdDelta}
          tone="brand"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          }
        />
        <KPI
          title="Low Stock Alerts"
          value={formatNumber(stats.lowStockCount)}
          tone="danger"
          suffix={
            stats.lowStockCount > 0 ? (
              <Badge variant="danger" className="!text-[10px] !px-1.5 !py-0.5">
                Action
              </Badge>
            ) : undefined
          }
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          }
        />
      </div>

      <div className="grid grid-cols-1 2xl:grid-cols-3 gap-4">
        <Card className="2xl:col-span-2">
          <CardHeader padded className="flex-wrap">
            <div>
              <CardTitle>7-Day Sales Overview</CardTitle>
              <p className="text-sm text-slate-500 mt-0.5">Daily sales and order volume trend</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="brand">Last 7 days</Badge>
            </div>
          </CardHeader>
          <CardContent padded={false} className="pt-0">
            <div className="h-[320px] px-2 pb-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} barGap={6} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="day"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#64748b', fontSize: 12 }}
                    dy={8}
                  />
                  <YAxis
                    yAxisId="left"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#64748b', fontSize: 12 }}
                    tickFormatter={(v) => `₦${(v / 1000000).toFixed(0)}M`}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#64748b', fontSize: 12 }}
                  />
                  <Tooltip
                    cursor={{ fill: '#f8fafc' }}
                    contentStyle={{
                      borderRadius: 12,
                      border: '1px solid #e2e8f0',
                      boxShadow: '0 4px 20px -8px rgba(15,23,42,0.15)',
                      fontSize: 12,
                    }}
                    formatter={(value: any, name: any) => [
                      name === 'salesNGN' ? formatNGN(value * 100) : formatNumber(value),
                      name === 'salesNGN' ? 'Sales' : 'Orders',
                    ]}
                  />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                  />
                  <Bar
                    yAxisId="left"
                    dataKey="salesNGN"
                    name="Sales"
                    fill="#4F46E5"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={40}
                  />
                  <Bar
                    yAxisId="right"
                    dataKey="orders"
                    name="Orders"
                    fill="#F97316"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={40}
                    opacity={0.85}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader padded>
            <div>
              <CardTitle>Top 5 Menu Items</CardTitle>
              <p className="text-sm text-slate-500 mt-0.5">By quantity sold today</p>
            </div>
          </CardHeader>
          <CardContent padded={false} className="pt-0 pb-3 space-y-3">
            {topItems.map((item, i) => (
              <div key={item.name} className="px-5 py-3 rounded-xl hover:bg-slate-50/80 transition">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className={cn(
                      'h-9 w-9 rounded-lg flex items-center justify-center text-xs font-bold shrink-0',
                      i === 0 ? 'bg-accent-100 text-accent-700' :
                      i === 1 ? 'bg-slate-100 text-slate-600' :
                      i === 2 ? 'bg-amber-100 text-amber-700' :
                      'bg-slate-50 text-slate-500 border border-slate-100'
                    )}>
                      #{i + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-slate-900 truncate">{item.name}</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        <span className="font-medium text-slate-700">{formatNumber(item.quantity)}</span> sold · {formatNGN(item.revenue)}
                      </div>
                    </div>
                  </div>
                  <Badge variant={item.percentage >= 15 ? 'accent' : item.percentage >= 10 ? 'brand' : 'soft'}>
                    {item.percentage.toFixed(1)}%
                  </Badge>
                </div>
                <div className="mt-3 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full',
                      i === 0 ? 'bg-accent-500' : i === 1 ? 'bg-brand-500' : 'bg-brand-400'
                    )}
                    style={{ width: `${Math.min(100, item.percentage * 4.5)}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader padded>
          <div>
            <CardTitle>Latest Orders</CardTitle>
            <p className="text-sm text-slate-500 mt-0.5">Most recent 8 orders across all channels</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => window.location.href = '/orders'}>
            View all orders
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 ml-0.5">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </Button>
        </CardHeader>
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-slate-100 bg-slate-50/60 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-5 py-3 whitespace-nowrap">Order</th>
                <th className="px-5 py-3 whitespace-nowrap">Table</th>
                <th className="px-5 py-3 whitespace-nowrap">Channel</th>
                <th className="px-5 py-3 whitespace-nowrap">Items</th>
                <th className="px-5 py-3 whitespace-nowrap">Customer</th>
                <th className="px-5 py-3 whitespace-nowrap">Status</th>
                <th className="px-5 py-3 whitespace-nowrap text-right">Total</th>
                <th className="px-5 py-3 whitespace-nowrap text-right">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-5 py-16 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <svg className="animate-spin h-7 w-7 text-brand-600" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                        <path fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" className="opacity-75" />
                      </svg>
                      <span className="text-sm text-slate-500">Loading orders...</span>
                    </div>
                  </td>
                </tr>
              ) : (
                orders.map((o) => {
                  const sc = ORDER_STATUS_COLORS[o.status] || ORDER_STATUS_COLORS.PENDING;
                  const channelBadge: any = {
                    QR: { variant: 'brand', label: 'QR' },
                    POS: { variant: 'success', label: 'POS' },
                    WEBSITE: { variant: 'info', label: 'Web' },
                    APP: { variant: 'accent', label: 'App' },
                    PHONE: { variant: 'warning', label: 'Phone' },
                  };
                  const ch = channelBadge[o.sourceChannel as any] || { variant: 'soft', label: o.sourceChannel };
                  return (
                    <tr key={o.id} className="hover:bg-brand-50/30 transition-colors cursor-pointer" onClick={() => (window.location.href = `/orders`)}>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <div className="font-semibold text-slate-900 font-mono">{o.orderNumber}</div>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-slate-700">{o.tableName || '—'}</td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <Badge variant={ch.variant}>{ch.label}</Badge>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-slate-600 tabular-nums">
                        {(o.items as any)?.length ?? 0} items
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-slate-700">
                        <span className="font-medium">{o.customerName || '—'}</span>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <Badge variant={sc.variant} dot>{sc.label}</Badge>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-right">
                        <span className="font-semibold text-slate-900 tabular-nums">{formatNGN(o.totalAmount)}</span>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-right text-slate-500 text-xs">
                        {formatRelativeTime(o.createdAt)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
