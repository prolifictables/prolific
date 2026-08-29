import {
  Controller,
  Get,
  HttpCode,
  Query,
  UseGuards,
} from '@nestjs/common';
import * as S from '@prolific/shared-types';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequiredPermissions } from '../common/decorators/permissions.decorator';
import {
  CurrentUser,
  AuthContext,
} from '../common/decorators/current-user.decorator';
import {
  TableSessionsService,
  ListTableSessionsFilters,
} from './table-sessions.service';

@Controller('table-sessions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TableSessionsController {
  constructor(private readonly tableSessionsService: TableSessionsService) {}

  @Get()
  @HttpCode(200)
  @RequiredPermissions(S.Permission.TABLE_VIEW)
  async listTableSessions(
    @Query()
    query: {
      status?: string;
      tableId?: string;
      cursor?: string;
      limit?: string;
    },
    @CurrentUser() user: AuthContext
  ) {
    const filters: ListTableSessionsFilters = {};

    if (query.status) {
      const statuses = query.status
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean) as S.TableSessionStatus[];
      filters.status = statuses;
    }
    if (query.tableId) filters.tableId = query.tableId;
    if (query.cursor) filters.cursor = query.cursor;
    if (query.limit) filters.limit = parseInt(query.limit, 10);

    return this.tableSessionsService.listTableSessions(user, filters);
  }
}

