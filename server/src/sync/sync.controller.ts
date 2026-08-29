import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  HttpCode,
  Logger,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { CurrentUser, AuthContext } from '../common/decorators/current-user.decorator';
import { RequiredPermissions } from '../common/decorators/permissions.decorator';
import { Permission, Role } from '@prolific/shared-types';
import {
  Allow,
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  SyncService,
  SyncCommand,
  SyncResult,
} from './sync.service';

class SyncCommandDto {
  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;

  @IsString()
  @IsNotEmpty()
  entityType!: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(['CREATE', 'UPDATE', 'DELETE'])
  operation!: SyncCommand['operation'];

  @Allow()
  entityId?: unknown;

  @Allow()
  payload?: unknown;

  @Allow()
  localEntityVersion?: unknown;

  toSyncCommand(): SyncCommand {
    const entityId =
      this.entityId == null
        ? undefined
        : typeof this.entityId === 'string'
          ? this.entityId
          : String(this.entityId);

    const localEntityVersion =
      typeof this.localEntityVersion === 'number' ? this.localEntityVersion : undefined;

    return {
      idempotencyKey: this.idempotencyKey,
      entityType: this.entityType,
      operation: this.operation,
      ...(entityId ? { entityId } : {}),
      payload:
        this.payload && typeof this.payload === 'object'
          ? (this.payload as Record<string, unknown>)
          : {},
      ...(localEntityVersion !== undefined ? { localEntityVersion } : {}),
    };
  }
}

class SyncBatchRequest {
  @IsString()
  @IsNotEmpty()
  deviceId!: string;

  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SyncCommandDto)
  commands!: SyncCommandDto[];
}

@Controller('sync')
export class SyncController {
  private readonly logger = new Logger(SyncController.name);

  constructor(private readonly syncService: SyncService) {}

  private static isDeviceAuthorized(ctx: AuthContext): boolean {
    const deviceRoles = new Set([
      Role.CASHIER,
      Role.MANAGER,
      Role.ADMIN,
      Role.SUPER_ADMIN,
      Role.WAITER,
      Role.KITCHEN,
    ]);
    return deviceRoles.has(ctx.role);
  }

  @Post('batch')
  @HttpCode(200)
  @RequiredPermissions(Permission.ORDER_CREATE, Permission.PAYMENT_ACCEPT)
  async applyBatch(
    @CurrentUser() ctx: AuthContext,
    @Body(new ValidationPipe({ whitelist: false, transform: true })) body: SyncBatchRequest
  ): Promise<{ data: SyncResult[] }> {
    if (!SyncController.isDeviceAuthorized(ctx)) {
      throw new BadRequestException('Role not authorized for sync operations');
    }

    const { deviceId, commands } = body;

    if (!deviceId) {
      throw new BadRequestException('deviceId is required');
    }
    if (!Array.isArray(commands)) {
      throw new BadRequestException('commands must be an array');
    }
    if (commands.length > 500) {
      throw new BadRequestException('commands batch too large (max 500)');
    }

    for (let i = 0; i < commands.length; i++) {
      const c = commands[i];
      if (!c.idempotencyKey) {
        throw new BadRequestException(`commands[${i}].idempotencyKey is required`);
      }
      if (!c.entityType) {
        throw new BadRequestException(`commands[${i}].entityType is required`);
      }
      if (!c.operation || !['CREATE', 'UPDATE', 'DELETE'].includes(c.operation)) {
        throw new BadRequestException(
          `commands[${i}].operation must be CREATE|UPDATE|DELETE`
        );
      }
      if (!c.payload || typeof c.payload !== 'object') {
        throw new BadRequestException(`commands[${i}].payload must be an object`);
      }
    }

    this.logger.debug(
      `[sync/batch] device=${deviceId} user=${ctx.userId} role=${ctx.role} commands=${commands.length}`
    );

    const normalizedCommands = commands.map((c) => c.toSyncCommand());
    const results = await this.syncService.applyBatch(ctx, deviceId, normalizedCommands);

    return { data: results };
  }

  @Get('pull')
  @RequiredPermissions(Permission.ORDER_VIEW, Permission.MENU_VIEW)
  async pullUpdates(
    @CurrentUser() ctx: AuthContext,
    @Query('deviceId') deviceId: string,
    @Query('cursor') cursor?: string,
    @Query('entityTypes') entityTypes?: string,
    @Query('limit') limit?: string,
    @Query('since') since?: string
  ): Promise<{
    data: Array<{ entityType: string; entity: Record<string, unknown>; version: number }>;
    nextCursor: string | null;
    count: number;
    hasMore: boolean;
  }> {
    if (!SyncController.isDeviceAuthorized(ctx)) {
      throw new BadRequestException('Role not authorized for sync operations');
    }

    if (!deviceId) {
      throw new BadRequestException('deviceId query param is required');
    }

    const entityTypesParsed = entityTypes
      ? entityTypes.split(',').map((s) => s.trim())
      : undefined;

    const limitParsed = limit ? parseInt(limit, 10) : undefined;
    const sinceParsed = since ? new Date(since) : undefined;

    this.logger.debug(
      `[sync/pull] device=${deviceId} user=${ctx.userId} role=${ctx.role} cursor=${cursor ?? '-'} types=${entityTypesParsed?.join(',') ?? 'ALL'}`
    );

    const result = await this.syncService.pullUpdates(ctx, deviceId, {
      cursor,
      entityTypes: entityTypesParsed,
      limit: limitParsed,
      sinceDate: sinceParsed,
    });

    return result;
  }
}
