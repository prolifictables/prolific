import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import * as S from '@prolific/shared-types';
import {
  MenuService,
  CreateCategoryInput,
  UpdateCategoryInput,
  ListItemsFilters,
  CreateMenuItemInput,
  UpdateMenuItemInput,
  CreateModifierInput,
  UpdateModifierInput,
  CreateOrUpdateRecipeInput,
} from './menu.service';
import {
  CurrentUser,
  AuthContext,
} from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequiredPermissions } from '../common/decorators/permissions.decorator';
import { Audit } from '../common/decorators/audit.decorator';

@Controller('menu')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MenuController {
  constructor(private readonly menuService: MenuService) {}

  @Get('categories')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.MENU_VIEW)
  async listCategories(@CurrentUser() user: AuthContext) {
    return this.menuService.listCategories(user);
  }

  @Post('categories')
  @HttpCode(201)
  @RequiredPermissions(S.Permission.MENU_EDIT)
  @Audit({
    action: S.AuditAction.CREATE,
    entityType: 'MENU_CATEGORY',
    captureChanges: false,
  })
  async createCategory(
    @Body() body: CreateCategoryInput,
    @CurrentUser() user: AuthContext
  ) {
    return this.menuService.createCategory(user, body);
  }

  @Patch('categories/:id')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.MENU_EDIT)
  @Audit({
    action: S.AuditAction.UPDATE,
    entityType: 'MENU_CATEGORY',
    entityIdParam: 'id',
    captureChanges: true,
  })
  async updateCategory(
    @Param('id') id: string,
    @Body() body: UpdateCategoryInput,
    @CurrentUser() user: AuthContext
  ) {
    return this.menuService.updateCategory(user, id, body);
  }

  @Delete('categories/:id')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.MENU_EDIT)
  @Audit({
    action: S.AuditAction.DELETE,
    entityType: 'MENU_CATEGORY',
    entityIdParam: 'id',
    captureChanges: true,
  })
  async deleteCategory(
    @Param('id') id: string,
    @CurrentUser() user: AuthContext
  ) {
    return this.menuService.deleteCategory(user, id);
  }

  @Get('items')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.MENU_VIEW)
  async listItems(
    @Query() query: {
      status?: string;
      categoryId?: string;
      cursor?: string;
      limit?: string;
    },
    @CurrentUser() user: AuthContext
  ) {
    const filters: ListItemsFilters = {};
    if (query.status) filters.status = query.status as S.MenuItemStatus;
    if (query.categoryId) filters.categoryId = query.categoryId;
    if (query.cursor) filters.cursor = query.cursor;
    if (query.limit) filters.limit = parseInt(query.limit, 10);
    return this.menuService.listItems(user, filters);
  }

  @Post('items')
  @HttpCode(201)
  @RequiredPermissions(S.Permission.MENU_EDIT)
  @Audit({
    action: S.AuditAction.CREATE,
    entityType: 'MENU_ITEM',
    captureChanges: false,
  })
  async createMenuItem(
    @Body() body: CreateMenuItemInput,
    @CurrentUser() user: AuthContext
  ) {
    return this.menuService.createMenuItem(user, body);
  }

  @Patch('items/:id')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.MENU_EDIT)
  @Audit({
    action: S.AuditAction.UPDATE,
    entityType: 'MENU_ITEM',
    entityIdParam: 'id',
    captureChanges: true,
  })
  async updateMenuItem(
    @Param('id') id: string,
    @Body() body: UpdateMenuItemInput,
    @CurrentUser() user: AuthContext
  ) {
    return this.menuService.updateMenuItem(user, id, body);
  }

  @Delete('items/:id')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.MENU_EDIT)
  @Audit({
    action: S.AuditAction.DELETE,
    entityType: 'MENU_ITEM',
    entityIdParam: 'id',
    captureChanges: true,
  })
  async deleteMenuItem(
    @Param('id') id: string,
    @CurrentUser() user: AuthContext
  ) {
    return this.menuService.deleteMenuItem(user, id);
  }

  @Get('modifiers')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.MENU_VIEW)
  async listModifiers(@CurrentUser() user: AuthContext) {
    return this.menuService.listModifiers(user);
  }

  @Post('modifiers')
  @HttpCode(201)
  @RequiredPermissions(S.Permission.MENU_EDIT)
  @Audit({
    action: S.AuditAction.CREATE,
    entityType: 'MENU_MODIFIER',
    captureChanges: false,
  })
  async createModifier(
    @Body() body: CreateModifierInput,
    @CurrentUser() user: AuthContext
  ) {
    return this.menuService.createModifier(user, body);
  }

  @Patch('modifiers/:id')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.MENU_EDIT)
  @Audit({
    action: S.AuditAction.UPDATE,
    entityType: 'MENU_MODIFIER',
    entityIdParam: 'id',
    captureChanges: true,
  })
  async updateModifier(
    @Param('id') id: string,
    @Body() body: UpdateModifierInput,
    @CurrentUser() user: AuthContext
  ) {
    return this.menuService.updateModifier(user, id, body);
  }

  @Get('items/:menuItemId/recipe')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.MENU_VIEW)
  async getRecipe(
    @Param('menuItemId') menuItemId: string,
    @CurrentUser() user: AuthContext
  ) {
    return this.menuService.getRecipeByMenuItemId(user, menuItemId);
  }

  @Put('items/:menuItemId/recipe')
  @HttpCode(200)
  @RequiredPermissions(S.Permission.MENU_EDIT)
  @Audit({
    action: S.AuditAction.UPDATE,
    entityType: 'RECIPE',
    captureChanges: true,
  })
  async createOrUpdateRecipe(
    @Param('menuItemId') menuItemId: string,
    @Body() body: CreateOrUpdateRecipeInput,
    @CurrentUser() user: AuthContext
  ) {
    return this.menuService.createOrUpdateRecipe(user, menuItemId, body);
  }
}
