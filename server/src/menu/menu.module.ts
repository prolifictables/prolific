import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MenuCategory, MenuCategorySchema } from './schemas/menu-category.schema';
import { MenuItem, MenuItemSchema } from './schemas/menu-item.schema';
import { MenuModifier, MenuModifierSchema } from './schemas/menu-modifier.schema';
import { Recipe, RecipeSchema } from './schemas/recipe.schema';
import { MenuService } from './menu.service';
import { MenuController } from './menu.controller';
import { InventoryModule } from '../inventory/inventory.module';
import { TaxesModule } from '../taxes/taxes.module';
import { SocketModule } from '../socket/socket.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MenuCategory.name, schema: MenuCategorySchema },
      { name: MenuItem.name, schema: MenuItemSchema },
      { name: MenuModifier.name, schema: MenuModifierSchema },
      { name: Recipe.name, schema: RecipeSchema },
    ]),
    InventoryModule,
    TaxesModule,
    SocketModule,
  ],
  providers: [MenuService],
  controllers: [MenuController],
  exports: [MongooseModule, MenuService],
})
export class MenuModule {}
