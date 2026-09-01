import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as crypto from 'crypto';
import * as S from '@prolific/shared-types';

import { AuthService } from '../auth/auth.service';
import { User } from '../users/schemas/user.schema';
import { Employee } from '../employees/schemas/employee.schema';
import { Restaurant } from '../restaurants/schemas/restaurant.schema';
import { Branch } from '../branches/schemas/branch.schema';
import { Device } from '../devices/schemas/device.schema';
import { MenuCategory } from '../menu/schemas/menu-category.schema';
import { MenuItem } from '../menu/schemas/menu-item.schema';
import { MenuModifier } from '../menu/schemas/menu-modifier.schema';
import { Recipe } from '../menu/schemas/recipe.schema';
import { Tax } from '../taxes/schemas/tax.schema';
import { Discount } from '../discounts/schemas/discount.schema';
import { Table } from '../tables/schemas/table.schema';
import { QRCode } from '../qr-codes/schemas/qr-code.schema';
import { Setting } from '../settings/schemas/setting.schema';
import { InventoryItem } from '../inventory/schemas/inventory-item.schema';
import { Supplier } from '../suppliers/schemas/supplier.schema';
import { RoleDefinition } from '../rbac/schemas/role.schema';

type N = (n: number) => number;
const N: N = (n) => n * 100;

@Injectable()
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    private readonly authService: AuthService,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Employee.name) private readonly employeeModel: Model<Employee>,
    @InjectModel(Restaurant.name) private readonly restaurantModel: Model<Restaurant>,
    @InjectModel(Branch.name) private readonly branchModel: Model<Branch>,
    @InjectModel(Device.name) private readonly deviceModel: Model<Device>,
    @InjectModel(MenuCategory.name) private readonly menuCategoryModel: Model<MenuCategory>,
    @InjectModel(MenuItem.name) private readonly menuItemModel: Model<MenuItem>,
    @InjectModel(MenuModifier.name) private readonly menuModifierModel: Model<MenuModifier>,
    @InjectModel(Recipe.name) private readonly recipeModel: Model<Recipe>,
    @InjectModel(Tax.name) private readonly taxModel: Model<Tax>,
    @InjectModel(Discount.name) private readonly discountModel: Model<Discount>,
    @InjectModel(Table.name) private readonly tableModel: Model<Table>,
    @InjectModel(QRCode.name) private readonly qrCodeModel: Model<QRCode>,
    @InjectModel(Setting.name) private readonly settingModel: Model<Setting>,
    @InjectModel(InventoryItem.name) private readonly inventoryItemModel: Model<InventoryItem>,
    @InjectModel(Supplier.name) private readonly supplierModel: Model<Supplier>,
    @InjectModel(RoleDefinition.name) private readonly roleDefinitionModel: Model<RoleDefinition>
  ) {}

  async onModuleInit(): Promise<void> {
    await this.runSeedIfEnabled();
  }

  async runSeedIfEnabled(): Promise<void> {
    if (process.env.SEED_ENABLED !== 'true') {
      this.logger.log('SEED_ENABLED !== true — skipping seed');
      return;
    }
    try {
      if (process.env.SEED_RUN_ONCE === 'true') {
        const alreadyExecuted = await this.settingModel
          .findOne({ key: 'seed.executed', scope: 'GLOBAL' })
          .exec();
        if (alreadyExecuted) {
          this.logger.log('seed.executed already present (SEED_RUN_ONCE=true) — skipping');
          return;
        }
      }

      this.logger.log('Starting demo tenant seed...');
      const summary = await this.runSeed();
      this.logger.log(`Seed completed successfully. Summary: ${JSON.stringify(summary, null, 2)}`);

      await this.settingModel.create({
        key: 'seed.executed',
        scope: 'GLOBAL',
        value: true,
        valueType: 'BOOLEAN',
        restaurantId: null,
        branchId: null,
        schemaVersion: 1,
      });
      this.logger.log('Wrote setting key=seed.executed scope=GLOBAL');
    } catch (e) {
      this.logger.fatal(`Seed failed fatally: ${(e as Error).message}`, (e as Error).stack);
    }
  }

  async runSeed(): Promise<Record<string, unknown>> {
    const createdIds: Record<string, unknown> = {};

    const superAdmin = await this.createSuperAdmin();
    createdIds.superAdminUserId = superAdmin._id.toString();
    this.logger.log(`[1/17] Created super admin: ${superAdmin.email} (${superAdmin._id})`);

    const restaurant = await this.createRestaurant();
    createdIds.restaurantId = restaurant._id.toString();
    this.logger.log(`[2/17] Created restaurant: ${restaurant.name} (${restaurant._id})`);

    const branches = await this.createBranches(restaurant._id.toString());
    createdIds.branchIds = branches.map((b) => ({ name: b.name, id: b._id.toString() }));
    this.logger.log(`[3/17] Created ${branches.length} branches`);

    for (const branch of branches) {
      const branchId = branch._id.toString();
      const restaurantId = restaurant._id.toString();

      const employees = await this.createEmployeesForBranch(
        restaurantId,
        branchId,
        superAdmin._id.toString()
      );
      this.logger.log(`  Branch "${branch.name}": Created ${employees.length} employees`);

      const device = await this.createPosDevice(restaurantId, branchId);
      this.logger.log(`  Branch "${branch.name}": Created POS device ${device.name}`);

      const categories = await this.createMenuCategories(restaurantId, branchId);
      this.logger.log(`  Branch "${branch.name}": Created ${categories.length} menu categories`);

      const vatTax = await this.createVatTax(restaurantId, branchId);
      this.logger.log(`  Branch "${branch.name}": Created VAT tax (${vatTax.rate}%)`);

      const menuItems = await this.createMenuItems(
        restaurantId,
        branchId,
        categories,
        [vatTax._id.toString()],
        superAdmin._id.toString()
      );
      this.logger.log(`  Branch "${branch.name}": Created ${menuItems.length} menu items`);

      const modifier = await this.createMenuModifier(restaurantId, branchId);
      this.logger.log(`  Branch "${branch.name}": Created menu modifier "${modifier.name}"`);

      await this.linkModifierToItems(branchId, modifier._id.toString(), menuItems);
      this.logger.log(`  Branch "${branch.name}": Linked modifier to applicable items`);

      const discount = await this.createDiscount(restaurantId, branchId);
      this.logger.log(`  Branch "${branch.name}": Created discount "${discount.name}"`);

      const { tables, qrCodes } = await this.createTablesWithQr(restaurantId, branchId);
      this.logger.log(`  Branch "${branch.name}": Created ${tables.length} tables + QR codes`);

      const supplier = await this.createSupplier(restaurantId, branchId);
      this.logger.log(`  Branch "${branch.name}": Created supplier "${supplier.name}"`);

      const invItems = await this.createInventoryItems(
        restaurantId,
        branchId,
        supplier._id.toString()
      );
      this.logger.log(`  Branch "${branch.name}": Created ${invItems.length} inventory items`);

      const recipes = await this.createRecipes(restaurantId, branchId, menuItems, invItems);
      this.logger.log(`  Branch "${branch.name}": Created ${recipes.length} recipes`);
    }

    return createdIds;
  }

  private async createSuperAdmin(): Promise<User> {
    const existing = await this.userModel.findOne({ email: 'superadmin@prolific.ai' }).exec();
    if (existing) return existing;
    const hashedPassword = await this.authService.hashPassword('Admin@1234');
    return this.userModel.create({
      email: 'superadmin@prolific.ai',
      hashedPassword,
      firstName: 'Super',
      lastName: 'Admin',
      isActive: true,
      isEmailVerified: true,
      emailVerifiedAt: new Date(),
      failedLoginAttempts: 0,
    });
  }

  private async createRestaurant(): Promise<Restaurant> {
    const existing = await this.restaurantModel.findOne({ name: 'Prolific Tables HQ' }).exec();
    if (existing) return existing;
    return this.restaurantModel.create({
      name: 'Prolific Tables HQ',
      address: '123 Aba Road',
      city: 'Port Harcourt',
      country: 'Nigeria',
      phone: '+234 800 000 0001',
      email: 'info@prolifictables.ai',
      currency: 'NGN',
      locale: 'en-NG',
    });
  }

  private async createBranches(restaurantId: string): Promise<Branch[]> {
    // Single default branch per restaurant — users no longer need to pick
    // a branch during login. Everything lives under this one branch by default.
    const branchConfigs = [
      {
        name: 'Port Harcourt HQ',
        city: 'Port Harcourt',
        address: '123 Aba Road, GRA Phase 3',
        timezone: 'Africa/Lagos',
      },
    ];
    const results: Branch[] = [];
    for (const bc of branchConfigs) {
      const existing = await this.branchModel
        .findOne({ restaurantId, name: bc.name })
        .exec();
      if (existing) {
        results.push(existing);
        continue;
      }
      const b = await this.branchModel.create({
        restaurantId,
        name: bc.name,
        address: bc.address,
        city: bc.city,
        country: 'Nigeria',
        phone: '+234 800 000 0001',
        email: 'info@prolificdiner.ai',
        timezone: bc.timezone,
        isActive: true,
        openingHours: this.defaultOpeningHours(),
      });
      results.push(b);
    }
    return results;
  }

  private async createEmployeesForBranch(
    restaurantId: string,
    branchId: string,
    superAdminUserId: string
  ): Promise<Employee[]> {
    const roles: S.Role[] = [S.Role.SUPER_ADMIN, S.Role.MANAGER, S.Role.CASHIER, S.Role.KITCHEN, S.Role.WAITER];
    const results: Employee[] = [];

    for (const role of roles) {
      let userId: string;
      let employeeNumber: string;

      // Assign SUPER_ADMIN employee record (in addition to ADMIN-level) to the
      // cross-branch super admin user so JWTs carry role=SUPER_ADMIN.
      if (role === S.Role.SUPER_ADMIN) {
        userId = superAdminUserId;
        employeeNumber = `EMP-${branchId.slice(0, 5)}-SADM`;
      } else {
        const email = `${role.toLowerCase()}+${branchId.slice(0, 4).toLowerCase()}@prolific.ai`;
        let user = await this.userModel.findOne({ email }).exec();
        if (!user) {
          const hashedPassword = await this.authService.hashPassword('Admin@1234');
          user = await this.userModel.create({
            email,
            hashedPassword,
            firstName: role.charAt(0) + role.slice(1).toLowerCase(),
            lastName: branchId.includes('abuja') ? 'Abuja' : 'Portharcourt',
            isActive: true,
            isEmailVerified: true,
            emailVerifiedAt: new Date(),
            failedLoginAttempts: 0,
          });
        }
        userId = user._id.toString();
        employeeNumber = `EMP-${branchId.slice(0, 5)}-${role.slice(0, 3)}`;
      }

      const existing = await this.employeeModel
        .findOne({ userId, branchId })
        .exec();
      if (existing) {
        results.push(existing);
        continue;
      }

      let pin: string | undefined;
      if (role === S.Role.MANAGER) {
        pin = await this.authService.hashPassword('1234');
      } else if (role === S.Role.CASHIER) {
        pin = await this.authService.hashPassword('0000');
      }

      const emp = await this.employeeModel.create({
        userId,
        restaurantId,
        branchId,
        role,
        pin,
        employeeNumber,
        positionTitle: role.charAt(0) + role.slice(1).toLowerCase(),
        assignedZoneIds: [],
      });
      results.push(emp);
    }
    return results;
  }

  private async createPosDevice(restaurantId: string, branchId: string): Promise<Device> {
    const existing = await this.deviceModel
      .findOne({ branchId, name: 'Front Counter POS' })
      .exec();
    if (existing) return existing;
    return this.deviceModel.create({
      restaurantId,
      branchId,
      name: 'Front Counter POS',
      deviceType: 'POS_TERMINAL',
      status: 'ACTIVE',
      deviceKey: crypto.randomBytes(24).toString('hex'),
      location: 'Main Entrance',
      isPrimary: true,
    });
  }

  private async createMenuCategories(
    restaurantId: string,
    branchId: string
  ): Promise<MenuCategory[]> {
    const defs = [
      { name: 'Starters', sortOrder: 0, description: 'Appetizers and small bites' },
      { name: 'Main Dishes', sortOrder: 1, description: 'Full main course meals' },
      { name: 'Drinks', sortOrder: 2, description: 'Beverages and refreshments' },
      { name: 'Desserts', sortOrder: 3, description: 'Sweet treats and desserts' },
    ];
    const results: MenuCategory[] = [];
    for (const d of defs) {
      const existing = await this.menuCategoryModel
        .findOne({ branchId, name: d.name })
        .exec();
      if (existing) {
        results.push(existing);
        continue;
      }
      const c = await this.menuCategoryModel.create({
        restaurantId,
        branchId,
        name: d.name,
        description: d.description,
        sortOrder: d.sortOrder,
        isActive: true,
      });
      results.push(c);
    }
    return results;
  }

  private async createVatTax(restaurantId: string, branchId: string): Promise<Tax> {
    const existing = await this.taxModel
      .findOne({ branchId, name: 'VAT' })
      .exec();
    if (existing) return existing;
    return this.taxModel.create({
      restaurantId,
      branchId,
      name: 'VAT',
      rate: 7.5,
      isIncludedInPrice: false,
      isActive: true,
    });
  }

  private async createMenuItems(
    restaurantId: string,
    branchId: string,
    categories: MenuCategory[],
    taxIds: string[],
    lastModifiedBy: string
  ): Promise<MenuItem[]> {
    const catMap: Record<string, string> = {};
    for (const c of categories) catMap[c.name] = c._id.toString();

    const defs: {
      name: string;
      category: string;
      price: number;
      description: string;
      sortOrder: number;
    }[] = [
      {
        name: 'Jollof Rice',
        category: 'Main Dishes',
        price: N(3500),
        description: 'Smoky party-style jollof rice cooked in rich tomato, pepper, and onion broth with aromatic spices',
        sortOrder: 1,
      },
      {
        name: 'Fried Rice with Chicken',
        category: 'Main Dishes',
        price: N(4000),
        description: 'Colorful fried rice tossed with mixed vegetables, diced chicken, and seasoned with curry and thyme',
        sortOrder: 2,
      },
      {
        name: 'Pounded Yam & Egusi Soup',
        category: 'Main Dishes',
        price: N(4500),
        description: 'Smooth fluffy pounded yam served with rich melon seed soup loaded with assorted meat, fish, and leafy greens',
        sortOrder: 3,
      },
      {
        name: 'Pepper Soup (Goat)',
        category: 'Main Dishes',
        price: N(3000),
        description: 'Spicy aromatic goat meat pepper soup made with fresh uziza leaves, calabash nutmeg, and native spices',
        sortOrder: 4,
      },
      {
        name: 'Plantain Chips',
        category: 'Starters',
        price: N(1000),
        description: 'Crispy golden plantain chips fried to perfection, lightly salted',
        sortOrder: 1,
      },
      {
        name: 'Samosa (4 pcs)',
        category: 'Starters',
        price: N(800),
        description: 'Four crispy pastry triangles filled with spiced minced beef, potatoes, and mixed vegetables',
        sortOrder: 2,
      },
      {
        name: 'Zobo Drink',
        category: 'Drinks',
        price: N(500),
        description: 'Chilled hibiscus flower drink infused with pineapple, ginger, and cloves',
        sortOrder: 1,
      },
      {
        name: 'Fresh Orange Juice',
        category: 'Drinks',
        price: N(700),
        description: 'Freshly squeezed Nigerian sweet orange juice, served cold',
        sortOrder: 2,
      },
      {
        name: 'Ice Cream (2 scoops)',
        category: 'Desserts',
        price: N(800),
        description: 'Two generous scoops of premium vanilla and strawberry ice cream',
        sortOrder: 1,
      },
      {
        name: 'Chocolate Cake slice',
        category: 'Desserts',
        price: N(1000),
        description: 'Rich moist dark chocolate cake slice with buttercream frosting and chocolate ganache drizzle',
        sortOrder: 2,
      },
    ];

    const results: MenuItem[] = [];
    for (const d of defs) {
      const existing = await this.menuItemModel
        .findOne({ branchId, name: d.name })
        .exec();
      if (existing) {
        results.push(existing);
        continue;
      }
      const mi = await this.menuItemModel.create({
        restaurantId,
        branchId,
        categoryId: catMap[d.category],
        name: d.name,
        description: d.description,
        price: d.price,
        status: S.MenuItemStatus.AVAILABLE,
        sortOrder: d.sortOrder,
        isTaxable: true,
        taxIds,
        modifierIds: [],
        version: 0,
        lastModifiedAt: new Date(),
        lastModifiedBy,
      });
      results.push(mi);
    }
    return results;
  }

  private async createMenuModifier(
    restaurantId: string,
    branchId: string
  ): Promise<MenuModifier> {
    const existing = await this.menuModifierModel
      .findOne({ branchId, name: 'Protein Options' })
      .exec();
    if (existing) return existing;
    return this.menuModifierModel.create({
      restaurantId,
      branchId,
      name: 'Protein Options',
      description: 'Choose protein add-ons and drink size options',
      required: false,
      multiSelect: true,
      minSelections: 0,
      maxSelections: 5,
      options: [
        { id: 'prot-chicken', name: 'Chicken', priceDelta: N(500), isDefault: false },
        { id: 'prot-beef', name: 'Beef', priceDelta: N(1000), isDefault: false },
        { id: 'prot-fish', name: 'Fish', priceDelta: N(1500), isDefault: false },
        { id: 'side-rice-extra', name: 'Extra Rice', priceDelta: N(2000), isDefault: false },
        { id: 'drink-size-small', name: 'Drink Small', priceDelta: 0, isDefault: true },
        { id: 'drink-size-regular', name: 'Drink Regular', priceDelta: 0, isDefault: false },
        { id: 'drink-size-large', name: 'Drink Large', priceDelta: N(150), isDefault: false },
      ],
    });
  }

  private async linkModifierToItems(
    branchId: string,
    modifierId: string,
    menuItems: MenuItem[]
  ): Promise<void> {
    const applicableNames = new Set([
      'Jollof Rice',
      'Fried Rice with Chicken',
      'Pounded Yam & Egusi Soup',
      'Pepper Soup (Goat)',
      'Zobo Drink',
      'Fresh Orange Juice',
    ]);
    for (const mi of menuItems) {
      if (!applicableNames.has(mi.name)) continue;
      if (mi.modifierIds.includes(modifierId)) continue;
      await this.menuItemModel
        .findByIdAndUpdate(
          mi._id,
          {
            $set: {
              modifierIds: [...mi.modifierIds, modifierId],
              lastModifiedAt: new Date(),
            },
          },
          { new: true }
        )
        .exec();
    }
  }

  private async createDiscount(restaurantId: string, branchId: string): Promise<Discount> {
    const existing = await this.discountModel
      .findOne({ branchId, name: 'Happy Hour 10%' })
      .exec();
    if (existing) return existing;
    return this.discountModel.create({
      restaurantId,
      branchId,
      name: 'Happy Hour 10%',
      type: 'PERCENTAGE',
      value: 10,
      isActive: true,
      requiresManagerApproval: false,
    });
  }

  private async createTablesWithQr(
    restaurantId: string,
    branchId: string
  ): Promise<{ tables: Table[]; qrCodes: QRCode[] }> {
    const tables: Table[] = [];
    const qrCodes: QRCode[] = [];
    // Exactly 7 tables per branch per customer requirement.
    // Deterministic capacities so the floor plan is predictable:
    //   T1-T2: 2-seater (small window tables)
    //   T3-T5: 4-seater (family booths)
    //   T6-T7: 6-seater (large groups / VIP)
    const SEVEN_TABLE_PLAN: Array<{ name: string; capacity: number; zone: string }> = [
      { name: 'T1', capacity: 2, zone: 'Main Hall' },
      { name: 'T2', capacity: 2, zone: 'Main Hall' },
      { name: 'T3', capacity: 4, zone: 'Main Hall' },
      { name: 'T4', capacity: 4, zone: 'Main Hall' },
      { name: 'T5', capacity: 4, zone: 'Main Hall' },
      { name: 'T6', capacity: 6, zone: 'Main Hall' },
      { name: 'T7', capacity: 6, zone: 'Main Hall' },
    ];
    for (const plan of SEVEN_TABLE_PLAN) {
      const { name: tableName, capacity, zone } = plan;

      const existingTable = await this.tableModel
        .findOne({ branchId, name: tableName })
        .exec();

      if (existingTable) {
        const existingQr = await this.qrCodeModel
          .findOne({ tableId: existingTable._id.toString(), isDefault: true })
          .exec();
        tables.push(existingTable);
        if (existingQr) qrCodes.push(existingQr);
        continue;
      }

      const qrToken = this.generateRandomToken(6);
      const tableIdStub = `pending-${branchId}-${tableName}`;
      const qr = await this.qrCodeModel.create({
        restaurantId,
        branchId,
        tableId: tableIdStub,
        token: qrToken,
        isActive: true,
        isDefault: true,
      });

      const table = await this.tableModel.create({
        restaurantId,
        branchId,
        name: tableName,
        capacity,
        zone,
        isActive: true,
        qrCodeId: qr._id.toString(),
      });

      await this.qrCodeModel
        .findByIdAndUpdate(qr._id, { $set: { tableId: table._id.toString() } })
        .exec();

      tables.push(table);
      qrCodes.push(qr);
    }

    // Soft-deactivate any pre-existing tables beyond the 7 we keep.
    // This ensures branches that were previously seeded with 10 tables
    // automatically collapse to exactly 7 the next time seed runs without
    // deleting historical order rows that reference those tableIds.
    const allActive = await this.tableModel
      .find({ branchId, isActive: true }, { _id: 1, name: 1 })
      .lean()
      .exec();
    const keepNames = new Set(SEVEN_TABLE_PLAN.map((p) => p.name));
    const extras = allActive.filter((t) => !keepNames.has(t.name));
    if (extras.length > 0) {
      await this.tableModel
        .updateMany(
          { _id: { $in: extras.map((t) => t._id) } },
          { $set: { isActive: false } }
        )
        .exec();
      this.logger.log(
        `  Branch "${branchId}": Soft-deactivated ${extras.length} excess tables (${extras.map((e) => e.name).join(', ')}) to enforce exactly-7 rule.`
      );
    }

    return { tables, qrCodes };
  }

  private async createSupplier(
    restaurantId: string,
    branchId: string
  ): Promise<Supplier> {
    const existing = await this.supplierModel
      .findOne({ restaurantId, name: 'Main Market Foods Ltd' })
      .exec();
    if (existing) return existing;
    return this.supplierModel.create({
      restaurantId,
      branchId,
      name: 'Main Market Foods Ltd',
      contactName: 'Alhaji Musa',
      phone: '+234 800 111 2222',
      email: 'orders@mainmarketfoods.ng',
      address: 'Mile 1 Market, Diobu',
      city: 'Port Harcourt',
      country: 'Nigeria',
      isActive: true,
    });
  }

  private async createInventoryItems(
    restaurantId: string,
    branchId: string,
    supplierId: string
  ): Promise<InventoryItem[]> {
    const defs = [
      {
        sku: 'INV-RICE-001',
        name: 'Rice',
        description: 'Premium long grain parboiled rice',
        category: 'Grains',
        unit: S.Unit.KG,
        currentStockLevel: 50,
        minimumStockLevel: 10,
        unitCostCents: N(800),
      },
      {
        sku: 'INV-TOM-001',
        name: 'Tomato',
        description: 'Fresh ripe Roma tomatoes',
        category: 'Vegetables',
        unit: S.Unit.KG,
        currentStockLevel: 30,
        minimumStockLevel: 5,
        unitCostCents: N(1200),
      },
      {
        sku: 'INV-OIL-001',
        name: 'Palm Oil',
        description: 'Unrefined red palm oil',
        category: 'Oils',
        unit: S.Unit.L,
        currentStockLevel: 20,
        minimumStockLevel: 3,
        unitCostCents: N(2500),
      },
      {
        sku: 'INV-CHK-001',
        name: 'Chicken',
        description: 'Frozen whole chicken portion',
        category: 'Proteins',
        unit: S.Unit.PIECE,
        currentStockLevel: 80,
        minimumStockLevel: 20,
        unitCostCents: N(1500),
      },
      {
        sku: 'INV-BEEF-001',
        name: 'Beef',
        description: 'Fresh lean beef portions',
        category: 'Proteins',
        unit: S.Unit.PIECE,
        currentStockLevel: 60,
        minimumStockLevel: 15,
        unitCostCents: N(2000),
      },
      {
        sku: 'INV-ONION-001',
        name: 'Onion',
        description: 'Fresh yellow onions',
        category: 'Vegetables',
        unit: S.Unit.KG,
        currentStockLevel: 25,
        minimumStockLevel: 5,
        unitCostCents: N(600),
      },
    ];
    const results: InventoryItem[] = [];
    for (const d of defs) {
      const existing = await this.inventoryItemModel
        .findOne({ branchId, name: d.name })
        .exec();
      if (existing) {
        results.push(existing);
        continue;
      }
      const item = await this.inventoryItemModel.create({
        restaurantId,
        branchId,
        sku: d.sku,
        name: d.name,
        description: d.description,
        category: d.category,
        unit: d.unit,
        currentStockLevel: d.currentStockLevel,
        minimumStockLevel: d.minimumStockLevel,
        unitCostCents: d.unitCostCents,
        preferredSupplierId: supplierId,
        isActive: true,
      });
      results.push(item);
    }
    return results;
  }

  private async createRecipes(
    restaurantId: string,
    branchId: string,
    menuItems: MenuItem[],
    invItems: InventoryItem[]
  ): Promise<Recipe[]> {
    const invMap: Record<string, InventoryItem> = {};
    for (const it of invItems) invMap[it.name] = it;

    const recipeDefs: {
      menuItemName: string;
      servings: number;
      ingredients: { name: string; quantity: number; unit: S.Unit }[];
    }[] = [
      {
        menuItemName: 'Jollof Rice',
        servings: 1,
        ingredients: [
          { name: 'Rice', quantity: 0.25, unit: S.Unit.KG },
          { name: 'Tomato', quantity: 0.1, unit: S.Unit.KG },
          { name: 'Palm Oil', quantity: 0.03, unit: S.Unit.L },
          { name: 'Chicken', quantity: 1, unit: S.Unit.PIECE },
          { name: 'Onion', quantity: 0.05, unit: S.Unit.KG },
        ],
      },
      {
        menuItemName: 'Fried Rice with Chicken',
        servings: 1,
        ingredients: [
          { name: 'Rice', quantity: 0.25, unit: S.Unit.KG },
          { name: 'Chicken', quantity: 1, unit: S.Unit.PIECE },
          { name: 'Palm Oil', quantity: 0.02, unit: S.Unit.L },
          { name: 'Onion', quantity: 0.04, unit: S.Unit.KG },
          { name: 'Tomato', quantity: 0.05, unit: S.Unit.KG },
        ],
      },
    ];

    const results: Recipe[] = [];
    for (const rd of recipeDefs) {
      const menuItem = menuItems.find((m) => m.name === rd.menuItemName);
      if (!menuItem) continue;

      const existing = await this.recipeModel
        .findOne({ menuItemId: menuItem._id.toString() })
        .exec();
      if (existing) {
        results.push(existing);
        continue;
      }

      const ingredients = rd.ingredients
        .filter((ing) => invMap[ing.name])
        .map((ing) => {
          const ii = invMap[ing.name];
          return {
            inventoryItemId: ii._id.toString(),
            inventoryItemName: ii.name,
            quantity: ing.quantity,
            unit: ing.unit,
            costAtRecipeTime: ii.unitCostCents,
          };
        });

      const recipe = await this.recipeModel.create({
        restaurantId,
        branchId,
        menuItemId: menuItem._id.toString(),
        name: `${rd.menuItemName} Recipe`,
        servings: rd.servings,
        ingredients,
        instructions: `Standard preparation for ${rd.menuItemName}`,
        prepTimeMinutes: 10,
        cookTimeMinutes: 25,
      });

      await this.menuItemModel
        .findByIdAndUpdate(menuItem._id, {
          $set: { recipeId: recipe._id.toString(), lastModifiedAt: new Date() },
        })
        .exec();

      results.push(recipe);
    }
    return results;
  }

  private generateRandomToken(length: number): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.randomBytes(length);
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(bytes[i] % chars.length);
    }
    return result;
  }

  private defaultOpeningHours(): {
    dayOfWeek: number;
    openTime: string;
    closeTime: string;
    isClosed: boolean;
  }[] {
    return [0, 1, 2, 3, 4, 5, 6].map((d) => ({
      dayOfWeek: d,
      openTime: '08:00',
      closeTime: '22:00',
      isClosed: false,
    }));
  }
}
