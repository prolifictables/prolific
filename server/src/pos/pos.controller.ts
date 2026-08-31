import { Controller, Get, HttpCode, UseGuards, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as S from '@prolific/shared-types';
import { CurrentUser, AuthContext } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequiredPermissions } from '../common/decorators/permissions.decorator';
import { TablesService } from '../tables/tables.service';
import { Employee } from '../employees/schemas/employee.schema';
import { User } from '../users/schemas/user.schema';

@Controller('pos')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PosController {
  constructor(
    @InjectModel(Employee.name) private readonly employeeModel: Model<Employee>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly tablesService: TablesService
  ) {}

  @Get('bootstrap')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.MENU_VIEW, S.Permission.TABLE_VIEW)
  async bootstrap(@CurrentUser() ctx: AuthContext) {
    const branchId = ctx.branchId;
    if (!branchId) throw new BadRequestException('Branch context required');

    const [employeeDocs, tables] = await Promise.all([
      this.employeeModel
        .find({ branchId })
        .sort({ createdAt: -1 })
        .limit(500)
        .lean()
        .exec(),
      this.tablesService.listTables(ctx, {}),
    ]);

    const userIds = Array.from(
      new Set(employeeDocs.map((e: any) => String(e.userId || '')).filter(Boolean))
    );
    const users = userIds.length
      ? await this.userModel.find({ _id: { $in: userIds } }).lean().exec()
      : [];
    const userById = new Map<string, any>();
    users.forEach((u: any) => userById.set(String(u._id), u));

    const employees = employeeDocs.map((e: any) => {
      const u = e.userId ? userById.get(String(e.userId)) : null;
      return {
        id: e._id?.toString?.() || String(e._id),
        userId: e.userId?.toString?.() || String(e.userId || ''),
        restaurantId: String(e.restaurantId || ''),
        branchId: String(e.branchId || ''),
        role: e.role,
        positionTitle: e.positionTitle,
        employeeNumber: e.employeeNumber,
        pinHash: e.pin ?? null,
        isActive: true,
        joinedAt: e.joinedAt,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
        firstName: u?.firstName,
        lastName: u?.lastName,
        email: u?.email,
        phone: u?.phone,
      };
    });

    return {
      employees,
      tables,
    };
  }
}
