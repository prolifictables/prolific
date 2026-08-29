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
import { readFileSync } from 'fs';
import * as http from 'http';

// #region debug-point employee-create-pos-pin:pos-bootstrap
function dbgPosBootstrap(event: Record<string, unknown>) {
  try {
    const envRaw =
      process.env.DEBUG_SERVER_URL ||
      (() => {
        try {
          const candidates = [
            `${process.cwd()}/.dbg/employee-create-pos-pin.env`,
            `${process.cwd()}/../.dbg/employee-create-pos-pin.env`,
            `${process.cwd()}/../../.dbg/employee-create-pos-pin.env`,
          ];
          const envPath = candidates.find((p) => {
            try {
              readFileSync(p, 'utf-8');
              return true;
            } catch {
              return false;
            }
          });
          if (!envPath) return '';

          const raw = readFileSync(envPath, 'utf-8');
          const line = raw
            .split('\n')
            .map((l) => l.trim())
            .find((l) => l.startsWith('DEBUG_SERVER_URL='));
          return line ? line.replace('DEBUG_SERVER_URL=', '').trim() : '';
        } catch {
          return '';
        }
      })();
    if (!envRaw) return;
    const url = new URL(envRaw);
    const body = JSON.stringify({
      ts: Date.now(),
      sessionId: 'employee-create-pos-pin',
      scope: 'server.pos.bootstrap',
      ...event,
    });
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => res.resume()
    );
    req.on('error', () => {});
    req.write(body);
    req.end();
  } catch {
  }
}
// #endregion

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
    void dbgPosBootstrap({ event: 'bootstrap.enter', branchId, userId: ctx.userId, role: ctx.role });

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
    void dbgPosBootstrap({
      event: 'bootstrap.result',
      branchId,
      employeeCount: employees.length,
      tableCount: tables.length,
      employeesWithPinHash: employees.filter((e: any) => Boolean(e.pinHash)).length,
    });

    return {
      employees,
      tables,
    };
  }
}
