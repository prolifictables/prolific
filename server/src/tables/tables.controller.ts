import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import * as S from '@prolific/shared-types';
import {
  TablesService,
  CreateTableInput,
  UpdateTableInput,
  ListTablesFilters,
} from './tables.service';
import {
  CurrentUser,
  AuthContext,
} from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequiredPermissions } from '../common/decorators/permissions.decorator';
import { Audit } from '../common/decorators/audit.decorator';

@Controller('tables')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TablesController {
  constructor(private readonly tablesService: TablesService) {}

  @Get()
  @HttpCode(200)
  @RequiredPermissions(S.Permission.TABLE_VIEW)
  async listTables(
    @Query() query: { zone?: string; status?: string; capacity?: string },
    @CurrentUser() user: AuthContext
  ) {
    const filters: ListTablesFilters = {};
    if (query.zone) filters.zone = query.zone;
    if (query.status) filters.status = query.status;
    if (query.capacity) filters.capacity = parseInt(query.capacity, 10);
    return this.tablesService.listTables(user, filters);
  }

  @Post()
  @HttpCode(201)
  @RequiredPermissions(S.Permission.SETTINGS_EDIT)
  @Audit({
    action: S.AuditAction.CREATE,
    entityType: 'TABLE',
    captureChanges: false,
  })
  async createTable(
    @Body() body: CreateTableInput,
    @CurrentUser() user: AuthContext
  ) {
    return this.tablesService.createTable(user, body);
  }

  @Patch(':id')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.SETTINGS_EDIT)
  @Audit({
    action: S.AuditAction.UPDATE,
    entityType: 'TABLE',
    entityIdParam: 'id',
    captureChanges: true,
  })
  async updateTable(
    @Param('id') id: string,
    @Body() body: UpdateTableInput,
    @CurrentUser() user: AuthContext
  ) {
    return this.tablesService.updateTable(user, id, body);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.SETTINGS_EDIT)
  @Audit({
    action: S.AuditAction.DELETE,
    entityType: 'TABLE',
    entityIdParam: 'id',
    captureChanges: true,
  })
  async deleteTable(
    @Param('id') id: string,
    @CurrentUser() user: AuthContext
  ) {
    return this.tablesService.deleteTable(user, id);
  }

  @Get('zones')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.TABLE_VIEW)
  async listFloorZones(@CurrentUser() user: AuthContext) {
    return this.tablesService.listFloorZones(user);
  }
}
