import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@prolific/shared-types';

export const PERMISSIONS_KEY = 'permissions';

export const RequiredPermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
