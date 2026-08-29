import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as S from '@prolific/shared-types';
import { TableSession } from './schemas/table-session.schema';
import type { AuthContext } from '../common/decorators/current-user.decorator';

export interface ListTableSessionsFilters {
  status?: S.TableSessionStatus[];
  tableId?: string;
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

@Injectable()
export class TableSessionsService {
  constructor(
    @InjectModel(TableSession.name)
    private readonly tableSessionModel: Model<TableSession>
  ) {}

  async listTableSessions(
    ctx: AuthContext,
    filters: ListTableSessionsFilters = {}
  ): Promise<PaginatedResult<TableSession>> {
    const branchId = ctx.branchId;
    if (!branchId) {
      throw new BadRequestException('Branch context required');
    }

    const limit = Math.min(filters.limit ?? 50, 100);
    const query: Record<string, unknown> = { branchId };

    if (filters.tableId) query.tableId = filters.tableId;
    if (filters.status && filters.status.length > 0) {
      query.status = { $in: filters.status };
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

    const docs = await this.tableSessionModel
      .find(query)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .exec();

    const hasMore = docs.length > limit;
    const data = docs.slice(0, limit);
    const count = data.length;

    let cursor: string | null = null;
    if (hasMore && data.length > 0) {
      const last = data[data.length - 1] as unknown as { _id: any };
      cursor = Buffer.from(JSON.stringify({ _id: String(last._id) })).toString(
        'base64'
      );
    }

    return { data, meta: { cursor, count, hasMore } };
  }
}
