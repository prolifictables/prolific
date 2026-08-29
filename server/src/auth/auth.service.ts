import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { readFileSync } from 'fs';
import * as http from 'http';
import * as S from '@prolific/shared-types';
import { User } from '../users/schemas/user.schema';
import { Employee } from '../employees/schemas/employee.schema';
import { RefreshToken } from './schemas/refresh-token.schema';
import { Restaurant } from '../restaurants/schemas/restaurant.schema';
import { Branch } from '../branches/schemas/branch.schema';
import { RbacService } from '../rbac/rbac.service';
import { AuthContext } from '../common/decorators/current-user.decorator';

// #region debug-point employee-create-pos-pin:auth-service
function dbgAuthService(event: Record<string, unknown>) {
  try {
    const fromEnv = process.env.DEBUG_SERVER_URL ? String(process.env.DEBUG_SERVER_URL) : '';
    const sessionFromEnv = process.env.DEBUG_SESSION_ID ? String(process.env.DEBUG_SESSION_ID) : '';

    const parsedFromFile = (() => {
      try {
        const candidates = [
          `${process.cwd()}/.dbg/pos-pin-login-not-working.env`,
          `${process.cwd()}/../.dbg/pos-pin-login-not-working.env`,
          `${process.cwd()}/../../.dbg/pos-pin-login-not-working.env`,
          `${process.cwd()}/.dbg/pos-invalid-pin.env`,
          `${process.cwd()}/../.dbg/pos-invalid-pin.env`,
          `${process.cwd()}/../../.dbg/pos-invalid-pin.env`,
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
    const sessionId = sessionFromEnv || parsedFromFile.sessionId || 'pos-invalid-pin';
    if (!envRaw) return;
    const url = new URL(envRaw);
    const body = JSON.stringify({
      ts: Date.now(),
      sessionId,
      scope: 'server.auth.service',
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

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface LoginResult {
  tokens: TokenPair;
  user: Partial<S.User>;
  employee: Partial<S.Employee> | null;
  restaurant: Partial<S.Restaurant> | null;
  branch: Partial<S.Branch> | null;
  branches: Array<{
    id: string;
    name: string;
    restaurantId: string;
    timezone: string;
    address: string;
    phone: string;
  }>;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Employee.name) private readonly employeeModel: Model<Employee>,
    @InjectModel(RefreshToken.name) private readonly refreshModel: Model<RefreshToken>,
    @InjectModel(Restaurant.name) private readonly restaurantModel: Model<Restaurant>,
    @InjectModel(Branch.name) private readonly branchModel: Model<Branch>,
    private readonly jwtService: JwtService,
    private readonly rbacService: RbacService
  ) {}

  async login(
    email: string,
    password: string,
    opts: { branchId?: string; deviceId?: string } = {}
  ): Promise<LoginResult> {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await this.userModel.findOne({ email: normalizedEmail }).exec();
    if (!user || !user.isActive) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(password, user.hashedPassword);
    if (!valid) {
      await this.userModel.findByIdAndUpdate(user._id, {
        $inc: { failedLoginAttempts: 1 },
        $set:
          user.failedLoginAttempts + 1 >= 10
            ? { lockedUntil: new Date(Date.now() + 15 * 60 * 1000) }
            : undefined,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new UnauthorizedException('Account locked. Try again later.');
    }

    await this.userModel.findByIdAndUpdate(user._id, {
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
    });

    // If branchId supplied, resolve employee (role + permissions)
    let employee: Employee | null = null;
    if (opts.branchId) {
      employee = await this.employeeModel
        .findOne({ userId: user._id.toString(), branchId: opts.branchId })
        .exec();
      if (!employee) {
        throw new ForbiddenException('No employee record for this branch');
      }
    }

    const role: S.Role = employee?.role ?? S.Role.SUPER_ADMIN;
    const permissions = await this.rbacService.getPermissionsForRole(role);

    const restaurantId = employee?.restaurantId ?? null;
    const branchId = employee?.branchId ?? opts.branchId ?? null;

    const ctx: AuthContext = {
      userId: user._id.toString(),
      employeeId: employee?._id.toString() ?? null,
      restaurantId,
      branchId,
      role,
      permissions,
      tokenType: 'access',
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: `${user.firstName} ${user.lastName}`,
    };

    const tokens = await this.issueTokenPair(ctx);

    // Resolve restaurant + branch (if in employee context)
    let restaurant: Partial<S.Restaurant> | null = null;
    let branch: Partial<S.Branch> | null = null;
    if (employee) {
      const r = await this.restaurantModel.findById(employee.restaurantId).exec();
      if (r) {
        restaurant = {
          id: r._id.toString(),
          name: r.name,
          logoUrl: r.logoUrl,
          currency: r.currency,
          locale: r.locale,
        } as Partial<S.Restaurant>;
      }
      const b = await this.branchModel.findById(employee.branchId).exec();
      if (b) {
        branch = {
          id: b._id.toString(),
          restaurantId: b.restaurantId,
          name: b.name,
          timezone: (b as unknown as { timezone?: string }).timezone,
        } as Partial<S.Branch>;
      }
    }

    // Resolve branches list
    let branches: LoginResult['branches'] = [];
    if (role === S.Role.SUPER_ADMIN) {
      const allBranches = await this.branchModel.find({ isActive: true }).exec();
      branches = allBranches.map((b) => ({
        id: b._id.toString(),
        name: b.name,
        restaurantId: b.restaurantId,
        timezone: b.timezone,
        address: b.address,
        phone: b.phone,
      }));
    } else if (employee) {
      const userEmployees = await this.employeeModel
        .find({ userId: user._id.toString() })
        .exec();
      const branchIds = userEmployees.map((e) => e.branchId);
      const userBranches = await this.branchModel
        .find({ _id: { $in: branchIds }, isActive: true })
        .exec();
      branches = userBranches.map((b) => ({
        id: b._id.toString(),
        name: b.name,
        restaurantId: b.restaurantId,
        timezone: b.timezone,
        address: b.address,
        phone: b.phone,
      }));
    }

    // Auto-select a default branch so the login experience never pauses for
    // branch selection. Rules:
    //   1. If employee context already resolved a branch, keep it.
    //   2. Otherwise pick the first branch in the branches[] list (for
    //      employees this is their only assigned branch; for SUPER_ADMIN
    //      this is the oldest/seeded default branch).
    // This guarantees Admin/POS/Website flows proceed straight through on
    // every login — no more "pick a branch" interstitial.
    if (!branch && branches.length > 0) {
      const chosen = branches[0];
      branch = {
        id: chosen.id,
        restaurantId: chosen.restaurantId,
        name: chosen.name,
        timezone: chosen.timezone,
      };
      // If we are auto-selecting a branch for a SUPER_ADMIN with no prior
      // employee context, also re-issue the tokens so the JWT embeds the
      // selected branchId + restaurantId (ensures downstream AuthContext
      // works without a follow-up select-branch call).
      if (!employee && branches[0].restaurantId) {
        const autoCtx: AuthContext = {
          ...ctx,
          restaurantId: chosen.restaurantId,
          branchId: chosen.id,
        };
        const autoTokens = await this.issueTokenPair(autoCtx);
        tokens.accessToken = autoTokens.accessToken;
        tokens.refreshToken = autoTokens.refreshToken;
        tokens.expiresIn = autoTokens.expiresIn;
      }
      // For employees: the auto branch implies a (restaurantId, branchId,
      // employeeId) triple. If opts.branchId wasn't supplied on the initial
      // call the ctx.employeeId may be null — re-attach the employee now.
      if (employee) {
        // Employee was already resolved above; ctx is consistent — nothing
        // else to adjust.
      }
    }

    return {
      tokens,
      user: {
        id: user._id.toString(),
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        avatarUrl: user.avatarUrl,
      } as Partial<S.User>,
      employee: employee
        ? ({
            id: employee._id.toString(),
            role: employee.role,
            branchId: employee.branchId,
            restaurantId: employee.restaurantId,
          } as Partial<S.Employee>)
        : null,
      restaurant,
      branch,
      branches,
    };
  }

  async loginWithPin(
    pin: string,
    opts: { branchId?: string; deviceId?: string } = {}
  ): Promise<LoginResult> {
    try {
      void dbgAuthService({
        event: 'loginWithPin.enter',
        branchId: opts?.branchId,
        pinLen: pin ? String(pin).trim().length : 0,
        hasDeviceId: Boolean(opts?.deviceId),
      });
      // branchId is now OPTIONAL for loginWithPin — if omitted the system
      // finds the employee by PIN alone and uses their assigned branch.
      // This lets the POS skip branch selection UI entirely.
      const requestedBranchId = opts.branchId ? String(opts.branchId) : null;
      const pinStr = String(pin || '').trim();
      if (pinStr.length < 4 || pinStr.length > 6 || !/^\d+$/.test(pinStr)) {
        throw new BadRequestException('PIN must be 4-6 digits');
      }

      // Phase 1: if a specific branch was requested, narrow candidate search
      // to that branch first (existing behaviour).
      let employee: Employee | null = null;
      let branchDoc: (Branch & { _id: any }) | null = null;
      if (requestedBranchId) {
        branchDoc = Types.ObjectId.isValid(requestedBranchId)
          ? await this.branchModel.findById(requestedBranchId).exec()
          : null;
        const branchIdAliases = branchDoc?.name
          ? [requestedBranchId, String(branchDoc.name)]
          : [requestedBranchId];
        void dbgAuthService({
          event: 'loginWithPin.branchResolve',
          branchId: requestedBranchId,
          branchFound: Boolean(branchDoc),
          branchName: branchDoc?.name || null,
          branchIdAliases,
        });
        const candidates = await this.employeeModel
          .find({
            branchId: { $in: branchIdAliases },
            pin: { $exists: true, $ne: null },
            // Belt+suspenders: legacy employees may have no `status` field at all
            // (Employee schema didn't define it originally). Treat missing/null
            // as ACTIVE so they can still log in; only explicit INACTIVE blocks.
            $or: [{ status: { $exists: false } }, { status: null }, { status: 'ACTIVE' }],
          })
          .limit(500)
          .exec();
        void dbgAuthService({
          event: 'loginWithPin.candidates',
          branchId: requestedBranchId,
          candidateCount: candidates.length,
          // H3: enumerate each candidate: _id, role, status (raw from doc), pin exists, pin hash prefix
          candidates: candidates.map((e:any) => ({
            _id: e._id ? String(e._id) : null,
            role: e.role || null,
            statusRaw: (e.status !== undefined ? String(e.status) : '__MISSING__'),
            pinHashPrefix: typeof e.pin === 'string' ? e.pin.slice(0,15) : null,
            branchId: e.branchId ? String(e.branchId) : null,
          })),
        });
        for (const e of candidates) {
          const status = String((e as any).status || 'ACTIVE').toUpperCase();
          if (status !== 'ACTIVE') continue;
          const hash = (e as any).pin;
          if (!hash) continue;
          // H2: explicitly log before/after compare with types + lengths
          const pinForCompare = pinStr;
          const compareStart = {
            candidateId: (e as any)._id ? String((e as any)._id) : null,
            pinStrLen: pinForCompare.length,
            pinStrType: typeof pinForCompare,
            pinStrChars: pinForCompare, // raw digits to compare vs what admin typed
            hashType: typeof hash,
            hashPrefix: String(hash).slice(0,15),
          };
          const ok = await bcrypt.compare(pinForCompare, String(hash));
          void dbgAuthService({
            event: 'loginWithPin.branchBcrypt',
            ...compareStart,
            compareResult: ok,
          });
          if (ok) {
            employee = e;
            break;
          }
        }
      }

      // Phase 2: if no match yet (either branchId was omitted, or the PIN
      // wasn't found in that branch) — search the entire employee collection
      // globally. This handles the default "just enter PIN, no branch picker"
      // POS login flow.
      if (!employee) {
        const globalCandidates = await this.employeeModel
          .find({
            pin: { $exists: true, $ne: null },
            // Same belt+suspenders for legacy employees without a `status` field:
            // missing/null → treated as ACTIVE in Mongo query, then double-checked
            // in the inner loop below. Only explicit INACTIVE is excluded.
            $or: [{ status: { $exists: false } }, { status: null }, { status: 'ACTIVE' }],
          })
          .limit(2000)
          .exec();
        void dbgAuthService({
          event: 'loginWithPin.fallbackCandidates',
          requestedBranchId,
          candidateCount: globalCandidates.length,
          // H3: enumerate each global candidate
          candidates: globalCandidates.map((e:any) => ({
            _id: e._id ? String(e._id) : null,
            role: e.role || null,
            statusRaw: (e.status !== undefined ? String(e.status) : '__MISSING__'),
            pinHashPrefix: typeof e.pin === 'string' ? e.pin.slice(0,15) : null,
            branchId: e.branchId ? String(e.branchId) : null,
          })),
        });
        for (const e of globalCandidates) {
          const status = String((e as any).status || 'ACTIVE').toUpperCase();
          if (status !== 'ACTIVE') continue;
          const hash = (e as any).pin;
          if (!hash) continue;
          // H2: explicit before/after bcrypt.compare with pin literal shown
          const pinForCompare = pinStr;
          const compareStart = {
            candidateId: (e as any)._id ? String((e as any)._id) : null,
            pinStrLen: pinForCompare.length,
            pinStrType: typeof pinForCompare,
            pinStrChars: pinForCompare, // raw digits entered on POS keypad
            hashType: typeof hash,
            hashPrefix: String(hash).slice(0,15),
          };
          const ok = await bcrypt.compare(pinForCompare, String(hash));
          void dbgAuthService({
            event: 'loginWithPin.fallbackBcrypt',
            ...compareStart,
            compareResult: ok,
          });
          if (ok) {
            employee = e;
            break;
          }
        }
      }

      if (!employee) {
        void dbgAuthService({
          event: 'loginWithPin.invalidPin',
          requestedBranchId,
        });
        throw new UnauthorizedException('Invalid PIN');
      }

      // Resolve the branch that this employee actually belongs to. Prefer
      // the ObjectId form; fall back to name-lookup if legacy string branch
      // references survived in older employee documents.
      const employeeBranchIdRaw = String((employee as any).branchId || '');
      let effectiveBranchId: string | null = null;
      if (Types.ObjectId.isValid(employeeBranchIdRaw)) {
        effectiveBranchId = employeeBranchIdRaw;
      } else if (employeeBranchIdRaw) {
        const resolved = await this.branchModel
          .findOne({ name: employeeBranchIdRaw })
          .exec();
        if (resolved) {
          effectiveBranchId = resolved._id.toString();
          await this.employeeModel
            .findByIdAndUpdate(employee._id, { $set: { branchId: effectiveBranchId } })
            .exec();
          (employee as any).branchId = effectiveBranchId;
        }
      }
      // If for any reason the employee record lacks a branchId, try to
      // adopt the originally-requested branch — otherwise pick any active
      // branch belonging to the employee's restaurant.
      if (!effectiveBranchId) {
        if (requestedBranchId && Types.ObjectId.isValid(requestedBranchId)) {
          effectiveBranchId = requestedBranchId;
        } else {
          const fallback = await this.branchModel
            .findOne({
              restaurantId: employee.restaurantId,
              isActive: true,
            })
            .sort({ createdAt: 1 })
            .exec();
          if (fallback) {
            effectiveBranchId = fallback._id.toString();
            await this.employeeModel
              .findByIdAndUpdate(employee._id, { $set: { branchId: effectiveBranchId } })
              .exec();
            (employee as any).branchId = effectiveBranchId;
          }
        }
      }
      if (!effectiveBranchId) {
        throw new BadRequestException('No active branch for this employee');
      }

      const user = await this.userModel.findById(employee.userId).exec();
      if (!user || !user.isActive) throw new UnauthorizedException('Invalid credentials');

      const role: S.Role = employee.role;
      const permissions = await this.rbacService.getPermissionsForRole(role);

      const ctx: AuthContext = {
        userId: user._id.toString(),
        employeeId: employee._id.toString(),
        restaurantId: employee.restaurantId,
        branchId: effectiveBranchId,
        role,
        permissions,
        tokenType: 'access',
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: `${user.firstName} ${user.lastName}`,
      };

      const tokens = await this.issueTokenPair(ctx);
      void dbgAuthService({
        event: 'loginWithPin.success',
        branchId: employee.branchId,
        employeeId: employee._id.toString(),
        userId: user._id.toString(),
        role,
      });

      let restaurant: Partial<S.Restaurant> | null = null;
      let branch: Partial<S.Branch> | null = null;
      const r = await this.restaurantModel.findById(employee.restaurantId).exec();
      if (r) {
        restaurant = {
          id: r._id.toString(),
          name: r.name,
          logoUrl: r.logoUrl,
          currency: r.currency,
          locale: r.locale,
        } as Partial<S.Restaurant>;
      }
      const b = Types.ObjectId.isValid(effectiveBranchId)
        ? await this.branchModel.findById(effectiveBranchId).exec()
        : null;
      if (b) {
        branch = {
          id: b._id.toString(),
          restaurantId: b.restaurantId,
          name: b.name,
          timezone: (b as unknown as { timezone?: string }).timezone,
        } as Partial<S.Branch>;
      }

      const userEmployees = await this.employeeModel
        .find({ userId: user._id.toString() })
        .exec();
      const rawBranchIds = userEmployees.map((e) => String(e.branchId || ''));
      const uniqueBranchIds = Array.from(new Set(rawBranchIds)).filter(Boolean);
      const validBranchIds = uniqueBranchIds.filter((id) => Types.ObjectId.isValid(id));
      const invalidBranchIds = uniqueBranchIds.filter((id) => !Types.ObjectId.isValid(id));

      const [userBranchesById, userBranchesByName] = await Promise.all([
        validBranchIds.length
          ? this.branchModel.find({ _id: { $in: validBranchIds }, isActive: true }).exec()
          : Promise.resolve([]),
        invalidBranchIds.length
          ? this.branchModel.find({ name: { $in: invalidBranchIds }, isActive: true }).exec()
          : Promise.resolve([]),
      ]);
      const branches = [...userBranchesById, ...userBranchesByName].map((br) => ({
        id: br._id.toString(),
        name: br.name,
        restaurantId: br.restaurantId,
        timezone: br.timezone,
        address: br.address,
        phone: br.phone,
      }));

      void opts.deviceId;

      return {
        tokens,
        user: {
          id: user._id.toString(),
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          phone: user.phone,
          avatarUrl: user.avatarUrl,
        } as Partial<S.User>,
        employee: {
          id: employee._id.toString(),
          role: employee.role,
          branchId: effectiveBranchId,
          restaurantId: employee.restaurantId,
          userId: employee.userId,
        } as Partial<S.Employee>,
        restaurant,
        branch,
        branches,
      };
    } catch (err) {
      const e = err as any;
      void dbgAuthService({
        event: 'loginWithPin.error',
        error: {
          name: e?.name,
          message: e?.message,
        },
      });
      throw err;
    }
  }

  async changePin(
    ctx: AuthContext,
    currentPin: string,
    newPin: string
  ): Promise<{ ok: true }> {
    const employeeId = ctx?.employeeId ? String(ctx.employeeId) : '';
    if (!employeeId) throw new BadRequestException('employeeId required');

    const current = String(currentPin || '').trim();
    const next = String(newPin || '').trim();
    if (current.length < 4 || current.length > 6 || !/^\d+$/.test(current)) {
      throw new BadRequestException('Current PIN must be 4-6 digits');
    }
    if (next.length < 4 || next.length > 6 || !/^\d+$/.test(next)) {
      throw new BadRequestException('New PIN must be 4-6 digits');
    }

    const employee = await this.employeeModel.findById(employeeId).exec();
    if (!employee || !(employee as any).pin) throw new UnauthorizedException('Invalid credentials');

    const ok = await bcrypt.compare(current, String((employee as any).pin));
    if (!ok) throw new UnauthorizedException('Invalid PIN');

    const hashed = await bcrypt.hash(next, 10);
    await this.employeeModel
      .findByIdAndUpdate(employee._id, { $set: { pin: hashed } }, { new: true })
      .exec();
    return { ok: true };
  }

  async selectBranch(
    ctx: AuthContext,
    branchId: string
  ): Promise<LoginResult> {
    const user = await this.userModel.findById(ctx.userId).exec();
    if (!user || !user.isActive) throw new UnauthorizedException('Invalid credentials');

    let employee: Employee | null = null;
    if (ctx.role === S.Role.SUPER_ADMIN) {
      employee = await this.employeeModel
        .findOne({ userId: ctx.userId, branchId })
        .exec();
    } else {
      employee = await this.employeeModel
        .findOne({ userId: ctx.userId, branchId })
        .exec();
      if (!employee) {
        throw new ForbiddenException('No employee record for this branch');
      }
    }

    const role: S.Role = employee?.role ?? S.Role.SUPER_ADMIN;
    const permissions = await this.rbacService.getPermissionsForRole(role);

    const restaurantId = employee?.restaurantId ?? null;
    const effectiveBranchId = employee?.branchId ?? branchId;

    const newCtx: AuthContext = {
      userId: user._id.toString(),
      employeeId: employee?._id.toString() ?? null,
      restaurantId,
      branchId: effectiveBranchId,
      role,
      permissions,
      tokenType: 'access',
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: `${user.firstName} ${user.lastName}`,
    };

    const tokens = await this.issueTokenPair(newCtx);

    let restaurant: Partial<S.Restaurant> | null = null;
    let branch: Partial<S.Branch> | null = null;
    const restaurantIdToUse = employee?.restaurantId;
    if (restaurantIdToUse) {
      const r = await this.restaurantModel.findById(restaurantIdToUse).exec();
      if (r) {
        restaurant = {
          id: r._id.toString(),
          name: r.name,
          logoUrl: r.logoUrl,
          currency: r.currency,
          locale: r.locale,
        } as Partial<S.Restaurant>;
      }
    }
    const b = await this.branchModel.findById(effectiveBranchId).exec();
    if (b) {
      branch = {
        id: b._id.toString(),
        restaurantId: b.restaurantId,
        name: b.name,
        timezone: b.timezone,
      } as Partial<S.Branch>;
    }

    let branches: LoginResult['branches'] = [];
    if (role === S.Role.SUPER_ADMIN) {
      const allBranches = await this.branchModel.find({ isActive: true }).exec();
      branches = allBranches.map((br) => ({
        id: br._id.toString(),
        name: br.name,
        restaurantId: br.restaurantId,
        timezone: br.timezone,
        address: br.address,
        phone: br.phone,
      }));
    } else if (employee) {
      const userEmployees = await this.employeeModel
        .find({ userId: user._id.toString() })
        .exec();
      const branchIds = userEmployees.map((e) => e.branchId);
      const userBranches = await this.branchModel
        .find({ _id: { $in: branchIds }, isActive: true })
        .exec();
      branches = userBranches.map((br) => ({
        id: br._id.toString(),
        name: br.name,
        restaurantId: br.restaurantId,
        timezone: br.timezone,
        address: br.address,
        phone: br.phone,
      }));
    }

    return {
      tokens,
      user: {
        id: user._id.toString(),
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        avatarUrl: user.avatarUrl,
      } as Partial<S.User>,
      employee: employee
        ? ({
            id: employee._id.toString(),
            role: employee.role,
            branchId: employee.branchId,
            restaurantId: employee.restaurantId,
          } as Partial<S.Employee>)
        : null,
      restaurant,
      branch,
      branches,
    };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const hash = this.hashToken(refreshToken);
    const stored = await this.refreshModel
      .findOne({ tokenHash: hash })
      .sort({ createdAt: -1 })
      .exec();

    if (!stored || stored.revoked || stored.expiresAt.getTime() < Date.now()) {
      // Theft detection: if this hash unknown but family exists, revoke entire family
      if (stored?.family) {
        await this.refreshModel
          .updateMany({ family: stored.family }, { revoked: true, revokedAt: new Date() })
          .exec();
      }
      throw new UnauthorizedException('Refresh token invalid');
    }

    // Single-use rotation: mark this one revoked, issue new same family
    await stored.updateOne({ revoked: true, revokedAt: new Date() }).exec();

    const user = await this.userModel.findById(stored.userId).exec();
    if (!user || !user.isActive) throw new UnauthorizedException('User inactive');

    const employee = stored.employeeId
      ? await this.employeeModel.findById(stored.employeeId).exec()
      : null;
    const role: S.Role = employee?.role ?? S.Role.SUPER_ADMIN;
    const permissions = await this.rbacService.getPermissionsForRole(role);

    const ctx: AuthContext = {
      userId: user._id.toString(),
      employeeId: employee?._id.toString() ?? null,
      restaurantId: employee?.restaurantId ?? null,
      branchId: employee?.branchId ?? null,
      role,
      permissions,
      tokenType: 'access',
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: `${user.firstName} ${user.lastName}`,
    };
    return this.issueTokenPair(ctx, stored.family);
  }

  async logout(refreshToken: string): Promise<void> {
    const hash = this.hashToken(refreshToken);
    await this.refreshModel
      .updateOne(
        { tokenHash: hash },
        { revoked: true, revokedAt: new Date() },
        { upsert: false }
      )
      .exec();
  }

  /**
   * Manager PIN verification. Used for refund/void/large-discount approvals.
   * Returns a short-lived signed approval JWT that the cash-handler can attach
   * to a sensitive mutation.
   */
  async verifyPinAndIssueApproval(
    pinInput: string,
    approverBranchId: string,
    scope: {
      action: S.AuditAction;
      entityType: string;
      entityId: string;
      requestingEmployeeId?: string;
    }
  ): Promise<{ approvalToken: string; approver: string; role: S.Role }> {
    const hash = await bcrypt.hash(pinInput, 4);
    console.log('[Auth] pin input', hash);
    const approvers = await this.employeeModel
      .find({
        branchId: approverBranchId,
        role: { $in: [S.Role.MANAGER, S.Role.SUPERVISOR, S.Role.ADMIN, S.Role.SUPER_ADMIN] },
        pin: { $exists: true },
      })
      .exec();

    for (const emp of approvers) {
      if (!emp.pin) continue;
      const ok = await bcrypt.compare(pinInput, emp.pin);
      if (ok) {
        const token = await this.jwtService.signAsync(
          {
            tokenType: 'approval',
            approverId: emp._id.toString(),
            approverRole: emp.role,
            scope,
          } as object,
          {
            secret: process.env.JWT_ACCESS_SECRET,
            expiresIn: '60s',
            issuer: process.env.JWT_ISSUER,
            audience: process.env.JWT_AUDIENCE,
          }
        );
        return {
          approvalToken: token,
          approver: emp._id.toString(),
          role: emp.role as S.Role,
        };
      }
    }

    throw new ForbiddenException('PIN invalid');
  }

  // ---- Internal helpers -------------------------------------------------

  private async issueTokenPair(ctx: AuthContext, family?: string): Promise<TokenPair> {
    const accessTtl = parseInt(process.env.JWT_ACCESS_TTL_SECONDS || '900', 10);
    const refreshTtl = parseInt(process.env.JWT_REFRESH_TTL_SECONDS || '604800', 10);

    const accessToken = await this.jwtService.signAsync(ctx as unknown as object, {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: accessTtl,
      issuer: process.env.JWT_ISSUER,
      audience: process.env.JWT_AUDIENCE,
    });

    const refreshRaw = randomBytes(40).toString('hex');
    const fam = family || randomBytes(16).toString('hex');
    await this.refreshModel.create({
      userId: ctx.userId,
      employeeId: ctx.employeeId ?? undefined,
      tokenHash: this.hashToken(refreshRaw),
      family: fam,
      expiresAt: new Date(Date.now() + refreshTtl * 1000),
      revoked: false,
    });

    return {
      accessToken,
      refreshToken: refreshRaw,
      expiresIn: accessTtl,
      tokenType: 'Bearer',
    };
  }

  private hashToken(tok: string): string {
    return createHash('sha256').update(tok).digest('hex');
  }

  async hashPassword(pw: string): Promise<string> {
    return bcrypt.hash(pw, 10);
  }
}
