import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { SeedService } from './seed.service';
import { SeedController } from './seed.controller';
import { AuthModule } from '../auth/auth.module';

import { User, UserSchema } from '../users/schemas/user.schema';
import { Employee, EmployeeSchema } from '../employees/schemas/employee.schema';
import { Restaurant, RestaurantSchema } from '../restaurants/schemas/restaurant.schema';
import { Branch, BranchSchema } from '../branches/schemas/branch.schema';
import { Device, DeviceSchema } from '../devices/schemas/device.schema';
import { MenuCategory, MenuCategorySchema } from '../menu/schemas/menu-category.schema';
import { MenuItem, MenuItemSchema } from '../menu/schemas/menu-item.schema';
import { MenuModifier, MenuModifierSchema } from '../menu/schemas/menu-modifier.schema';
import { Recipe, RecipeSchema } from '../menu/schemas/recipe.schema';
import { Tax, TaxSchema } from '../taxes/schemas/tax.schema';
import { Discount, DiscountSchema } from '../discounts/schemas/discount.schema';
import { Table, TableSchema } from '../tables/schemas/table.schema';
import { QRCode, QRCodeSchema } from '../qr-codes/schemas/qr-code.schema';
import { Setting, SettingSchema } from '../settings/schemas/setting.schema';
import { InventoryItem, InventoryItemSchema } from '../inventory/schemas/inventory-item.schema';
import { Supplier, SupplierSchema } from '../suppliers/schemas/supplier.schema';
import { RoleDefinition, RoleDefinitionSchema } from '../rbac/schemas/role.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Employee.name, schema: EmployeeSchema },
      { name: Restaurant.name, schema: RestaurantSchema },
      { name: Branch.name, schema: BranchSchema },
      { name: Device.name, schema: DeviceSchema },
      { name: MenuCategory.name, schema: MenuCategorySchema },
      { name: MenuItem.name, schema: MenuItemSchema },
      { name: MenuModifier.name, schema: MenuModifierSchema },
      { name: Recipe.name, schema: RecipeSchema },
      { name: Tax.name, schema: TaxSchema },
      { name: Discount.name, schema: DiscountSchema },
      { name: Table.name, schema: TableSchema },
      { name: QRCode.name, schema: QRCodeSchema },
      { name: Setting.name, schema: SettingSchema },
      { name: InventoryItem.name, schema: InventoryItemSchema },
      { name: Supplier.name, schema: SupplierSchema },
      { name: RoleDefinition.name, schema: RoleDefinitionSchema },
    ]),
    AuthModule,
  ],
  providers: [SeedService],
  controllers: [SeedController],
})
export class SeedModule {}
