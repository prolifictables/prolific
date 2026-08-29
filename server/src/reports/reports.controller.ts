import {
  Controller,
  Get,
  HttpCode,
  Query,
  UseGuards,
} from '@nestjs/common';
import * as S from '@prolific/shared-types';
import {
  ReportsService,
  ListSalesReportFilters,
  ListPaymentsReportFilters,
} from './reports.service';
import {
  CurrentUser,
  AuthContext,
} from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequiredPermissions } from '../common/decorators/permissions.decorator';

@Controller('reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('dashboard/stats')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.VIEW_DASHBOARD, S.Permission.VIEW_REPORTS)
  async getDashboardStats(
    @Query() query: { branchId?: string },
    @CurrentUser() user: AuthContext
  ) {
    return this.reportsService.getDashboardStats(user, {
      branchId: query.branchId,
    });
  }

  @Get('dashboard/sales-7d')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.VIEW_DASHBOARD, S.Permission.VIEW_REPORTS)
  async getDashboardSales7d(
    @Query() query: { branchId?: string },
    @CurrentUser() user: AuthContext
  ) {
    return this.reportsService.getDashboardSales7d(user, {
      branchId: query.branchId,
    });
  }

  @Get('dashboard/top-items')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.VIEW_DASHBOARD, S.Permission.VIEW_REPORTS)
  async getDashboardTopItems(
    @Query() query: { branchId?: string },
    @CurrentUser() user: AuthContext
  ) {
    return this.reportsService.getDashboardTopItems(user, {
      branchId: query.branchId,
    });
  }

  @Get('sales-dashboard')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.VIEW_FINANCIALS, S.Permission.VIEW_REPORTS)
  async getSalesDashboard(
    @Query() query: { dateFrom?: string; dateTo?: string; branchId?: string },
    @CurrentUser() user: AuthContext
  ) {
    const opts: { dateFrom?: Date; dateTo?: Date; branchId?: string } = {};
    if (query.dateFrom) opts.dateFrom = new Date(query.dateFrom);
    if (query.dateTo) opts.dateTo = new Date(query.dateTo);
    if (query.branchId) opts.branchId = query.branchId;
    return this.reportsService.getSalesDashboard(user, opts);
  }

  @Get('sales')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.VIEW_FINANCIALS, S.Permission.VIEW_REPORTS)
  async getSalesReport(
    @Query() query: {
      groupBy: 'day' | 'week' | 'month';
      dateFrom: string;
      dateTo: string;
      branchId?: string;
      basis?: 'payments' | 'orders';
      cursor?: string;
      limit?: string;
    },
    @CurrentUser() user: AuthContext
  ) {
    const filters: ListSalesReportFilters = {
      groupBy: query.groupBy,
      dateFrom: new Date(query.dateFrom),
      dateTo: new Date(query.dateTo),
      basis: query.basis,
    };
    if (query.branchId) filters.branchId = query.branchId;
    if (query.cursor) filters.cursor = query.cursor;
    if (query.limit) filters.limit = parseInt(query.limit, 10);
    return this.reportsService.getSalesReport(user, filters);
  }

  @Get('payments')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.VIEW_FINANCIALS, S.Permission.VIEW_REPORTS)
  async getPaymentsReport(
    @Query() query: {
      method?: string;
      status?: string;
      provider?: string;
      dateFrom?: string;
      dateTo?: string;
      cursor?: string;
      limit?: string;
    },
    @CurrentUser() user: AuthContext
  ) {
    const filters: ListPaymentsReportFilters = {};
    if (query.method) filters.method = query.method;
    if (query.status) filters.status = query.status as S.PaymentStatus;
    if (query.provider) filters.provider = query.provider;
    if (query.dateFrom) filters.dateFrom = new Date(query.dateFrom);
    if (query.dateTo) filters.dateTo = new Date(query.dateTo);
    if (query.cursor) filters.cursor = query.cursor;
    if (query.limit) filters.limit = parseInt(query.limit, 10);
    return this.reportsService.getPaymentsReport(user, filters);
  }

  @Get('inventory')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.INVENTORY_VIEW, S.Permission.VIEW_REPORTS)
  async getInventoryReport(
    @Query() query: { includeLowStock?: string; branchId?: string },
    @CurrentUser() user: AuthContext
  ) {
    const includeLowStock = query.includeLowStock === 'true';
    return this.reportsService.getInventoryReport(user, { includeLowStock, branchId: query.branchId });
  }

  @Get('cashiers')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.VIEW_FINANCIALS, S.Permission.SHIFT_VIEW_ALL)
  async getCashierReport(
    @Query() query: { from: string; to: string; basis?: 'payments' | 'orders' },
    @CurrentUser() user: AuthContext
  ) {
    return this.reportsService.getCashierReport(user, {
      from: new Date(query.from),
      to: new Date(query.to),
      basis: query.basis,
    });
  }
}
