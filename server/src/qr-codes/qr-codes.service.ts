import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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

    // Permanent QR contract: once a table has ANY QR token (printed & taped
    // onto the physical table), that token must NEVER be rotated, invalidated,
    // or reassigned. Managers can only generate a token ONCE per new table.
    // If you need to replace a sticker because it got damaged, open a support
    // ticket / DB migration — never expose a UI path for accidental rotation.
    const anyExisting = await this.qrCodeModel
      .findOne({ tableId: table._id.toString(), branchId })
      .exec();
    if (anyExisting) {
      throw new BadRequestException(
        'This table already has a permanent QR code. Use the "Download QR" button to re-print the existing sticker.'
      );
    }

    const token = generateToken();
    const qrCode = await this.qrCodeModel.create({
      restaurantId,
      branchId,
      tableId,
      token,
      isActive: true,
      // First and only QR for this table → mark as the default, permanent
      // token. Any future attempt to call /regenerate on this table will hit
      // the anyExisting guard above and throw.
      isDefault: true,
    });

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

    // Resolve the public Website surface URL that gets encoded into every
    // printable QR code. Customers scan the sticker → land here →
    // GET /public/table-resolve?table= takes over. Priority chain:
    //   (1) PUBLIC_QR_BASE_URL — operator explicitly sets it (Render env override)
    //   (2) WEBSITE_URL env + /order suffix (explicit Website surface env)
    //   (3) APP_URL env + /order suffix (legacy generic app env)
    //   (4) Production confirmed www.prolifictables.com/order (NEVER localhost in prod!)
    const websiteUrl =
      process.env.PUBLIC_QR_BASE_URL ||
      (process.env.WEBSITE_URL ? `${process.env.WEBSITE_URL.replace(/\/+$/, '')}/order` : undefined) ||
      (process.env.APP_URL ? `${process.env.APP_URL.replace(/\/+$/, '')}/order` : undefined) ||
      'https://www.prolifictables.com/order';
    const publicUrl = websiteUrl;

    let tableQuery: Record<string, unknown> = { branchId, isActive: true };
    if (!opts.all && opts.tableIds && opts.tableIds.length > 0) {
      tableQuery._id = { $in: opts.tableIds };
    }

    const tables = await this.tableModel.find(tableQuery).sort({ zone: 1, name: 1 }).exec();

    const qrPacks: QrPack[] = [];
    for (const table of tables) {
      let qrCode = await this.qrCodeModel
        .findOne({ tableId: table._id.toString(), branchId, isActive: true })
        // Prefer default QR when available; fall back to first active (legacy
        // data where first create ended up with isDefault=false).
        .sort({ isDefault: -1, createdAt: 1 })
        .exec();

      if (!qrCode) {
        // Table has never had a QR → generate the one, permanent, default
        // token for this brand-new table. This call throws if a QR somehow
        // appears between the findOne and create (race-safe on tableId unique
        // constraints at the DB layer).
        const fresh = await this.regenerateQrForTable(ctx, table._id.toString());
        qrCode = fresh as unknown as typeof qrCode;
      }

      if (!qrCode) continue;

      const token = qrCode.token;
      const encodedPublicUrl = encodeURIComponent(`${publicUrl}?table=${encodeURIComponent(token)}`);
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
