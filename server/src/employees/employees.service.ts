import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { readFileSync } from 'fs';
import * as http from 'http';
import * as S from '@prolific/shared-types';
import { Employee } from './schemas/employee.schema';
import { User } from '../users/schemas/user.schema';
import { Branch } from '../branches/schemas/branch.schema';
import type { AuthContext } from '../common/decorators/current-user.decorator';
import { RbacService } from '../rbac/rbac.service';

// #region debug-point employee-create-pos-pin:employees-service
function dbgEmployeesService(event: Record<string, unknown>) {
  try {
    const fromEnv = process.env.DEBUG_SERVER_URL ? String(process.env.DEBUG_SERVER_URL) : '';
    const sessionFromEnv = process.env.DEBUG_SESSION_ID ? String(process.env.DEBUG_SESSION_ID) : '';

    const parsedFromFile = (() => {
      try {
        const candidates = [
          `${process.cwd()}/.dbg/reset-pin-not-found.env`,
          `${process.cwd()}/../.dbg/reset-pin-not-found.env`,
          `${process.cwd()}/../../.dbg/reset-pin-not-found.env`,
          `${process.cwd()}/.dbg/employees-500-error.env`,
          `${process.cwd()}/../.dbg/employees-500-error.env`,
          `${process.cwd()}/../../.dbg/employees-500-error.env`,
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
        if (!envPath) return { url: '', sessionId: '' };

        const raw = readFileSync(envPath, 'utf-8');
        const lines = raw.split('\n').map((l) => l.trim());
        const urlLine = lines.find((l) => l.startsWith('DEBUG_SERVER_URL='));
        const sessionLine = lines.find((l) => l.startsWith('DEBUG_SESSION_ID='));
        return {
          url: urlLine ? urlLine.replace('DEBUG_SERVER_URL=', '').trim() : '',
          sessionId: sessionLine ? sessionLine.replace('DEBUG_SESSION_ID=', '').trim() : '',
        };
      } catch {
        return { url: '', sessionId: '' };
      }
    })();

    const envRaw = fromEnv || parsedFromFile.url;
    const sessionId = sessionFromEnv || parsedFromFile.sessionId || 'employees-500-error';
    if (!envRaw) return;
    const url = new URL(envRaw);
    const body = JSON.stringify({
      ts: Date.now(),
      sessionId,
      scope: 'server.employees.service',
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

export interface CreateEmployeeInput {
  branchId?: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  address?: S.User['address'];
  emergencyContact?: S.User['emergencyContact'];
  role: S.Role;
  pin?: string;
  employeeNumber?: string;
  positionTitle?: string;
  assignedZoneIds?: string[];
  joinedAt?: Date;
}

export interface UpdateEmployeeInput {
  firstName?: string;
  lastName?: string;
  phone?: string;
  address?: S.User['address'];
  emergencyContact?: S.User['emergencyContact'];
  role?: S.Role;
  positionTitle?: string;
  assignedZoneIds?: string[];
  joinedAt?: Date;
}

export interface ListEmployeesFilters {
  role?: S.Role;
  status?: 'active' | 'inactive';
  cursor?: string;
  limit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    cursor: string | null;
    count: number;
    hasMore: boolean;
  };
}

export interface ResetPinResult {
  employeeId: string;
  rawPin: string;
}

@Injectable()
export class EmployeesService {
  private readonly logger = new Logger(EmployeesService.name);
  private readonly VALID_ROLES = new Set(Object.values(S.Role));

  constructor(
    @InjectModel(Employee.name)
    private readonly employeeModel: Model<Employee>,
    @InjectModel(User.name)
    private readonly userModel: Model<User>,
    @InjectModel(Branch.name)
    private readonly branchModel: Model<Branch>,
    private readonly rbacService: RbacService
  ) {}

  async listEmployees(
    ctx: AuthContext,
    filters: ListEmployeesFilters = {}
  ): Promise<PaginatedResult<any>> {
    void dbgEmployeesService({
      event: 'listEmployees.enter',
      ctxPresent: Boolean(ctx),
      ctx: ctx
        ? {
            role: (ctx as any).role,
            branchId: (ctx as any).branchId,
            restaurantId: (ctx as any).restaurantId,
            userId: (ctx as any).userId,
          }
        : null,
      filters,
    });
    const isSuperAdmin = ctx.role === S.Role.SUPER_ADMIN;
    const branchId = ctx.branchId;
    if (!branchId && !isSuperAdmin) throw new BadRequestException('Branch context required');

    const limit = Math.min(filters.limit ?? 50, 100);
    const query: Record<string, unknown> = {};
    if (branchId && !isSuperAdmin) query.branchId = branchId;
    if (filters.role) query.role = filters.role;
    if (filters.status === 'active') {
      (query as any).$or = [{ isActive: { $exists: false } }, { isActive: true }];
    } else if (filters.status === 'inactive') {
      (query as any).isActive = false;
    }

    if (filters.cursor) {
      try {
        const decoded = Buffer.from(filters.cursor, 'base64').toString('utf-8');
        const parsed = JSON.parse(decoded);
        if (parsed._id) {
          query._id = { $lt: new Types.ObjectId(parsed._id) };
        }
      } catch (_e) {
        throw new BadRequestException('Invalid cursor');
      }
    }

    try {
      const docs = await this.employeeModel
        .find(query)
        .sort({ _id: -1 })
        .limit(limit + 1)
        .exec();

      const hasMore = docs.length > limit;
      const data = docs.slice(0, limit);
      const count = data.length;

      let cursor: string | null = null;
      if (hasMore && data.length > 0) {
        const last = data[data.length - 1];
        cursor = Buffer.from(
          JSON.stringify({ _id: last._id.toString() })
        ).toString('base64');
      }

      const userIds = Array.from(new Set(data.map((e: any) => String(e.userId || '')).filter(Boolean)));
      const branchIds = Array.from(new Set(data.map((e: any) => String(e.branchId || '')).filter(Boolean)));
      const validBranchIds = branchIds.filter((id) => Types.ObjectId.isValid(id));
      const invalidBranchIds = branchIds.filter((id) => !Types.ObjectId.isValid(id));
      void dbgEmployeesService({
        event: 'listEmployees.ids',
        count,
        uniqueUserIds: userIds.length,
        uniqueBranchIds: branchIds.length,
        sampleBranchIds: branchIds.slice(0, 10),
      });
      if (invalidBranchIds.length) {
        void dbgEmployeesService({
          event: 'listEmployees.invalidBranchIds',
          invalidBranchIds: invalidBranchIds.slice(0, 20),
          invalidBranchIdsCount: invalidBranchIds.length,
        });
      }

      const [users, branches] = await Promise.all([
        userIds.length ? this.userModel.find({ _id: { $in: userIds } }).exec() : Promise.resolve([]),
        validBranchIds.length
          ? this.branchModel.find({ _id: { $in: validBranchIds } }).exec()
          : Promise.resolve([]),
      ]);
      const branchesByName =
        invalidBranchIds.length > 0
          ? await this.branchModel.find({ name: { $in: invalidBranchIds } }).exec()
          : [];

      const userById = new Map<string, any>();
      users.forEach((u: any) => userById.set(String(u._id), u));
      const branchById = new Map<string, any>();
      branches.forEach((b: any) => branchById.set(String(b._id), b));
      const branchByName = new Map<string, any>();
      branchesByName.forEach((b: any) => branchByName.set(String(b.name), b));

      const enriched = data.map((emp: any) => {
        const u = emp.userId ? userById.get(String(emp.userId)) : null;
        const b = emp.branchId
          ? branchById.get(String(emp.branchId)) || branchByName.get(String(emp.branchId))
          : null;
        return {
          ...(emp.toObject ? emp.toObject() : emp),
          id: emp.id || emp._id?.toString?.() || String(emp._id),
          user: u
            ? {
                id: u.id || u._id?.toString?.() || String(u._id),
                firstName: u.firstName,
                lastName: u.lastName,
                email: u.email,
                phone: u.phone,
                address: u.address,
                emergencyContact: u.emergencyContact,
                isActive: u.isActive,
                avatarUrl: u.avatarUrl,
              }
            : undefined,
          branch: b
            ? {
                id: b.id || b._id?.toString?.() || String(b._id),
                name: b.name,
                city: b.city,
              }
            : undefined,
          isActive: typeof emp.isActive === 'boolean' ? emp.isActive : true,
        };
      });

      void dbgEmployeesService({
        event: 'listEmployees.success',
        count,
        hasMore,
      });
      return { data: enriched, meta: { cursor, count, hasMore } };
    } catch (err) {
      const e = err as any;
      void dbgEmployeesService({
        event: 'listEmployees.error',
        error: {
          name: e?.name,
          message: e?.message,
          stack: typeof e?.stack === 'string' ? e.stack.slice(0, 2000) : undefined,
        },
      });
      throw err;
    }
  }

  async createEmployee(
    ctx: AuthContext,
    input: CreateEmployeeInput
  ): Promise<Employee> {
    void dbgEmployeesService({
      event: 'createEmployee.enter',
      ctxPresent: Boolean(ctx),
      ctx: ctx
        ? {
            role: (ctx as any).role,
            branchId: (ctx as any).branchId,
            restaurantId: (ctx as any).restaurantId,
            userId: (ctx as any).userId,
          }
        : null,
      input: {
        branchId: input.branchId,
        email: input.email,
        role: input.role,
        hasPin: Boolean(input.pin),
        pinLen: input.pin ? String(input.pin).length : 0,
        employeeNumber: input.employeeNumber ?? null,
      },
    });

    try {
    const isSuperAdmin = ctx.role === S.Role.SUPER_ADMIN;
    const branchId = (isSuperAdmin ? input.branchId : ctx.branchId) || ctx.branchId;
    const restaurantId = ctx.restaurantId;
    if (!branchId || !restaurantId) {
      throw new BadRequestException('Branch and restaurant context required');
    }

    if (!this.VALID_ROLES.has(input.role)) {
      throw new BadRequestException(
        `Invalid role: ${input.role}. Valid: ${Array.from(this.VALID_ROLES).join(', ')}`
      );
    }

    if (input.pin) {
      const pinStr = input.pin.toString();
      if (pinStr.length < 4 || pinStr.length > 6 || !/^\d+$/.test(pinStr)) {
        throw new BadRequestException('PIN must be 4-6 digits');
      }
    }

    let user = await this.userModel
      .findOne({ email: input.email.toLowerCase() })
      .exec();

    if (!user) {
      const tempPassword = Math.random().toString(36).slice(-10);
      const hashedPassword = await bcrypt.hash(tempPassword, 10);
      user = await this.userModel.create({
        email: input.email.toLowerCase(),
        hashedPassword,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
        address: input.address,
        emergencyContact: input.emergencyContact,
        isActive: true,
        isEmailVerified: false,
        failedLoginAttempts: 0,
      });
    } else {
      if (input.firstName !== undefined && input.firstName !== user.firstName) {
        user.firstName = input.firstName;
      }
      if (input.lastName !== undefined && input.lastName !== user.lastName) {
        user.lastName = input.lastName;
      }
      if (input.phone !== undefined && input.phone !== user.phone) {
        user.phone = input.phone;
      }
      if (input.address !== undefined) {
        (user as any).address = input.address;
      }
      if (input.emergencyContact !== undefined) {
        (user as any).emergencyContact = input.emergencyContact;
      }
      await user.save();
    }

    const existingEmployee = await this.employeeModel
      .findOne({ userId: user._id.toString(), branchId })
      .exec();
    if (existingEmployee) {
      throw new BadRequestException(
        `Employee already exists for this user in branch (id=${existingEmployee._id})`
      );
    }

    let hashedPin: string | undefined;
    if (input.pin) {
      hashedPin = await bcrypt.hash(input.pin.toString(), 10);
    }

    const employee = await this.employeeModel.create({
      userId: user._id.toString(),
      restaurantId,
      branchId,
      role: input.role,
      pin: hashedPin,
      employeeNumber: input.employeeNumber,
      positionTitle: input.positionTitle,
      assignedZoneIds: input.assignedZoneIds ?? [],
      joinedAt: input.joinedAt ?? new Date(),
    });

    void dbgEmployeesService({
      event: 'createEmployee.success',
      employeeId: employee?._id?.toString?.() || null,
      branchId,
      restaurantId,
      role: input.role,
      pinSaved: Boolean((employee as any)?.pin),
    });

    return employee;
    } catch (err) {
      const e = err as any;
      void dbgEmployeesService({
        event: 'createEmployee.error',
        error: {
          name: e?.name,
          message: e?.message,
          code: e?.code,
        },
      });
      throw err;
    }
  }

  async updateEmployee(
    ctx: AuthContext,
    id: string,
    input: UpdateEmployeeInput
  ): Promise<Employee> {
    const branchId = ctx.branchId;
    if (!branchId) throw new BadRequestException('Branch context required');

    const branchDoc = await this.branchModel.findById(branchId).exec();
    const branchIdAliases = branchDoc?.name ? [branchId, String(branchDoc.name)] : [branchId];
    const employee = await this.employeeModel
      .findOne({ _id: id, branchId: { $in: branchIdAliases } })
      .exec();
    if (!employee) throw new NotFoundException(`Employee ${id} not found`);

    if (input.role && !this.VALID_ROLES.has(input.role)) {
      throw new BadRequestException(
        `Invalid role: ${input.role}. Valid: ${Array.from(this.VALID_ROLES).join(', ')}`
      );
    }

    const updateFields: Record<string, unknown> = {};
    if (input.role !== undefined) updateFields.role = input.role;
    if (input.positionTitle !== undefined) updateFields.positionTitle = input.positionTitle;
    if (input.assignedZoneIds !== undefined) updateFields.assignedZoneIds = input.assignedZoneIds;
    if (input.joinedAt !== undefined) updateFields.joinedAt = input.joinedAt;

    const updated = await this.employeeModel
      .findByIdAndUpdate(employee._id, { $set: updateFields }, { new: true })
      .exec();
    if (!updated) throw new NotFoundException('Employee disappeared');

    if (
      input.firstName !== undefined ||
      input.lastName !== undefined ||
      input.phone !== undefined ||
      input.address !== undefined ||
      input.emergencyContact !== undefined
    ) {
      const userUpdates: Record<string, unknown> = {};
      if (input.firstName !== undefined) userUpdates.firstName = input.firstName;
      if (input.lastName !== undefined) userUpdates.lastName = input.lastName;
      if (input.phone !== undefined) userUpdates.phone = input.phone;
      if (input.address !== undefined) userUpdates.address = input.address;
      if (input.emergencyContact !== undefined) userUpdates.emergencyContact = input.emergencyContact;
      await this.userModel
        .findByIdAndUpdate(updated.userId, { $set: userUpdates })
        .exec();
    }

    return updated;
  }

  async toggleActive(ctx: AuthContext, id: string): Promise<Employee> {
    const branchId = ctx.branchId;
    if (!branchId) throw new BadRequestException('Branch context required');

    const branchDoc = await this.branchModel.findById(branchId).exec();
    const branchIdAliases = branchDoc?.name ? [branchId, String(branchDoc.name)] : [branchId];
    const employee = await this.employeeModel
      .findOne({ _id: id, branchId: { $in: branchIdAliases } })
      .exec();
    if (!employee) throw new NotFoundException(`Employee ${id} not found`);

    const currentActive = (employee as any).isActive;
    const newActive = currentActive === undefined ? false : !currentActive;

    const updated = await this.employeeModel
      .findByIdAndUpdate(
        employee._id,
        { $set: { isActive: newActive } as any },
        { new: true }
      )
      .exec();
    if (!updated) throw new NotFoundException('Employee disappeared');
    return updated;
  }

  async resetPin(
    ctx: AuthContext,
    id: string
  ): Promise<ResetPinResult> {
    try {
      void dbgEmployeesService({
        event: 'resetPin.enter',
        ctxPresent: Boolean(ctx),
        ctx: ctx
          ? {
              role: (ctx as any).role,
              branchId: (ctx as any).branchId,
              restaurantId: (ctx as any).restaurantId,
              userId: (ctx as any).userId,
              employeeId: (ctx as any).employeeId,
            }
          : null,
        id,
        idIsObjectId: Types.ObjectId.isValid(id),
      });
      const branchId = ctx.branchId;
      if (!branchId) throw new BadRequestException('Branch context required');

      const branchDoc = await this.branchModel.findById(branchId).exec();
      const branchIdAliases = branchDoc?.name ? [branchId, String(branchDoc.name)] : [branchId];
      const [employeeInBranch, employeeAnyBranch] = await Promise.all([
        this.employeeModel.findOne({ _id: id, branchId: { $in: branchIdAliases } }).exec(),
        this.employeeModel.findOne({ _id: id }).exec(),
      ]);
      void dbgEmployeesService({
        event: 'resetPin.lookup',
        id,
        branchId,
        branchIdAliases,
        inBranchFound: Boolean(employeeInBranch),
        anyBranchFound: Boolean(employeeAnyBranch),
        anyBranchEmployeeBranchId: employeeAnyBranch
          ? (employeeAnyBranch as any).branchId
          : null,
        anyBranchEmployeeUserId: employeeAnyBranch ? (employeeAnyBranch as any).userId : null,
      });
      const employee = employeeInBranch;
      if (!employee) throw new NotFoundException(`Employee ${id} not found`);

      const rawPin = Math.floor(1000 + Math.random() * 9000).toString();
      const hashedPin = await bcrypt.hash(rawPin, 10);

      await this.employeeModel
        .findByIdAndUpdate(employee._id, { $set: { pin: hashedPin } }, { new: true })
        .exec();

      void dbgEmployeesService({
        event: 'resetPin.success',
        employeeId: employee?._id?.toString?.() || null,
        branchId: (employee as any)?.branchId ?? null,
      });
      return {
        employeeId: id,
        rawPin,
      };
    } catch (err) {
      const e = err as any;
      void dbgEmployeesService({
        event: 'resetPin.error',
        id,
        error: {
          name: e?.name,
          message: e?.message,
        },
      });
      throw err;
    }
  }

  async getEmployeeRoles(
    _ctx: AuthContext
  ): Promise<Array<{ role: S.Role; description?: string; permissions: S.Permission[] }>> {
    const result: Array<{ role: S.Role; description?: string; permissions: S.Permission[] }> = [];
    for (const role of Object.values(S.Role)) {
      const permissions = await this.rbacService.getPermissionsForRole(role);
      result.push({
        role,
        description: `Default ${role} role`,
        permissions,
      });
    }
    return result;
  }
}
