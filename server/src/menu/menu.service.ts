import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as S from '@prolific/shared-types';
import { MenuCategory } from './schemas/menu-category.schema';
import { MenuItem } from './schemas/menu-item.schema';
import { MenuModifier } from './schemas/menu-modifier.schema';
import { Recipe, RecipeIngredient } from './schemas/recipe.schema';
import { InventoryItem } from '../inventory/schemas/inventory-item.schema';
import type { AuthContext } from '../common/decorators/current-user.decorator';
import { SocketGateway } from '../socket/socket.gateway';
import { Tax } from '../taxes/schemas/tax.schema';

export interface CreateCategoryInput {
  name: string;
  description?: string;
  sortOrder?: number;
  imageUrl?: string;
}

export interface UpdateCategoryInput {
  name?: string;
  description?: string;
  sortOrder?: number;
  imageUrl?: string;
  isActive?: boolean;
}

export interface ListItemsFilters {
  status?: S.MenuItemStatus;
  categoryId?: string;
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

export interface RecipeIngredientInput {
  inventoryItemId: string;
  quantity: number;
  unit: S.Unit;
}

export interface CreateMenuItemInput {
  categoryId: string;
  name: string;
  description?: string;
  price: number;
  imageUrl?: string;
  status?: S.MenuItemStatus;
  sortOrder?: number;
  isTaxable?: boolean;
  taxIds?: string[];
  modifierIds?: string[];
  ingredients?: RecipeIngredientInput[];
  scheduledAvailability?: {
    daysOfWeek: number[];
    startTime: string;
    endTime: string;
  };
}

export interface UpdateMenuItemInput {
  categoryId?: string;
  name?: string;
  description?: string;
  price?: number;
  imageUrl?: string;
  status?: S.MenuItemStatus;
  sortOrder?: number;
  isTaxable?: boolean;
  taxIds?: string[];
  modifierIds?: string[];
  scheduledAvailability?: {
    daysOfWeek: number[];
    startTime: string;
    endTime: string;
  };
}

export interface CreateModifierInput {
  name: string;
  description?: string;
  required: boolean;
  multiSelect: boolean;
  minSelections?: number;
  maxSelections?: number;
  options: Array<{
    id?: string;
    name: string;
    priceDelta: number;
    isDefault?: boolean;
  }>;
}

export interface UpdateModifierInput {
  name?: string;
  description?: string;
  required?: boolean;
  multiSelect?: boolean;
  minSelections?: number;
  maxSelections?: number;
  options?: Array<{
    id?: string;
    name: string;
    priceDelta: number;
    isDefault?: boolean;
  }>;
}

export interface CreateOrUpdateRecipeInput {
  name: string;
  servings: number;
  ingredients: RecipeIngredientInput[];
  instructions?: string;
  prepTimeMinutes?: number;
  cookTimeMinutes?: number;
}

@Injectable()
export class MenuService {
  private readonly logger = new Logger(MenuService.name);

  constructor(
    @InjectModel(MenuCategory.name)
    private readonly categoryModel: Model<MenuCategory>,
    @InjectModel(MenuItem.name)
    private readonly menuItemModel: Model<MenuItem>,
    @InjectModel(MenuModifier.name)
    private readonly modifierModel: Model<MenuModifier>,
    @InjectModel(Recipe.name)
    private readonly recipeModel: Model<Recipe>,
    @InjectModel(InventoryItem.name)
    private readonly inventoryItemModel: Model<InventoryItem>,
    @InjectModel(Tax.name)
    private readonly taxModel: Model<Tax>,
    private readonly socketGateway: SocketGateway
  ) {}

  async listCategories(ctx: AuthContext): Promise<MenuCategory[]> {
    const branchId = ctx.branchId;
    if (!branchId) throw new BadRequestException('Branch context required');
    return this.categoryModel
      .find({ branchId, isActive: true })
      .sort({ sortOrder: 1, name: 1 })
      .exec();
  }

  async createCategory(
    ctx: AuthContext,
    input: CreateCategoryInput
  ): Promise<MenuCategory> {
    const branchId = ctx.branchId;
    const restaurantId = ctx.restaurantId;
    if (!branchId || !restaurantId) {
      throw new BadRequestException('Branch and restaurant context required');
    }

    const maxSort = await this.categoryModel
      .findOne({ branchId })
      .sort({ sortOrder: -1 })
      .exec();

    const category = await this.categoryModel.create({
      restaurantId,
      branchId,
      name: input.name,
      description: input.description,
      sortOrder: input.sortOrder ?? (maxSort ? maxSort.sortOrder + 1 : 0),
      isActive: true,
      imageUrl: input.imageUrl,
    });

    return category;
  }

  async updateCategory(
    ctx: AuthContext,
    id: string,
    input: UpdateCategoryInput
  ): Promise<MenuCategory> {
    const branchId = ctx.branchId;
    if (!branchId) throw new BadRequestException('Branch context required');

    const category = await this.categoryModel
      .findOne({ _id: id, branchId })
      .exec();
    if (!category) throw new NotFoundException(`Category ${id} not found`);

    const updated = await this.categoryModel
      .findByIdAndUpdate(category._id, { $set: input }, { new: true })
      .exec();
    if (!updated) throw new NotFoundException('Category disappeared');
    return updated;
  }

  async deleteCategory(ctx: AuthContext, id: string): Promise<MenuCategory> {
    const branchId = ctx.branchId;
    if (!branchId) throw new BadRequestException('Branch context required');

    const category = await this.categoryModel
      .findOne({ _id: id, branchId })
      .exec();
    if (!category) throw new NotFoundException(`Category ${id} not found`);

    const updated = await this.categoryModel
      .findByIdAndUpdate(
        category._id,
        { $set: { isActive: false } },
        { new: true }
      )
      .exec();
    if (!updated) throw new NotFoundException('Category disappeared');
    return updated;
  }

  async listItems(
    ctx: AuthContext,
    filters: ListItemsFilters = {}
  ): Promise<PaginatedResult<MenuItem>> {
    const branchId = ctx.branchId;
    if (!branchId) throw new BadRequestException('Branch context required');

    const limit = Math.min(filters.limit ?? 50, 100);
    const query: Record<string, unknown> = { branchId, isActive: { $ne: false } as any };
    if (filters.status) query.status = filters.status;
    if (filters.categoryId) query.categoryId = filters.categoryId;

    if (filters.cursor) {
      try {
        const decoded = Buffer.from(filters.cursor, 'base64').toString('utf-8');
        const parsed = JSON.parse(decoded);
        if (parsed._id && parsed.sortOrder !== undefined) {
          query.$or = [
            { sortOrder: { $lt: parsed.sortOrder } },
            {
              sortOrder: { $eq: parsed.sortOrder },
              _id: { $lt: new Types.ObjectId(parsed._id) },
            },
          ];
        }
      } catch (_e) {
        throw new BadRequestException('Invalid cursor');
      }
    }

    const docs = await this.menuItemModel
      .find(query)
      .sort({ sortOrder: -1, _id: -1 })
      .limit(limit + 1)
      .exec();

    const hasMore = docs.length > limit;
    const data = docs.slice(0, limit);
    const count = data.length;

    let cursor: string | null = null;
    if (hasMore && data.length > 0) {
      const last = data[data.length - 1];
      cursor = Buffer.from(
        JSON.stringify({
          _id: last._id.toString(),
          sortOrder: last.sortOrder,
        })
      ).toString('base64');
    }

    return { data, meta: { cursor, count, hasMore } };
  }

  async createMenuItem(
    ctx: AuthContext,
    input: CreateMenuItemInput
  ): Promise<MenuItem> {
    const branchId = ctx.branchId;
    const restaurantId = ctx.restaurantId;
    if (!branchId || !restaurantId) {
      throw new BadRequestException('Branch and restaurant context required');
    }

    const category = await this.categoryModel
      .findOne({ _id: input.categoryId, branchId, isActive: true })
      .exec();
    if (!category) {
      throw new BadRequestException(
        `Category ${input.categoryId} not found or inactive`
      );
    }

    let defaultTaxIds: string[] = input.taxIds ?? [];
    if (!input.taxIds) {
      const defaultTaxes = await this.taxModel
        .find({ branchId, isActive: true })
        .exec();
      defaultTaxIds = defaultTaxes.map((t) => t._id.toString());
    }

    const maxSort = await this.menuItemModel
      .findOne({ branchId, categoryId: input.categoryId })
      .sort({ sortOrder: -1 })
      .exec();

    const menuItem = await this.menuItemModel.create({
      restaurantId,
      branchId,
      categoryId: input.categoryId,
      name: input.name,
      description: input.description,
      price: input.price,
      imageUrl: input.imageUrl,
      status: input.status ?? S.MenuItemStatus.AVAILABLE,
      sortOrder: input.sortOrder ?? (maxSort ? maxSort.sortOrder + 1 : 0),
      isTaxable: input.isTaxable ?? true,
      taxIds: defaultTaxIds,
      modifierIds: input.modifierIds ?? [],
      scheduledAvailability: input.scheduledAvailability,
      version: 0,
      lastModifiedAt: new Date(),
      lastModifiedBy: ctx.employeeId ?? ctx.userId,
    });

    if (input.ingredients && input.ingredients.length > 0) {
      const recipeIngredients: RecipeIngredient[] = [];
      for (const ing of input.ingredients) {
        const invItem = await this.inventoryItemModel
          .findOne({ _id: ing.inventoryItemId, branchId })
          .exec();
        if (!invItem) {
          this.logger.warn(
            `InventoryItem ${ing.inventoryItemId} not found for recipe, skipping`
          );
          continue;
        }
        recipeIngredients.push({
          inventoryItemId: ing.inventoryItemId,
          inventoryItemName: invItem.name,
          quantity: ing.quantity,
          unit: ing.unit,
          costAtRecipeTime: invItem.unitCostCents,
        } as unknown as RecipeIngredient);
      }

      if (recipeIngredients.length > 0) {
        const recipe = await this.recipeModel.create({
          restaurantId,
          branchId,
          menuItemId: menuItem._id.toString(),
          name: `${input.name} Recipe`,
          servings: 1,
          ingredients: recipeIngredients,
        });

        await this.menuItemModel
          .findByIdAndUpdate(menuItem._id, {
            $set: { recipeId: recipe._id.toString() },
          })
          .exec();
      }
    }

    const result = await this.menuItemModel.findById(menuItem._id).exec();
    if (!result) throw new NotFoundException('MenuItem disappeared');
    return result;
  }

  async updateMenuItem(
    ctx: AuthContext,
    id: string,
    input: UpdateMenuItemInput
  ): Promise<MenuItem> {
    const branchId = ctx.branchId;
    if (!branchId) throw new BadRequestException('Branch context required');

    const menuItem = await this.menuItemModel
      .findOne({ _id: id, branchId })
      .exec();
    if (!menuItem) throw new NotFoundException(`MenuItem ${id} not found`);

    if (input.categoryId) {
      const category = await this.categoryModel
        .findOne({ _id: input.categoryId, branchId, isActive: true })
        .exec();
      if (!category) {
        throw new BadRequestException(
          `Category ${input.categoryId} not found or inactive`
        );
      }
    }

    const oldStatus = menuItem.status;
    const newStatus = input.status;
    const statusChangedToOOS =
      newStatus && newStatus !== oldStatus && newStatus === S.MenuItemStatus.OUT_OF_STOCK;

    const updateFields: Record<string, unknown> = {
      ...input,
      version: menuItem.version + 1,
      lastModifiedAt: new Date(),
      lastModifiedBy: ctx.employeeId ?? ctx.userId,
    };

    const updated = await this.menuItemModel
      .findByIdAndUpdate(menuItem._id, { $set: updateFields }, { new: true })
      .exec();
    if (!updated) throw new NotFoundException('MenuItem disappeared');

    if (statusChangedToOOS) {
      this.socketGateway.broadcast(`branch:${branchId}`, 'menu:item:status:changed', {
        menuItemId: id,
        status: S.MenuItemStatus.OUT_OF_STOCK,
        branchId,
        timestamp: new Date(),
      });
    }

    return updated;
  }

  async deleteMenuItem(ctx: AuthContext, id: string): Promise<MenuItem> {
    const branchId = ctx.branchId;
    if (!branchId) throw new BadRequestException('Branch context required');

    const menuItem = await this.menuItemModel
      .findOne({ _id: id, branchId })
      .exec();
    if (!menuItem) throw new NotFoundException(`MenuItem ${id} not found`);

    const updated = await this.menuItemModel
      .findByIdAndUpdate(
        menuItem._id,
        {
          $set: {
            status: S.MenuItemStatus.DISABLED,
            version: menuItem.version + 1,
            lastModifiedAt: new Date(),
            lastModifiedBy: ctx.employeeId ?? ctx.userId,
          },
        },
        { new: true }
      )
      .exec();
    if (!updated) throw new NotFoundException('MenuItem disappeared');
    return updated;
  }

  async listModifiers(ctx: AuthContext): Promise<MenuModifier[]> {
    const branchId = ctx.branchId;
    if (!branchId) throw new BadRequestException('Branch context required');
    return this.modifierModel.find({ branchId }).sort({ name: 1 }).exec();
  }

  async createModifier(
    ctx: AuthContext,
    input: CreateModifierInput
  ): Promise<MenuModifier> {
    const branchId = ctx.branchId;
    const restaurantId = ctx.restaurantId;
    if (!branchId || !restaurantId) {
      throw new BadRequestException('Branch and restaurant context required');
    }

    const options = input.options.map((o) => ({
      id: o.id ?? new Types.ObjectId().toString(),
      name: o.name,
      priceDelta: o.priceDelta,
      isDefault: o.isDefault ?? false,
    }));

    const modifier = await this.modifierModel.create({
      restaurantId,
      branchId,
      name: input.name,
      description: input.description,
      required: input.required,
      multiSelect: input.multiSelect,
      minSelections: input.minSelections ?? 0,
      maxSelections: input.maxSelections ?? 1,
      options,
    });

    return modifier;
  }

  async updateModifier(
    ctx: AuthContext,
    id: string,
    input: UpdateModifierInput
  ): Promise<MenuModifier> {
    const branchId = ctx.branchId;
    if (!branchId) throw new BadRequestException('Branch context required');

    const modifier = await this.modifierModel
      .findOne({ _id: id, branchId })
      .exec();
    if (!modifier) throw new NotFoundException(`Modifier ${id} not found`);

    const updateFields: Record<string, unknown> = {};
    if (input.name !== undefined) updateFields.name = input.name;
    if (input.description !== undefined) updateFields.description = input.description;
    if (input.required !== undefined) updateFields.required = input.required;
    if (input.multiSelect !== undefined) updateFields.multiSelect = input.multiSelect;
    if (input.minSelections !== undefined) updateFields.minSelections = input.minSelections;
    if (input.maxSelections !== undefined) updateFields.maxSelections = input.maxSelections;
    if (input.options) {
      updateFields.options = input.options.map((o) => ({
        id: o.id ?? new Types.ObjectId().toString(),
        name: o.name,
        priceDelta: o.priceDelta,
        isDefault: o.isDefault ?? false,
      }));
    }

    const updated = await this.modifierModel
      .findByIdAndUpdate(modifier._id, { $set: updateFields }, { new: true })
      .exec();
    if (!updated) throw new NotFoundException('Modifier disappeared');
    return updated;
  }

  async getRecipeByMenuItemId(
    ctx: AuthContext,
    menuItemId: string
  ): Promise<Recipe | null> {
    const branchId = ctx.branchId;
    if (!branchId) throw new BadRequestException('Branch context required');

    const recipe = await this.recipeModel
      .findOne({ menuItemId, branchId })
      .exec();
    return recipe ?? null;
  }

  async createOrUpdateRecipe(
    ctx: AuthContext,
    menuItemId: string,
    input: CreateOrUpdateRecipeInput
  ): Promise<Recipe> {
    const branchId = ctx.branchId;
    const restaurantId = ctx.restaurantId;
    if (!branchId || !restaurantId) {
      throw new BadRequestException('Branch and restaurant context required');
    }

    const menuItem = await this.menuItemModel
      .findOne({ _id: menuItemId, branchId })
      .exec();
    if (!menuItem) {
      throw new NotFoundException(`MenuItem ${menuItemId} not found`);
    }

    const recipeIngredients: RecipeIngredient[] = [];
    for (const ing of input.ingredients) {
      const invItem = await this.inventoryItemModel
        .findOne({ _id: ing.inventoryItemId, branchId })
        .exec();
      if (!invItem) {
        throw new NotFoundException(
          `InventoryItem ${ing.inventoryItemId} not found`
        );
      }
      recipeIngredients.push({
        inventoryItemId: ing.inventoryItemId,
        inventoryItemName: invItem.name,
        quantity: ing.quantity,
        unit: ing.unit,
        costAtRecipeTime: invItem.unitCostCents,
      } as unknown as RecipeIngredient);
    }

    const existing = await this.recipeModel
      .findOne({ menuItemId, branchId })
      .exec();

    let recipe: Recipe;
    if (existing) {
      recipe = (await this.recipeModel
        .findByIdAndUpdate(
          existing._id,
          {
            $set: {
              name: input.name,
              servings: input.servings,
              ingredients: recipeIngredients,
              instructions: input.instructions,
              prepTimeMinutes: input.prepTimeMinutes,
              cookTimeMinutes: input.cookTimeMinutes,
            },
          },
          { new: true }
        )
        .exec())!;
    } else {
      recipe = await this.recipeModel.create({
        restaurantId,
        branchId,
        menuItemId,
        name: input.name,
        servings: input.servings,
        ingredients: recipeIngredients,
        instructions: input.instructions,
        prepTimeMinutes: input.prepTimeMinutes,
        cookTimeMinutes: input.cookTimeMinutes,
      });

      await this.menuItemModel
        .findByIdAndUpdate(menuItem._id, {
          $set: {
            recipeId: recipe._id.toString(),
            version: menuItem.version + 1,
            lastModifiedAt: new Date(),
            lastModifiedBy: ctx.employeeId ?? ctx.userId,
          },
        })
        .exec();
    }

    return recipe;
  }
}
