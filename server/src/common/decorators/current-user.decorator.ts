import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Employee, Role, Permission } from '@prolific/shared-types';

export interface AuthContext {
  userId: string;
  employeeId: string | null;
  restaurantId: string | null;
  branchId: string | null;
  role: Role;
  permissions: Permission[];
  tokenType: 'access' | 'approval' | 'anonymous';
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
}

/**
 * Extracts the current authentication context from the JWT request.
 * Usage: @CurrentUser() user: AuthContext
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as AuthContext;
  }
);
