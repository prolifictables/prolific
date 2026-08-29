export * from './types';
export * from './migrations';
export { PosDatabase } from './database';

import { PosDatabase } from './database';
import path from 'node:path';
import { EmployeesRepository } from './repositories/employees.repository';
import {
  MenuCategoriesRepository,
  MenuItemsRepository,
} from './repositories/menu.repository';
import {
  MenuModifiersRepository,
  TaxesRepository,
  DiscountsRepository,
} from './repositories/menu-extras.repository';
import {
  TablesRepository,
  CustomersRepository,
} from './repositories/tables-customers.repository';
import {
  OrdersRepository,
  OrderItemsRepository,
  OrderItemModifierOptionsRepository,
} from './repositories/orders.repository';
import {
  PaymentsRepository,
  ShiftsRepository,
  CashAdjustmentsRepository,
} from './repositories/payments-shifts.repository';
import {
  KitchenOrdersRepository,
  InventoryItemsRepository,
  InventoryTransactionsRepository,
} from './repositories/kitchen-inventory.repository';
import {
  RecipesRepository,
  SettingsRepository,
} from './repositories/recipes-settings.repository';
import {
  TableSessionsRepository,
  TableSessionLedgerRepository,
  TableSessionService,
} from './repositories/table-sessions.repository';
import {
  SyncQueueRepository,
  SyncRecordsRepository,
  AuditLogsRepository,
  ConnectionEventsRepository,
  MetaRepository,
  LoyaltyAccountsRepository,
  PromotionsRepository,
} from './repositories/sync-audit-meta.repository';

export interface ReposBundle {
  db: PosDatabase;
  employees: EmployeesRepository;
  menuCategories: MenuCategoriesRepository;
  menuItems: MenuItemsRepository;
  menuModifiers: MenuModifiersRepository;
  taxes: TaxesRepository;
  discounts: DiscountsRepository;
  tables: TablesRepository;
  customers: CustomersRepository;
  orders: OrdersRepository;
  orderItems: OrderItemsRepository;
  orderItemModifierOptions: OrderItemModifierOptionsRepository;
  payments: PaymentsRepository;
  shifts: ShiftsRepository;
  cashAdjustments: CashAdjustmentsRepository;
  kitchenOrders: KitchenOrdersRepository;
  inventoryItems: InventoryItemsRepository;
  inventoryTransactions: InventoryTransactionsRepository;
  recipes: RecipesRepository;
  settings: SettingsRepository;
  tableSessions: TableSessionsRepository;
  tableSessionLedger: TableSessionLedgerRepository;
  tableSessionService: TableSessionService;
  syncQueue: SyncQueueRepository;
  syncRecords: SyncRecordsRepository;
  auditLogs: AuditLogsRepository;
  meta: MetaRepository;
  connectionEvents: ConnectionEventsRepository;
  loyaltyAccounts: LoyaltyAccountsRepository;
  promotions: PromotionsRepository;
}

let singletonDb: PosDatabase | null = null;

export function createSingletonDb(userDataPath: string): PosDatabase {
  if (singletonDb) return singletonDb;
  const dbPath = path.join(userDataPath, 'prolific-pos.db');
  singletonDb = new PosDatabase(dbPath);
  singletonDb.migrate();
  return singletonDb;
}

export function createRepos(db: PosDatabase): ReposBundle {
  const orders = new OrdersRepository(db);
  const orderItems = new OrderItemsRepository(db);
  const tableSessions = new TableSessionsRepository(db);
  const tableSessionLedger = new TableSessionLedgerRepository(db);
  const tableSessionService = new TableSessionService(
    tableSessions,
    tableSessionLedger,
    {
      create: (d: any) => orders.create(d),
      addItem: (orderId: string, item: any) => orders.addItem(orderId, item),
      listItems: (orderId: string) => orderItems.listByOrderId(orderId),
      removeItem: (orderItemId: string) => {
        orders.removeItem(orderItemId);
      },
      updateItemQty: (orderItemId: string, qty: number, subtotalCents: number) =>
        orderItems.updateQtyAndSubtotal(orderItemId, qty, subtotalCents),
    }
  );
  return {
    db,
    employees: new EmployeesRepository(db),
    menuCategories: new MenuCategoriesRepository(db),
    menuItems: new MenuItemsRepository(db),
    menuModifiers: new MenuModifiersRepository(db),
    taxes: new TaxesRepository(db),
    discounts: new DiscountsRepository(db),
    tables: new TablesRepository(db),
    customers: new CustomersRepository(db),
    orders,
    orderItems,
    orderItemModifierOptions: new OrderItemModifierOptionsRepository(db),
    payments: new PaymentsRepository(db),
    shifts: new ShiftsRepository(db),
    cashAdjustments: new CashAdjustmentsRepository(db),
    kitchenOrders: new KitchenOrdersRepository(db),
    inventoryItems: new InventoryItemsRepository(db),
    inventoryTransactions: new InventoryTransactionsRepository(db),
    recipes: new RecipesRepository(db),
    settings: new SettingsRepository(db),
    tableSessions,
    tableSessionLedger,
    tableSessionService,
    syncQueue: new SyncQueueRepository(db),
    syncRecords: new SyncRecordsRepository(db),
    auditLogs: new AuditLogsRepository(db),
    meta: new MetaRepository(db),
    connectionEvents: new ConnectionEventsRepository(db),
    loyaltyAccounts: new LoyaltyAccountsRepository(db),
    promotions: new PromotionsRepository(db),
  };
}
