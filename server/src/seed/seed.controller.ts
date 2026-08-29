import { Controller, Post, HttpCode, UseGuards } from '@nestjs/common';
import { SeedService } from './seed.service';
import { RequiredPermissions } from '../common/decorators/permissions.decorator';
import { Permission, AuditAction } from '@prolific/shared-types';
import { Audit } from '../common/decorators/audit.decorator';

/**
 * Optional HTTP endpoint for manually triggering the seed process.
 * Requires SUPER_ADMIN-level permissions (MENU_EDIT + EMPLOYEE_EDIT as a proxy).
 */
@Controller('seed')
export class SeedController {
  constructor(private readonly seedService: SeedService) {}

  @Post('run')
  @HttpCode(200)
  @RequiredPermissions(Permission.MENU_EDIT, Permission.EMPLOYEE_CREATE)
  @Audit({ action: AuditAction.CREATE, entityType: 'SEED' })
  async runSeed(): Promise<{ status: string; message: string }> {
    try {
      await this.seedService.runSeed();
      return { status: 'success', message: 'Seed completed successfully' };
    } catch (e) {
      return {
        status: 'error',
        message: (e as Error).message,
      };
    }
  }
}
