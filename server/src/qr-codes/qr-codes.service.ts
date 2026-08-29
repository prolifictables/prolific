import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as S from '@prolific/shared-types';
import { QRCode } from './schemas/qr-code.schema';
import { Table } from '../tables/schemas/table.schema';
import type { AuthContext } from '../common/decorators/current-user.decorator';

function generateToken(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 10; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export interface QrPack {
  tableName: string;
  zone?: string;
  token: string;
  svgDataUrl: string;
  pngDataUrl: null;
  downloadUrl: string;
}

export interface QrPdfResponse {
  qrPacks: QrPack[];
  layout: {
    columns: number;
    rows: number;
    paddingMm: number;
  };
}

export interface ListQrsFilters {
  tableId?: string;
  isActive?: boolean;
}

@Injectable()
export class QrCodesService {
  private readonly logger = new Logger(QrCodesService.name);

  constructor(
    @InjectModel(QRCode.name)
    private readonly qrCodeModel: Model<QRCode>,
    @InjectModel(Table.name)
    private readonly tableModel: Model<Table>
  ) {}

  async regenerateQrForTable(
    ctx: AuthContext,
    tableId: string
  ): Promise<QRCode> {
    const branchId = ctx.branchId;
    const restaurantId = ctx.restaurantId;
    if (!branchId || !restaurantId) {
      throw new BadRequestException('Branch and restaurant context required');
    }

    const table = await this.tableModel
      .findOne({ _id: tableId, branchId })
      .exec();
    if (!table) {
      throw new NotFoundException(`Table ${tableId} not found`);
    }

    await this.qrCodeModel
      .updateMany(
        { tableId, branchId },
        { $set: { isActive: false, isDefault: false } }
      )
      .exec();

    const token = generateToken();
    const qrCode = await this.qrCodeModel.create({
      restaurantId,
      branchId,
      tableId,
      token,
      isActive: true,
      isDefault: true,
    });

    await this.tableModel
      .findByIdAndUpdate(table._id, {
        $set: { qrCodeId: qrCode._id.toString() },
      })
      .exec();

    return qrCode;
  }

  async listQrs(
    ctx: AuthContext,
    filters: ListQrsFilters = {}
  ): Promise<QRCode[]> {
    const branchId = ctx.branchId;
    if (!branchId) throw new BadRequestException('Branch context required');

    const query: Record<string, unknown> = { branchId };
    if (filters.tableId !== undefined) query.tableId = filters.tableId;
    if (filters.isActive !== undefined) query.isActive = filters.isActive;

    return this.qrCodeModel
      .find(query)
      .sort({ createdAt: -1 })
      .exec();
  }

  async downloadQrPdf(
    ctx: AuthContext,
    opts: { tableIds?: string[]; all?: boolean } = {}
  ): Promise<QrPdfResponse> {
    const branchId = ctx.branchId;
    if (!branchId) throw new BadRequestException('Branch context required');

    const publicUrl =
      process.env.PUBLIC_QR_BASE_URL ||
      process.env.APP_URL ||
      'http://localhost:3000/t';

    let tableQuery: Record<string, unknown> = { branchId, isActive: true };
    if (!opts.all && opts.tableIds && opts.tableIds.length > 0) {
      tableQuery._id = { $in: opts.tableIds };
    }

    const tables = await this.tableModel.find(tableQuery).sort({ zone: 1, name: 1 }).exec();

    const qrPacks: QrPack[] = [];
    for (const table of tables) {
      let qrCode = await this.qrCodeModel
        .findOne({ tableId: table._id.toString(), branchId, isActive: true, isDefault: true })
        .exec();

      if (!qrCode) {
        const regenerated = await this.regenerateQrForTable(ctx, table._id.toString());
        qrCode = regenerated as unknown as typeof qrCode;
      }

      if (!qrCode) continue;

      const token = qrCode.token;
      const encodedPublicUrl = encodeURIComponent(`${publicUrl}/${token}`);
      const downloadUrl = `https://api.qrserver.com/v1/create-qr-code/?size=512x512&data=${encodedPublicUrl}`;

      qrPacks.push({
        tableName: table.name,
        zone: table.zone,
        token,
        svgDataUrl: '',
        pngDataUrl: null,
        downloadUrl,
      });
    }

    return {
      qrPacks,
      layout: {
        columns: 2,
        rows: 5,
        paddingMm: 18,
      },
    };
  }
}
