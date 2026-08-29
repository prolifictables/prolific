import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as S from '@prolific/shared-types';
import { Table } from './schemas/table.schema';
import { TableSession } from '../table-sessions/schemas/table-session.schema';
import { QRCode } from '../qr-codes/schemas/qr-code.schema';
import type { AuthContext } from '../common/decorators/current-user.decorator';

export interface CreateTableInput {
  name: string;
  zone?: string;
  floor?: string;
  capacity: number;
  position?: { x: number; y: number };
}

export interface UpdateTableInput {
  name?: string;
  zone?: string;
  floor?: string;
  capacity?: number;
  position?: { x: number; y: number };
  isActive?: boolean;
}

export interface ListTablesFilters {
  zone?: string;
  status?: string;
  capacity?: number;
}

function generateToken(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

@Injectable()
export class TablesService {
  private readonly logger = new Logger(TablesService.name);

  constructor(
    @InjectModel(Table.name)
    private readonly tableModel: Model<Table>,
    @InjectModel(TableSession.name)
    private readonly tableSessionModel: Model<TableSession>,
    @InjectModel(QRCode.name)
    private readonly qrCodeModel: Model<QRCode>
  ) {}

  private withVirtualId<T extends Record<string, any>>(doc: T): T & { id: string } {
    const result = doc as T & { id: string };
    if (!result.id) {
      result.id = result._id?.toString?.() || String(result._id);
    }
    return result;
  }

  async listTables(
    ctx: AuthContext,
    filters: ListTablesFilters = {}
  ): Promise<S.Table[]> {
    const branchId = ctx.branchId;
    if (!branchId) throw new BadRequestException('Branch context required');

    const query: Record<string, unknown> = { branchId, isActive: true };
    if (filters.zone) query.zone = filters.zone;
    if (filters.capacity) {
      (query as any).capacity = { $gte: filters.capacity };
    }

    const docs = await this.tableModel
      .find(query)
      .sort({ zone: 1, name: 1 })
      .lean()
      .exec();

    return docs.map((t: any) => this.withVirtualId(t)) as unknown as S.Table[];
  }

  async createTable(
    ctx: AuthContext,
    input: CreateTableInput
  ): Promise<S.Table> {
    const branchId = ctx.branchId;
    const restaurantId = ctx.restaurantId;
    if (!branchId || !restaurantId) {
      throw new BadRequestException('Branch and restaurant context required');
    }

    if (!input.name || input.name.trim().length === 0) {
      throw new BadRequestException('Table name is required');
    }
    if (!input.capacity || input.capacity < 1) {
      throw new BadRequestException('Table capacity must be >= 1');
    }

    const token = generateToken();

    const qrCode = await this.qrCodeModel.create({
      restaurantId,
      branchId,
      tableId: '',
      token,
      isActive: true,
      isDefault: true,
    });

    try {
      const table = await this.tableModel.create({
        restaurantId,
        branchId,
        name: input.name,
        zone: input.zone,
        floor: input.floor,
        capacity: input.capacity,
        position: input.position,
        isActive: true,
        qrCodeId: qrCode._id.toString(),
      });

      await this.qrCodeModel
        .findByIdAndUpdate(qrCode._id, {
          $set: { tableId: table._id.toString() },
        })
        .exec();

      return this.withVirtualId(table.toObject ? (table.toObject() as any) : (table as any)) as unknown as S.Table;
    } catch (err) {
      await this.qrCodeModel.findByIdAndDelete(qrCode._id).exec();
      throw err;
    }
  }

  async updateTable(
    ctx: AuthContext,
    id: string,
    input: UpdateTableInput
  ): Promise<S.Table> {
    const branchId = ctx.branchId;
    if (!branchId) throw new BadRequestException('Branch context required');

    const table = await this.tableModel
      .findOne({ _id: id, branchId })
      .exec();
    if (!table) throw new NotFoundException(`Table ${id} not found`);

    if (input.capacity !== undefined && input.capacity < 1) {
      throw new BadRequestException('Table capacity must be >= 1');
    }

    const updated = await this.tableModel
      .findByIdAndUpdate(table._id, { $set: input }, { new: true })
      .exec();
    if (!updated) throw new NotFoundException('Table disappeared');
    return this.withVirtualId(updated.toObject ? (updated.toObject() as any) : (updated as any)) as unknown as S.Table;
  }

  async deleteTable(ctx: AuthContext, id: string): Promise<S.Table> {
    const branchId = ctx.branchId;
    if (!branchId) throw new BadRequestException('Branch context required');

    const table = await this.tableModel
      .findOne({ _id: id, branchId })
      .exec();
    if (!table) throw new NotFoundException(`Table ${id} not found`);

    const openSession = await this.tableSessionModel
      .findOne({
        tableId: id,
        status: {
          $in: [
            S.TableSessionStatus.OPEN,
            S.TableSessionStatus.AWAITING_PAYMENT,
            S.TableSessionStatus.PARTIALLY_PAID,
          ],
        },
      })
      .exec();

    if (openSession) {
      throw new ForbiddenException(
        `Cannot delete table with open session (sessionId=${openSession._id})`
      );
    }

    const updated = await this.tableModel
      .findByIdAndUpdate(
        table._id,
        { $set: { isActive: false } },
        { new: true }
      )
      .exec();
    if (!updated) throw new NotFoundException('Table disappeared');

    await this.qrCodeModel
      .updateMany(
        { tableId: id, branchId },
        { $set: { isActive: false } }
      )
      .exec();

    return this.withVirtualId(updated.toObject ? (updated.toObject() as any) : (updated as any)) as unknown as S.Table;
  }

  async listFloorZones(ctx: AuthContext): Promise<string[]> {
    const branchId = ctx.branchId;
    if (!branchId) throw new BadRequestException('Branch context required');

    const tables = await this.tableModel
      .find({ branchId, isActive: true, zone: { $exists: true, $ne: null } })
      .exec();

    const zones = new Set<string>();
    for (const t of tables) {
      if (t.zone) zones.add(t.zone);
    }
    return Array.from(zones).sort();
  }
}
