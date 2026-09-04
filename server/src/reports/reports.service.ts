import {
  Injectable,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as S from '@prolific/shared-types';
import { Order } from '../orders/schemas/order.schema';
import { Payment } from '../payments/schemas/payment.schema';
import { InventoryItem } from '../inventory/schemas/inventory-item.schema';
import { Shift } from '../shifts/schemas/shift.schema';
import { Employee } from '../employees/schemas/employee.schema';
import { User } from '../users/schemas/user.schema';
import type { AuthContext } from '../common/decorators/current-user.decorator';

export interface SalesDashboardResult {
  salesTodayCents: number;
  ordersToday: number;
  ordersPendingCount: number;
  averageOrderValueCents: number;
  sales7DaysCents: number[];
  orders7Days: number[];
  labels7Days: string[];
  salesMonthToDateCents: number;
  salesPreviousMonthCents: number;
  topMenuItems: Array<{
    menuItemId: string;
    name: string;
    qtySold: number;
    totalCents: number;
    percentage: number;
  }>;
  paymentBreakdown: Array<{
    method: string;
    totalCents: number;
    count: number;
  }>;
  lowStockAlerts: Array<{
    inventoryItemId: string;
    name: string;
    currentQty: number;
    unit: S.Unit;
    minQty: number;
    deficit: number;
  }>;
}

export interface SalesReportRow {
  period: string;
  periodLabel: string; // Human readable label, e.g. "Mon, Sep 1" or "Week of Sep 1"
  startDate: string; // ISO YYYY-MM-DD
  endDate: string;   // ISO YYYY-MM-DD
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  tipCents: number;
  refundCents: number;
  voidCents: number;
  totalCents: number;
  orderCount: number;
  voidCount: number;
  refundCount: number;
  aovCents: number;
}

export interface ListSalesReportFilters {
  groupBy: 'day' | 'week' | 'month';
  dateFrom: Date;
  dateTo: Date;
  branchId?: string;
  sourceChannel?: string; // Order.source: POS | QR | WEBSITE | APP | PHONE
  basis?: 'payments' | 'orders';
  cursor?: string;
  limit?: number;
}

export interface PaginatedSalesReportResult {
  data: SalesReportRow[];
  summary: {
    orderCount: number;
    voidCount: number;
    refundCount: number;
    subtotalCents: number;
    discountCents: number;
    taxCents: number;
    tipCents: number;
    refundCents: number;
    voidCents: number;
    totalCents: number;
    aovCents: number;
  };
  paymentBreakdown: Array<{ method: string; totalCents: number; count: number }>;
  meta: {
    cursor: string | null;
    count: number;
    hasMore: boolean;
  };
}

export interface ListPaymentsReportFilters {
  method?: string;
  status?: S.PaymentStatus;
  provider?: string;
  dateFrom?: Date;
  dateTo?: Date;
  cursor?: string;
  limit?: number;
}

export interface PaginatedPaymentsReportResult<T> {
  data: T[];
  meta: {
    cursor: string | null;
    count: number;
    hasMore: boolean;
  };
}

export interface InventoryReportRow {
  inventoryItemId: string;
  sku?: string;
  name: string;
  category?: string;
  unit: S.Unit;
  currentQty: number;
  minQty: number;
  unitCostCents: number;
  totalValueCents: number;
  lastPurchaseDate?: Date;
  isLowStock: boolean;
  supplierId?: string;
}

export interface CashierReportRow {
  employeeId: string;
  employeeName: string;
  role: S.Role;
  ordersOpened: number;
  paymentsCollectedCents: number;
  paymentsCount: number;
  voidCount: number;
  refundCount: number;
  shiftOpen?: Date;
  shiftClose?: Date;
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<Order>,
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    @InjectModel(InventoryItem.name) private readonly inventoryItemModel: Model<InventoryItem>,
    @InjectModel(Shift.name) private readonly shiftModel: Model<Shift>,
    @InjectModel(Employee.name) private readonly employeeModel: Model<Employee>,
    @InjectModel(User.name) private readonly userModel: Model<User>
  ) {}

  private resolveBranchId(ctx: AuthContext, branchIdParam?: string): string {
    const isSuperAdmin = ctx.role === S.Role.SUPER_ADMIN;
    const branchId = ctx.branchId || branchIdParam || null;
    if (isSuperAdmin && !ctx.branchId && !branchIdParam) {
      throw new BadRequestException('branchId query param is required for SUPER_ADMIN without branch context');
    }
    if (!branchId) {
      throw new BadRequestException('Branch context required');
    }
    return branchId;
  }

  async getDashboardStats(
    ctx: AuthContext,
    opts: { branchId?: string } = {}
  ): Promise<{
    todaySales: number;
    todayOrders: number;
    pendingOrders: number;
    aov: number;
    mtdSales: number;
    priorMtdSales: number;
    lowStockCount: number;
  }> {
    const branchId = this.resolveBranchId(ctx, opts.branchId);

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfPreviousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfPreviousMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    const completedStatuses = [S.OrderStatus.COMPLETED];

    const todayOrders = await this.orderModel
      .find({
        branchId,
        createdAt: { $gte: startOfToday, $lte: now },
        status: { $in: completedStatuses },
      })
      .exec();

    const todaySales = todayOrders.reduce((acc, o) => acc + o.totalCents, 0);
    const todayOrdersCount = todayOrders.length;

    const ordersPending = await this.orderModel
      .countDocuments({
        branchId,
        status: {
          $in: [
            S.OrderStatus.PENDING,
            S.OrderStatus.AWAITING_PAYMENT,
            S.OrderStatus.RECEIVED,
            S.OrderStatus.ACCEPTED,
            S.OrderStatus.PREPARING,
            S.OrderStatus.READY,
            S.OrderStatus.SERVED,
          ],
        },
      })
      .exec();

    const rangeStart = startOfToday;
    const allCompletedInRange = await this.orderModel
      .find({
        branchId,
        createdAt: { $gte: rangeStart, $lte: now },
        status: { $in: completedStatuses },
      })
      .exec();

    const aov =
      allCompletedInRange.length > 0
        ? Math.floor(
            allCompletedInRange.reduce((acc, o) => acc + o.totalCents, 0) /
              allCompletedInRange.length
          )
        : 0;

    const mtdOrders = await this.orderModel
      .find({
        branchId,
        createdAt: { $gte: startOfMonth, $lte: now },
        status: { $in: completedStatuses },
      })
      .exec();
    const mtdSales = mtdOrders.reduce((acc, o) => acc + o.totalCents, 0);

    const prevMonthOrders = await this.orderModel
      .find({
        branchId,
        createdAt: { $gte: startOfPreviousMonth, $lte: endOfPreviousMonth },
        status: { $in: completedStatuses },
      })
      .exec();
    const priorMtdSales = prevMonthOrders.reduce((acc, o) => acc + o.totalCents, 0);

    const lowStockItems = await this.inventoryItemModel
      .find({
        branchId,
        isActive: true,
        $expr: { $lte: ['$currentStockLevel', '$minimumStockLevel'] },
      })
      .exec();

    return {
      todaySales,
      todayOrders: todayOrdersCount,
      pendingOrders: ordersPending,
      aov,
      mtdSales,
      priorMtdSales,
      lowStockCount: lowStockItems.length,
    };
  }

  async getDashboardSales7d(
    ctx: AuthContext,
    opts: { branchId?: string } = {}
  ): Promise<Array<{ day: string; sales: number; orders: number }>> {
    const branchId = this.resolveBranchId(ctx, opts.branchId);

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOf7DaysAgo = new Date(startOfToday);
    startOf7DaysAgo.setDate(startOf7DaysAgo.getDate() - 6);

    const completedStatuses = [S.OrderStatus.COMPLETED];
    const allCompletedInRange = await this.orderModel
      .find({
        branchId,
        createdAt: { $gte: startOf7DaysAgo, $lte: now },
        status: { $in: completedStatuses },
      })
      .exec();

    const result: Array<{ day: string; sales: number; orders: number }> = [];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (let i = 0; i < 7; i++) {
      const d = new Date(startOf7DaysAgo);
      d.setDate(d.getDate() + i);
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
      const dayOrders = allCompletedInRange.filter(
        (o) => {
          const created = (o as any).createdAt as Date;
          return created >= dayStart && created <= dayEnd;
        }
      );
      result.push({
        day: dayNames[d.getDay()],
        sales: dayOrders.reduce((acc, o) => acc + o.totalCents, 0),
        orders: dayOrders.length,
      });
    }
    return result;
  }

  async getDashboardTopItems(
    ctx: AuthContext,
    opts: { branchId?: string } = {}
  ): Promise<Array<{ name: string; quantity: number; revenue: number; percentage: number }>> {
    const branchId = this.resolveBranchId(ctx, opts.branchId);

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOf7DaysAgo = new Date(startOfToday);
    startOf7DaysAgo.setDate(startOf7DaysAgo.getDate() - 6);

    const completedStatuses = [S.OrderStatus.COMPLETED];
    const allCompletedInRange = await this.orderModel
      .find({
        branchId,
        createdAt: { $gte: startOf7DaysAgo, $lte: now },
        status: { $in: completedStatuses },
      })
      .exec();

    const menuItemQtyMap = new Map<string, { name: string; qty: number; total: number }>();
    for (const order of allCompletedInRange) {
      for (const item of order.items) {
        if (item.isVoided) continue;
        const existing = menuItemQtyMap.get(item.menuItemId);
        if (existing) {
          existing.qty += item.quantity;
          existing.total += item.totalCents;
        } else {
          menuItemQtyMap.set(item.menuItemId, {
            name: item.menuItemName,
            qty: item.quantity,
            total: item.totalCents,
          });
        }
      }
    }
    const totalSoldCents = Array.from(menuItemQtyMap.values()).reduce(
      (acc, v) => acc + v.total,
      0
    );
    return Array.from(menuItemQtyMap.entries())
      .map(([, v]) => ({
        name: v.name,
        quantity: v.qty,
        revenue: v.total,
        percentage: totalSoldCents > 0 ? Math.round((v.total / totalSoldCents) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);
  }

  async getSalesDashboard(
    ctx: AuthContext,
    opts: { dateFrom?: Date; dateTo?: Date; branchId?: string } = {}
  ): Promise<SalesDashboardResult> {
    const branchId = this.resolveBranchId(ctx, opts.branchId);

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOf7DaysAgo = new Date(startOfToday);
    startOf7DaysAgo.setDate(startOf7DaysAgo.getDate() - 6);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfPreviousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfPreviousMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    const rangeStart = opts.dateFrom ?? startOf7DaysAgo;
    const rangeEnd = opts.dateTo ?? now;

    const completedStatuses = [S.OrderStatus.COMPLETED];
    const paidPaymentStatuses = [S.PaymentStatus.PAID];

    const todayOrders = await this.orderModel
      .find({
        branchId,
        createdAt: { $gte: startOfToday, $lte: now },
        status: { $in: completedStatuses },
      })
      .exec();

    const salesTodayCents = todayOrders.reduce((acc, o) => acc + o.totalCents, 0);
    const ordersToday = todayOrders.length;

    const ordersPending = await this.orderModel
      .countDocuments({
        branchId,
        status: {
          $in: [
            S.OrderStatus.PENDING,
            S.OrderStatus.AWAITING_PAYMENT,
            S.OrderStatus.RECEIVED,
            S.OrderStatus.ACCEPTED,
            S.OrderStatus.PREPARING,
            S.OrderStatus.READY,
            S.OrderStatus.SERVED,
          ],
        },
      })
      .exec();
    const ordersPendingCount = ordersPending;

    const allCompletedInRange = await this.orderModel
      .find({
        branchId,
        createdAt: { $gte: rangeStart, $lte: rangeEnd },
        status: { $in: completedStatuses },
      })
      .exec();

    const averageOrderValueCents =
      allCompletedInRange.length > 0
        ? Math.floor(
            allCompletedInRange.reduce((acc, o) => acc + o.totalCents, 0) /
              allCompletedInRange.length
          )
        : 0;

    const sales7DaysCents: number[] = [];
    const orders7Days: number[] = [];
    const labels7Days: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(startOf7DaysAgo);
      d.setDate(d.getDate() + i);
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
      const dayOrders = allCompletedInRange.filter(
        (o) => {
          const created = (o as any).createdAt as Date;
          return created >= dayStart && created <= dayEnd;
        }
      );
      sales7DaysCents.push(dayOrders.reduce((acc, o) => acc + o.totalCents, 0));
      orders7Days.push(dayOrders.length);
      labels7Days.push(
        `${d.getMonth() + 1}/${d.getDate()}`
      );
    }

    const mtdOrders = await this.orderModel
      .find({
        branchId,
        createdAt: { $gte: startOfMonth, $lte: now },
        status: { $in: completedStatuses },
      })
      .exec();
    const salesMonthToDateCents = mtdOrders.reduce((acc, o) => acc + o.totalCents, 0);

    const prevMonthOrders = await this.orderModel
      .find({
        branchId,
        createdAt: { $gte: startOfPreviousMonth, $lte: endOfPreviousMonth },
        status: { $in: completedStatuses },
      })
      .exec();
    const salesPreviousMonthCents = prevMonthOrders.reduce((acc, o) => acc + o.totalCents, 0);

    const menuItemQtyMap = new Map<string, { name: string; qty: number; total: number }>();
    for (const order of allCompletedInRange) {
      for (const item of order.items) {
        if (item.isVoided) continue;
        const existing = menuItemQtyMap.get(item.menuItemId);
        if (existing) {
          existing.qty += item.quantity;
          existing.total += item.totalCents;
        } else {
          menuItemQtyMap.set(item.menuItemId, {
            name: item.menuItemName,
            qty: item.quantity,
            total: item.totalCents,
          });
        }
      }
    }
    const totalSoldCents = Array.from(menuItemQtyMap.values()).reduce(
      (acc, v) => acc + v.total,
      0
    );
    const topMenuItems = Array.from(menuItemQtyMap.entries())
      .map(([menuItemId, v]) => ({
        menuItemId,
        name: v.name,
        qtySold: v.qty,
        totalCents: v.total,
        percentage: totalSoldCents > 0 ? Math.round((v.total / totalSoldCents) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.qtySold - a.qtySold)
      .slice(0, 5);

    const paymentsInRange = await this.paymentModel
      .find({
        branchId,
        completedAt: { $gte: rangeStart, $lte: rangeEnd },
        status: { $in: paidPaymentStatuses },
      })
      .exec();
    const paymentMap = new Map<string, { total: number; count: number }>();
    for (const p of paymentsInRange) {
      const existing = paymentMap.get(p.method);
      if (existing) {
        existing.total += p.amountCents;
        existing.count += 1;
      } else {
        paymentMap.set(p.method, { total: p.amountCents, count: 1 });
      }
    }
    const paymentBreakdown = Array.from(paymentMap.entries()).map(([method, v]) => ({
      method,
      totalCents: v.total,
      count: v.count,
    }));

    const lowStockItems = await this.inventoryItemModel
      .find({
        branchId,
        isActive: true,
        $expr: { $lte: ['$currentStockLevel', '$minimumStockLevel'] },
      })
      .exec();
    const lowStockAlerts = lowStockItems.map((item) => ({
      inventoryItemId: item._id.toString(),
      name: item.name,
      currentQty: item.currentStockLevel,
      unit: item.unit,
      minQty: item.minimumStockLevel ?? 0,
      deficit: Math.max(0, (item.minimumStockLevel ?? 0) - item.currentStockLevel),
    }));

    return {
      salesTodayCents,
      ordersToday,
      ordersPendingCount,
      averageOrderValueCents,
      sales7DaysCents,
      orders7Days,
      labels7Days,
      salesMonthToDateCents,
      salesPreviousMonthCents,
      topMenuItems,
      paymentBreakdown,
      lowStockAlerts,
    };
  }

  async getSalesReport(
    ctx: AuthContext,
    filters: ListSalesReportFilters
  ): Promise<PaginatedSalesReportResult> {
    const branchId = this.resolveBranchId(ctx, filters.branchId);

    const limit = Math.min(filters.limit ?? 50, 100);
    const { dateFrom, dateTo, groupBy } = filters;
    const basis = filters.basis === 'orders' ? 'orders' : 'payments';
    const sourceChannel = filters.sourceChannel?.trim?.() || '';

    // -----------------------------------------------------------------------
    // Phase 1: Identify PAID orders in the period. For PAYMENTS basis we start
    // from the payments table (completedAt bounded by the date range), then
    // walk back to their orders. For ORDERS basis we start directly from
    // orders that were both created in the window and have a PAID status.
    // -----------------------------------------------------------------------

    const paidAtByOrderId = new Map<string, Date>();

    if (basis === 'payments') {
      const paymentsInRange = await this.paymentModel
        .find({
          branchId,
          status: S.PaymentStatus.PAID,
          completedAt: { $gte: dateFrom, $lte: dateTo },
        } as any)
        .select({ orderId: 1, completedAt: 1 })
        .exec();

      for (const p of paymentsInRange as unknown as Array<{ orderId: any; completedAt?: Date }>) {
        const oid = p.orderId ? String(p.orderId) : '';
        const ts = p.completedAt ? new Date(p.completedAt) : null;
        if (!oid || !ts) continue;
        // For split payments (1 order → N payments), remember the LATEST
        // completed payment timestamp so the order is bucketed by when the
        // customer finished paying, not the first instalment.
        const existing = paidAtByOrderId.get(oid);
        if (!existing || existing.getTime() < ts.getTime()) {
          paidAtByOrderId.set(oid, ts);
        }
      }
    }

    const ordersQuery: Record<string, unknown> = { branchId };
    if (basis === 'orders') {
      ordersQuery.createdAt = { $gte: dateFrom, $lte: dateTo };
      ordersQuery.paymentStatus = S.PaymentStatus.PAID;
    } else {
      const paidIds = Array.from(paidAtByOrderId.keys());
      if (paidIds.length === 0) {
        // No paid payments in range → short-circuit; nothing further to do.
        // Return an empty response to avoid a Mongo find with $in:[] → full scan.
        const emptyRow: SalesReportRow[] = [];
        const emptySummary: PaginatedSalesReportResult['summary'] = {
          orderCount: 0,
          voidCount: 0,
          refundCount: 0,
          subtotalCents: 0,
          discountCents: 0,
          taxCents: 0,
          tipCents: 0,
          refundCents: 0,
          voidCents: 0,
          totalCents: 0,
          aovCents: 0,
        };
        return {
          data: [],
          summary: emptySummary,
          paymentBreakdown: [],
          meta: { cursor: null, count: 0, hasMore: false },
        };
      }
      ordersQuery._id = { $in: paidIds.map((id) => new Types.ObjectId(id)) };
    }
    if (sourceChannel) ordersQuery.source = sourceChannel;

    const ordersInRange = await this.orderModel.find(ordersQuery as any).exec();

    // -----------------------------------------------------------------------
    // Phase 2: Voids + refunds. We ALSO walk these statuses so the report can
    // show negative-line adjustments (not a "silent exclude" which hides
    // mistakes from the owner / accountant).
    // -----------------------------------------------------------------------
    const refundsVoidsQuery: Record<string, unknown> = {
      branchId,
      status: { $in: [S.OrderStatus.VOIDED, S.OrderStatus.REFUNDED] },
    };
    if (sourceChannel) refundsVoidsQuery.source = sourceChannel;
    if (basis === 'orders') {
      refundsVoidsQuery.createdAt = { $gte: dateFrom, $lte: dateTo };
    } else if (paidAtByOrderId.size > 0) {
      refundsVoidsQuery._id = {
        $in: Array.from(paidAtByOrderId.keys()).map((id) => new Types.ObjectId(id)),
      };
    } else {
      refundsVoidsQuery.createdAt = { $gte: dateFrom, $lte: dateTo };
    }
    const voidsRefundsOrders = await this.orderModel.find(refundsVoidsQuery as any).exec();

    // -----------------------------------------------------------------------
    // Phase 3: Payment-method breakdown (CASH / CARD / ONLINE_PAYSTACK …).
    // Used in the Admin UI to render the Method mix section.
    // -----------------------------------------------------------------------
    const breakdownQuery: Record<string, unknown> = {
      branchId,
      status: S.PaymentStatus.PAID,
      completedAt: { $gte: dateFrom, $lte: dateTo },
    };
    if (sourceChannel) {
      const ordersForSource = await this.orderModel
        .find({ branchId, source: sourceChannel })
        .select({ _id: 1 })
        .lean()
        .exec();
      const idsForSource = ordersForSource
        .map((o) => (o as any)._id?.toString?.() || String((o as any)._id))
        .filter(Boolean);
      breakdownQuery.orderId = { $in: idsForSource };
    }
    const breakdownPayments = await this.paymentModel
      .find(breakdownQuery as any)
      .select({ method: 1, amountCents: 1 })
      .exec();
    const breakdownMap = new Map<string, { total: number; count: number }>();
    for (const p of breakdownPayments as any as Array<{ method: string; amountCents: number }>) {
      const m = String(p.method || 'OTHER');
      const ex = breakdownMap.get(m);
      if (ex) {
        ex.total += Number(p.amountCents || 0);
        ex.count += 1;
      } else {
        breakdownMap.set(m, { total: Number(p.amountCents || 0), count: 1 });
      }
    }
    const paymentBreakdown = Array.from(breakdownMap.entries()).map(([method, v]) => ({
      method,
      totalCents: v.total,
      count: v.count,
    }));

    // -----------------------------------------------------------------------
    // Phase 4: Date bucketing helpers.
    // -----------------------------------------------------------------------
    const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const iso = (dt: Date) =>
      `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

    const periodFor = (d: Date) => {
      const y = d.getFullYear();
      const m = d.getMonth();
      const day = d.getDate();
      if (groupBy === 'day') {
        const start = new Date(y, m, day);
        const end = new Date(y, m, day);
        return {
          key: `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
          label: `${DAY_NAMES[d.getDay()]}, ${MONTH_NAMES[m]} ${day}`,
          startDate: iso(start),
          endDate: iso(end),
        };
      }
      if (groupBy === 'week') {
        const start = new Date(y, m, day - d.getDay());
        const end = new Date(y, m, day - d.getDay() + 6);
        return {
          key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`,
          label: `Week of ${MONTH_NAMES[start.getMonth()]} ${start.getDate()}`,
          startDate: iso(start),
          endDate: iso(end),
        };
      }
      // month
      const start = new Date(y, m, 1);
      const end = new Date(y, m + 1, 0);
      return {
        key: `${y}-${String(m + 1).padStart(2, '0')}`,
        label: `${MONTH_NAMES[m]} ${y}`,
        startDate: iso(start),
        endDate: iso(end),
      };
    };

    type Bucket = {
      periodLabel: string;
      startDate: string;
      endDate: string;
      subtotalCents: number;
      discountCents: number;
      taxCents: number;
      tipCents: number;
      refundCents: number;
      voidCents: number;
      totalCents: number;
      orderCount: number;
      voidCount: number;
      refundCount: number;
    };
    const periodMap = new Map<string, Bucket>();
    const emptyBucket = (label: string, start: string, end: string): Bucket => ({
      periodLabel: label,
      startDate: start,
      endDate: end,
      subtotalCents: 0,
      discountCents: 0,
      taxCents: 0,
      tipCents: 0,
      refundCents: 0,
      voidCents: 0,
      totalCents: 0,
      orderCount: 0,
      voidCount: 0,
      refundCount: 0,
    });
    const getBucket = (d: Date) => {
      const p = periodFor(d);
      if (!periodMap.has(p.key)) periodMap.set(p.key, emptyBucket(p.label, p.startDate, p.endDate));
      return { key: p.key, bucket: periodMap.get(p.key)! };
    };

    // Count orders already tracked for void/refund dedupe. If an order was
    // already in the PAID set (shouldn't happen due to status), we still
    // dedupe by id so a single order can't be double-counted.
    const countedOrderIds = new Set<string>();

    // -----------------------------------------------------------------------
    // Phase 5: Apply orders/sales.
    // -----------------------------------------------------------------------
    for (const order of ordersInRange) {
      const oidRaw = String((order as any)._id?.toString?.() ?? String((order as any)._id));
      if (countedOrderIds.has(oidRaw)) continue;
      countedOrderIds.add(oidRaw);

      const paidAt = paidAtByOrderId.get(oidRaw);
      const ts: Date = paidAt ?? ((order as any).createdAt as Date);
      const { bucket } = getBucket(ts);

      const status = String(order.status);
      const totalCents = Math.max(0, Number((order as any).totalCents || 0));
      if (status === S.OrderStatus.VOIDED) {
        bucket.voidCount += 1;
        bucket.voidCents += totalCents;
        continue;
      }
      if (status === S.OrderStatus.REFUNDED) {
        bucket.refundCount += 1;
        bucket.refundCents += totalCents;
        continue;
      }
      bucket.orderCount += 1;
      bucket.subtotalCents += Math.max(0, Number((order as any).subtotalCents || 0));
      bucket.discountCents += Math.max(0, Number((order as any).discountCents || 0));
      bucket.taxCents += Math.max(0, Number((order as any).taxCents || 0));
      bucket.totalCents += totalCents;
    }

    // -----------------------------------------------------------------------
    // Phase 6: Apply voids/refunds that may not have appeared in the PAID set.
    // -----------------------------------------------------------------------
    for (const o of voidsRefundsOrders) {
      const oidRaw = String((o as any)._id?.toString?.() ?? String((o as any)._id));
      if (countedOrderIds.has(oidRaw)) continue;
      countedOrderIds.add(oidRaw);

      const paidAt = paidAtByOrderId.get(oidRaw);
      const ts: Date = paidAt ?? ((o as any).createdAt as Date);
      const { bucket } = getBucket(ts);

      const totalCents = Math.max(0, Number((o as any).totalCents || 0));
      const status = String((o as any).status);
      if (status === S.OrderStatus.VOIDED) {
        bucket.voidCount += 1;
        bucket.voidCents += totalCents;
      } else if (status === S.OrderStatus.REFUNDED) {
        bucket.refundCount += 1;
        bucket.refundCents += totalCents;
      }
    }

    // -----------------------------------------------------------------------
    // Phase 7: Flatten + paginate rows.
    // -----------------------------------------------------------------------
    const allRows: SalesReportRow[] = Array.from(periodMap.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([period, v]) => ({
        period,
        periodLabel: v.periodLabel,
        startDate: v.startDate,
        endDate: v.endDate,
        subtotalCents: v.subtotalCents,
        discountCents: v.discountCents,
        taxCents: v.taxCents,
        tipCents: v.tipCents,
        refundCents: v.refundCents,
        voidCents: v.voidCents,
        totalCents: v.totalCents,
        orderCount: v.orderCount,
        voidCount: v.voidCount,
        refundCount: v.refundCount,
        aovCents: v.orderCount > 0 ? Math.floor(v.totalCents / v.orderCount) : 0,
      }));

    let startIdx = 0;
    if (filters.cursor) {
      try {
        const decoded = Buffer.from(filters.cursor, 'base64').toString('utf-8');
        const parsed = JSON.parse(decoded);
        const idx = allRows.findIndex((r) => r.period === parsed.period);
        if (idx >= 0) startIdx = idx + 1;
      } catch {
        throw new BadRequestException('Invalid cursor');
      }
    }
    const sliced = allRows.slice(startIdx, startIdx + limit + 1);
    const hasMore = sliced.length > limit;
    const data = sliced.slice(0, limit);
    const count = data.length;
    let cursor: string | null = null;
    if (hasMore && data.length > 0) {
      const last = data[data.length - 1];
      cursor = Buffer.from(JSON.stringify({ period: last.period })).toString('base64');
    }

    // -----------------------------------------------------------------------
    // Phase 8: Grand totals summary (for the KPI cards) — aggregated across
    // the full date range, NOT just the current page of rows.
    // -----------------------------------------------------------------------
    const summary = (() => {
      const s = {
        orderCount: 0,
        voidCount: 0,
        refundCount: 0,
        subtotalCents: 0,
        discountCents: 0,
        taxCents: 0,
        tipCents: 0,
        refundCents: 0,
        voidCents: 0,
        totalCents: 0,
      };
      for (const r of allRows) {
        s.orderCount += r.orderCount;
        s.voidCount += r.voidCount;
        s.refundCount += r.refundCount;
        s.subtotalCents += r.subtotalCents;
        s.discountCents += r.discountCents;
        s.taxCents += r.taxCents;
        s.tipCents += r.tipCents;
        s.refundCents += r.refundCents;
        s.voidCents += r.voidCents;
        s.totalCents += r.totalCents;
      }
      const aovCents = s.orderCount > 0 ? Math.floor(s.totalCents / s.orderCount) : 0;
      return { ...s, aovCents };
    })();

    return {
      data,
      summary,
      paymentBreakdown,
      meta: {
        cursor,
        count,
        hasMore,
      },
    };
  }

  async getPaymentsReport(
    ctx: AuthContext,
    filters: ListPaymentsReportFilters = {}
  ): Promise<PaginatedPaymentsReportResult<Payment>> {
    const branchId = ctx.branchId;
    if (!branchId) {
      throw new BadRequestException('Branch context required');
    }

    const limit = Math.min(filters.limit ?? 50, 100);
    const query: Record<string, unknown> = { branchId };

    if (filters.method) query.method = filters.method;
    if (filters.status) query.status = filters.status;
    if (filters.provider) query.provider = filters.provider;
    if (filters.dateFrom || filters.dateTo) {
      query.completedAt = {} as Record<string, Date>;
      if (filters.dateFrom) {
        (query.completedAt as Record<string, Date>).$gte = filters.dateFrom;
      }
      if (filters.dateTo) {
        (query.completedAt as Record<string, Date>).$lte = filters.dateTo;
      }
    }

    if (filters.cursor) {
      try {
        const decoded = Buffer.from(filters.cursor, 'base64').toString('utf-8');
        const parsed = JSON.parse(decoded);
        if (parsed._id && (parsed.createdAt || parsed.completedAt)) {
          const tsField = parsed.completedAt ? 'completedAt' : 'createdAt';
          const tsValue = parsed.completedAt || parsed.createdAt;
          query.$or = [
            { [tsField]: { $lt: new Date(tsValue) } },
            {
              [tsField]: { $eq: new Date(tsValue) },
              _id: { $lt: new Types.ObjectId(parsed._id) },
            },
          ];
        }
      } catch (_e) {
        throw new BadRequestException('Invalid cursor');
      }
    }

    const docs = await this.paymentModel
      .find(query)
      .sort({ completedAt: -1, createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .exec();

    const hasMore = docs.length > limit;
    const data = docs.slice(0, limit);
    const count = data.length;

    let cursor: string | null = null;
    if (hasMore && data.length > 0) {
      const last = data[data.length - 1] as unknown as {
        _id: Types.ObjectId;
        completedAt?: Date;
        createdAt: Date;
      };
      cursor = Buffer.from(
        JSON.stringify({
          _id: last._id.toString(),
          completedAt: last.completedAt?.toISOString(),
          createdAt: last.createdAt.toISOString(),
        })
      ).toString('base64');
    }

    return {
      data,
      meta: {
        cursor,
        count,
        hasMore,
      },
    };
  }

  async getInventoryReport(
    ctx: AuthContext,
    opts: { includeLowStock: boolean; branchId?: string } = { includeLowStock: false }
  ): Promise<InventoryReportRow[]> {
    const branchId = this.resolveBranchId(ctx, opts.branchId);

    const query: Record<string, unknown> = { branchId, isActive: true };
    if (opts.includeLowStock) {
      query.$expr = { $lte: ['$currentStockLevel', '$minimumStockLevel'] };
    }

    const items = await this.inventoryItemModel.find(query).sort({ name: 1 }).exec();

    return items.map((item) => {
      const currentQty = item.currentStockLevel;
      const minQty = item.minimumStockLevel ?? 0;
      return {
        inventoryItemId: item._id.toString(),
        sku: item.sku,
        name: item.name,
        category: item.category,
        unit: item.unit,
        currentQty,
        minQty,
        unitCostCents: item.unitCostCents,
        totalValueCents: currentQty * item.unitCostCents,
        lastPurchaseDate: item.lastCountedAt,
        isLowStock: currentQty <= minQty,
        supplierId: item.preferredSupplierId,
      };
    });
  }

  async getCashierReport(
    ctx: AuthContext,
    opts: { from: Date; to: Date; basis?: 'payments' | 'orders' }
  ): Promise<CashierReportRow[]> {
    const branchId = ctx.branchId;
    if (!branchId) {
      throw new BadRequestException('Branch context required');
    }

    const { from, to } = opts;
    const basis = opts.basis === 'orders' ? 'orders' : 'payments';

    const [ordersInRange, paymentsInRange] = await Promise.all([
      this.orderModel
        .find({
          branchId,
          createdAt: { $gte: from, $lte: to },
        })
        .exec(),
      basis === 'payments'
        ? this.paymentModel
            .find({
              branchId,
              completedAt: { $gte: from, $lte: to },
              status: S.PaymentStatus.PAID,
            })
            .exec()
        : Promise.resolve([] as any[]),
    ]);

    const shiftsInRange = await this.shiftModel
      .find({
        branchId,
        openingTimestamp: { $gte: from, $lte: to },
      })
      .exec();

    const employeeMap = new Map<
      string,
      {
        ordersOpened: Set<string>;
        paymentsCollected: number;
        paymentsCount: number;
        voidCount: number;
        refundCount: number;
        shiftOpen?: Date;
        shiftClose?: Date;
      }
    >();

    for (const order of ordersInRange) {
      const eid = order.employeeId;
      if (!eid) continue;
      if (!employeeMap.has(eid)) {
        employeeMap.set(eid, {
          ordersOpened: new Set(),
          paymentsCollected: 0,
          paymentsCount: 0,
          voidCount: 0,
          refundCount: 0,
        });
      }
      const entry = employeeMap.get(eid)!;
      entry.ordersOpened.add(order._id.toString());
      if (order.status === S.OrderStatus.VOIDED) entry.voidCount += 1;
      if (order.status === S.OrderStatus.REFUNDED) entry.refundCount += 1;
    }

    if (basis === 'payments') {
      for (const payment of paymentsInRange) {
        const eid = payment.employeeId;
        if (!eid) continue;
        if (!employeeMap.has(eid)) {
          employeeMap.set(eid, {
            ordersOpened: new Set(),
            paymentsCollected: 0,
            paymentsCount: 0,
            voidCount: 0,
            refundCount: 0,
          });
        }
        const entry = employeeMap.get(eid)!;
        entry.paymentsCollected += payment.amountCents;
        entry.paymentsCount += 1;
      }
    } else {
      for (const order of ordersInRange) {
        if (order.paymentStatus !== S.PaymentStatus.PAID) continue;
        const eid = order.employeeId;
        if (!eid) continue;
        if (!employeeMap.has(eid)) {
          employeeMap.set(eid, {
            ordersOpened: new Set(),
            paymentsCollected: 0,
            paymentsCount: 0,
            voidCount: 0,
            refundCount: 0,
          });
        }
        const entry = employeeMap.get(eid)!;
        entry.paymentsCollected += order.totalCents;
        entry.paymentsCount += 1;
      }
    }

    for (const shift of shiftsInRange) {
      const eid = shift.employeeId;
      if (!employeeMap.has(eid)) {
        employeeMap.set(eid, {
          ordersOpened: new Set(),
          paymentsCollected: 0,
          paymentsCount: 0,
          voidCount: 0,
          refundCount: 0,
        });
      }
      const entry = employeeMap.get(eid)!;
      if (!entry.shiftOpen || shift.openingTimestamp < entry.shiftOpen) {
        entry.shiftOpen = shift.openingTimestamp;
      }
      if (shift.closingTimestamp) {
        if (!entry.shiftClose || shift.closingTimestamp > entry.shiftClose) {
          entry.shiftClose = shift.closingTimestamp;
        }
      }
    }

    const employeeIds = Array.from(employeeMap.keys());
    const employees = employeeIds.length
      ? await this.employeeModel.find({ _id: { $in: employeeIds }, branchId }).exec()
      : [];
    const employeeById = new Map<string, any>();
    employees.forEach((e: any) => employeeById.set(String(e._id), e));
    const userIds = Array.from(
      new Set(
        employees
          .map((e: any) => String(e.userId || ''))
          .filter((id: string) => Boolean(id))
      )
    );
    const users = userIds.length ? await this.userModel.find({ _id: { $in: userIds } }).exec() : [];
    const userById = new Map<string, any>();
    users.forEach((u: any) => userById.set(String(u._id), u));

    const result: CashierReportRow[] = [];
    for (const [employeeId, entry] of employeeMap.entries()) {
      const emp = employeeById.get(employeeId) || null;
      const user = emp?.userId ? userById.get(String(emp.userId)) : null;
      const employeeName = user ? `${String(user.firstName || '')} ${String(user.lastName || '')}`.trim() : '';
      result.push({
        employeeId,
        employeeName,
        role: (emp?.role as S.Role) || S.Role.CASHIER,
        ordersOpened: entry.ordersOpened.size,
        paymentsCollectedCents: entry.paymentsCollected,
        paymentsCount: entry.paymentsCount,
        voidCount: entry.voidCount,
        refundCount: entry.refundCount,
        shiftOpen: entry.shiftOpen,
        shiftClose: entry.shiftClose,
      });
    }

    result.sort((a, b) => b.paymentsCollectedCents - a.paymentsCollectedCents);
    return result;
  }
}
