import {
  Body,
  Controller,
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
  EmployeesService,
  CreateEmployeeInput,
  UpdateEmployeeInput,
  ListEmployeesFilters,
} from './employees.service';
import {
  CurrentUser,
  AuthContext,
} from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequiredPermissions } from '../common/decorators/permissions.decorator';
import { Audit } from '../common/decorators/audit.decorator';

@Controller('employees')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Get()
  @HttpCode(200)
  @RequiredPermissions(S.Permission.EMPLOYEE_VIEW)
  async listEmployees(
    @Query() query: {
      role?: string;
      status?: string;
      cursor?: string;
      limit?: string;
    },
    @CurrentUser() user: AuthContext
  ) {
    const filters: ListEmployeesFilters = {};
    if (query.role) filters.role = query.role as S.Role;
    if (query.status) filters.status = query.status as 'active' | 'inactive';
    if (query.cursor) filters.cursor = query.cursor;
    if (query.limit) filters.limit = parseInt(query.limit, 10);
    return this.employeesService.listEmployees(user, filters);
  }

  @Post()
  @HttpCode(201)
  @RequiredPermissions(S.Permission.EMPLOYEE_CREATE)
  @Audit({
    action: S.AuditAction.CREATE,
    entityType: 'EMPLOYEE',
    captureChanges: false,
  })
  async createEmployee(
    @Body() body: CreateEmployeeInput,
    @CurrentUser() user: AuthContext
  ) {
    return this.employeesService.createEmployee(user, body);
  }

  @Patch(':id')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.EMPLOYEE_EDIT)
  @Audit({
    action: S.AuditAction.UPDATE,
    entityType: 'EMPLOYEE',
    entityIdParam: 'id',
    captureChanges: true,
  })
  async updateEmployee(
    @Param('id') id: string,
    @Body() body: UpdateEmployeeInput,
    @CurrentUser() user: AuthContext
  ) {
    return this.employeesService.updateEmployee(user, id, body);
  }

  @Post(':id/toggle-active')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.EMPLOYEE_EDIT)
  @Audit({
    action: S.AuditAction.UPDATE,
    entityType: 'EMPLOYEE',
    entityIdParam: 'id',
    captureChanges: true,
  })
  async toggleActive(
    @Param('id') id: string,
    @CurrentUser() user: AuthContext
  ) {
    return this.employeesService.toggleActive(user, id);
  }

  @Post(':id/reset-pin')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.EMPLOYEE_EDIT)
  @Audit({
    action: S.AuditAction.UPDATE,
    entityType: 'EMPLOYEE',
    entityIdParam: 'id',
    captureChanges: true,
  })
  async resetPin(
    @Param('id') id: string,
    @CurrentUser() user: AuthContext
  ) {
    return this.employeesService.resetPin(user, id);
  }

  @Get('roles')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.EMPLOYEE_VIEW, S.Permission.ROLE_ASSIGN)
  async getEmployeeRoles(@CurrentUser() user: AuthContext) {
    return this.employeesService.getEmployeeRoles(user);
  }
}
