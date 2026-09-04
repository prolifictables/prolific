import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as crypto from 'crypto';
import * as S from '@prolific/shared-types';
import type { AuthContext } from '../common/decorators/current-user.decorator';
import { QRCode } from '../qr-codes/schemas/qr-code.schema';
import { Table } from '../tables/schemas/table.schema';
import { TableSession } from '../table-sessions/schemas/table-session.schema';
import { Restaurant } from '../restaurants/schemas/restaurant.schema';
import { Branch } from '../branches/schemas/branch.schema';
import { MenuCategory } from '../menu/schemas/menu-category.schema';
import { MenuItem } from '../menu/schemas/menu-item.schema';
import { MenuModifier } from '../menu/schemas/menu-modifier.schema';
import { Tax } from '../taxes/schemas/tax.schema';
import { Customer } from '../customers/schemas/customer.schema';
import { Order } from '../orders/schemas/order.schema';
import { Payment } from '../payments/schemas/payment.schema';
import { Setting } from '../settings/schemas/setting.schema';
import { OrdersService, CreateOrderInput, OrderItemInput } from '../orders/orders.service';
import { CustomersService } from '../customers/customers.service';
import { SocketGateway } from '../socket/socket.gateway';
import { PaymentsService } from '../payments/payments.service';
import { PaymentProviderFactory } from '../payments/payment-provider-factory.service';
import type { PaymentProvider } from '../payments/interfaces/payment-provider.interface';

const ACTIVE_SESSION_STATUSES = [
  S.TableSessionStatus.OPEN,
  S.TableSessionStatus.AWAITING_PAYMENT,
  S.TableSessionStatus.PARTIALLY_PAID,
];

export interface ResolvedQr {
  restaurant: {
    id: string;
    name: string;
    logoUrl?: string;
    currency: string;
    locale: string;
    address: string;
    phone: string;
  };
  branch: {
    id: string;
    name: string;
    timezone: string;
  };
  table: {
    id: string;
    name: string;
    capacity: number;
    zone?: string;
    status?: string;
  };
  qr: {
    token: string;
    tableId: string;
    branchId: string;
    restaurantId: string;
    printedAt?: Date;
    lastUsedAt?: Date;
  };
}

export interface PublicMenuResponse {
  restaurant: {
    id: string;
    name: string;
    logoUrl?: string;
    currency: string;
    locale: string;
  };
  branch: {
    id: string;
    name: string;
    timezone: string;
  };
  categories: Array<Record<string, unknown>>;
  items: Array<Record<string, unknown>>;
  modifiers: Array<Record<string, unknown>>;
  defaultTax: Record<string, unknown> | null;
}

export interface JoinedSessionResponse {
  session: {
    id: string;
    status: S.TableSessionStatus;
    startedAt: Date;
    tableId: string;
    orderIds: string[];
    totalAmountCents: number;
    paidAmountCents: number;
    balanceDueCents: number;
  };
  table: {
    id: string;
    name: string;
    capacity: number;
    zone?: string;
  };
  restaurant: {
    id: string;
    name: string;
    logoUrl?: string;
    currency: string;
    locale: string;
  };
  branch: {
    id: string;
    name: string;
    timezone: string;
  };
  qrToken: string;
  guestToken: string;
}

interface SubmitTableOrderInput {
  items: Array<{
    menuItemId: string;
    quantity: number;
    specialInstructions?: string;
    selectedModifierOptions: Array<{ modifierId: string; optionId: string }>;
  }>;
  orderType: 'DINE_IN' | 'TAKEAWAY' | 'PICKUP' | 'DELIVERY';
  displayName?: string;
  customerInfo?: { name?: string; phone?: string; email?: string };
  payIntent: 'PAY_AT_POS' | 'PAY_ONLINE';
  onlineProvider?: 'PAYSTACK' | 'FLUTTERWAVE';
}

type SubmitWebsiteOrderInput = SubmitTableOrderInput;

function generateGuestToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function hashIdempotencyKey(parts: string[]): string {
  return crypto
    .createHash('sha256')
    .update(parts.join(':'))
    .digest('hex');
}

@Injectable()
export class PublicService {
  private readonly logger = new Logger(PublicService.name);

  constructor(
    @InjectModel(QRCode.name) private readonly qrCodeModel: Model<QRCode>,
    @InjectModel(Table.name) private readonly tableModel: Model<Table>,
    @InjectModel(TableSession.name) private readonly tableSessionModel: Model<TableSession>,
    @InjectModel(Restaurant.name) private readonly restaurantModel: Model<Restaurant>,
    @InjectModel(Branch.name) private readonly branchModel: Model<Branch>,
    @InjectModel(MenuCategory.name) private readonly menuCategoryModel: Model<MenuCategory>,
    @InjectModel(MenuItem.name) private readonly menuItemModel: Model<MenuItem>,
    @InjectModel(MenuModifier.name) private readonly menuModifierModel: Model<MenuModifier>,
    @InjectModel(Tax.name) private readonly taxModel: Model<Tax>,
    @InjectModel(Customer.name) private readonly customerModel: Model<Customer>,
    @InjectModel(Order.name) private readonly orderModel: Model<Order>,
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    @InjectModel(Setting.name) private readonly settingModel: Model<Setting>,
    private readonly ordersService: OrdersService,
    private readonly customersService: CustomersService,
    private readonly socketGateway: SocketGateway,
    private readonly paymentsService: PaymentsService,
    private readonly paymentProviderFactory: PaymentProviderFactory
  ) {}

  // Key under which customer-display nested object (promos, specials, branding)
  // lives inside the BRANCH-scoped "branch.settings" Setting document.
  private readonly CUSTOMER_DISPLAY_SUBKEY = 'customerDisplay' as const;
  private readonly BRANCH_SETTINGS_KEY = 'branch.settings' as const;

  // Public (unauthenticated) read of the customer-display write-up for a branch.
  // Returns the customerDisplay sub-object from branch.settings, or {} when nothing
  // has been saved yet (POS falls back to its baked-in hardcoded defaults).
  async getCustomerDisplaySettings(opts: { branchId?: string } = {}): Promise<{
    promos?: unknown[];
    specials?: unknown[];
    tagline?: string;
    wifi?: string;
    openingHours?: string;
    branchName?: string;
    bankDetails?: {
      bankName?: string;
      accountName?: string;
      accountNumber?: string;
      caption?: string;
    } | null;
  }> {
    const branchId = opts.branchId || null;
    // Without a branchId we can't resolve branch-scoped settings — return empty
    // and let the client fall back to defaults.
    if (!branchId) return {};

    // NOTE: branchId alone is insufficient; Settings documents are keyed by
    // (restaurantId, branchId, key='branch.settings', scope='BRANCH'). We first
    // resolve the restaurant via the Branch document to match SettingsService
    // and Admin's patchBranchSettings query shape.
    const branch = await this.branchModel
      .findOne({ _id: branchId })
      .select({ restaurantId: 1, _id: 0 })
      .lean()
      .exec();
    const restaurantId = (branch as any)?.restaurantId || null;
    if (!restaurantId) return {};

    const row = await this.settingModel
      .findOne({
        restaurantId,
        branchId,
        key: this.BRANCH_SETTINGS_KEY,
        scope: 'BRANCH',
      })
      .select({ value: 1, _id: 0 })
      .lean()
      .exec();

    const full = row?.value && typeof row.value === 'object' ? (row.value as Record<string, unknown>) : {};
    const subAny = full[this.CUSTOMER_DISPLAY_SUBKEY];
    const sub = subAny && typeof subAny === 'object' ? (subAny as Record<string, any>) : {};
    // Destructure known top-level branding keys (promos/specials/etc) plus the
    // newly added bankDetails (with legacy snake_case fallback for documents
    // written by older admin builds). Explicit null is preserved so downstream
    // caches (POS localStorage / Electron settings table) correctly clear the
    // prior snapshot when a manager blanks out all 4 fields.
    const {
      promos,
      specials,
      tagline,
      wifi,
      openingHours,
      branchName,
      bankDetails,
    } = sub;
    const legacyBankDetails = sub.bank_details;
    const normalizedBankDetails =
      bankDetails !== undefined ? bankDetails : legacyBankDetails !== undefined ? legacyBankDetails : null;
    return {
      promos: promos as unknown[] | undefined,
      specials: specials as unknown[] | undefined,
      tagline: tagline as string | undefined,
      wifi: wifi as string | undefined,
      openingHours: openingHours as string | undefined,
      branchName: branchName as string | undefined,
      bankDetails: normalizedBankDetails as any,
    };
  }

  async resolveQr(token: string): Promise<ResolvedQr> {
    const qr = await this.qrCodeModel
      .findOne({ token: { $regex: new RegExp(`^${token}$`, 'i') } })
      .exec();

    if (!qr) {
      throw new NotFoundException('QR code not found or expired');
    }

    const qrAny = qr as any;
    const now = new Date();

    if (!qr.isActive) {
      throw new NotFoundException('QR code not found or expired');
    }

    if (qrAny.expiresAt && qrAny.expiresAt < now) {
      throw new NotFoundException('QR code not found or expired');
    }

    const [table, branch, restaurant] = await Promise.all([
      this.tableModel.findById(qr.tableId).exec(),
      this.branchModel.findById(qr.branchId).exec(),
      this.restaurantModel.findById(qr.restaurantId).exec(),
    ]);

    if (!table) {
      throw new NotFoundException('QR code not found or expired');
    }
    if (!branch) {
      throw new NotFoundException('QR code not found or expired');
    }
    if (!restaurant) {
      throw new NotFoundException('QR code not found or expired');
    }

    const lastUsedAt = new Date();
    await this.qrCodeModel
      .findByIdAndUpdate(
        qr._id,
        {
          $set: {
            lastScannedAt: lastUsedAt,
            ...({ lastUsedAt } as any),
          },
        },
        { minimize: false }
      )
      .exec();

    return {
      restaurant: {
        id: restaurant._id.toString(),
        name: restaurant.name,
        logoUrl: restaurant.logoUrl,
        currency: restaurant.currency,
        locale: restaurant.locale,
        address: restaurant.address,
        phone: restaurant.phone,
      },
      branch: {
        id: branch._id.toString(),
        name: branch.name,
        timezone: branch.timezone,
      },
      table: {
        id: table._id.toString(),
        name: table.name,
        capacity: table.capacity,
        zone: table.zone,
        status: table.isActive ? 'ACTIVE' : 'INACTIVE',
      },
      qr: {
        token: qr.token,
        tableId: qr.tableId,
        branchId: qr.branchId,
        restaurantId: qr.restaurantId,
        printedAt: (qr as any).printedAt,
        lastUsedAt,
      },
    };
  }

  async listBranches(opts: { restaurantId?: string; nameQuery?: string } = {}): Promise<
    Array<{
      id: string;
      restaurantId: string;
      name: string;
      city: string;
      country: string;
      address: string;
      phone: string;
      email: string;
      timezone: string;
      isActive: boolean;
      isDefault?: boolean;
    }>
  > {
    const query: Record<string, unknown> = { isActive: true };
    if (opts.restaurantId) query.restaurantId = opts.restaurantId;
    if (opts.nameQuery && opts.nameQuery.trim()) {
      query.name = { $regex: new RegExp(opts.nameQuery.trim(), 'i') };
    }

    const branches = await this.branchModel
      .find(query)
      .sort({ createdAt: 1 })
      .lean()
      .exec();

    return branches.map((b, idx) => ({
      id: b._id.toString(),
      restaurantId: String(b.restaurantId),
      name: b.name,
      city: b.city,
      country: b.country,
      address: b.address,
      phone: b.phone,
      email: b.email,
      timezone: b.timezone,
      isActive: b.isActive,
      // Seeded first branch (Port Harcourt) is the default for public UIs
      // until the POS logs in with a specific branch context.
      isDefault: idx === 0,
    }));
  }

  async getPublicMenu(
    branchId: string,
    opts: { withCategoryIds?: string[] } = {}
  ): Promise<PublicMenuResponse> {
    const branch = await this.branchModel.findById(branchId).exec();
    if (!branch || !branch.isActive) {
      throw new NotFoundException('Branch not found or inactive');
    }

    const restaurant = await this.restaurantModel.findById(branch.restaurantId).exec();
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    const categoryQuery: Record<string, unknown> = {
      branchId,
      isActive: true,
    };
    if (opts.withCategoryIds && opts.withCategoryIds.length > 0) {
      categoryQuery._id = { $in: opts.withCategoryIds.map((id) => new Types.ObjectId(id)) };
    }

    const categories = await this.menuCategoryModel
      .find(categoryQuery)
      .sort({ sortOrder: 1 })
      .exec();

    const categoryIds = categories.map((c) => c._id.toString());

    const itemQuery: Record<string, unknown> = {
      branchId,
      status: {
        $in: [
          S.MenuItemStatus.AVAILABLE,
          S.MenuItemStatus.SCHEDULED,
          S.MenuItemStatus.OUT_OF_STOCK,
        ],
      },
    };
    if (opts.withCategoryIds && opts.withCategoryIds.length > 0) {
      itemQuery.categoryId = { $in: opts.withCategoryIds };
    }

    const menuItems = await this.menuItemModel.find(itemQuery).exec();

    const now = new Date();
    const currentDay = now.getDay();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const availableItems = menuItems.filter((item) => {
      if (!item.scheduledAvailability) return true;
      const { daysOfWeek, startTime, endTime } = item.scheduledAvailability;
      if (!daysOfWeek.includes(currentDay)) return false;
      return currentTime >= startTime && currentTime <= endTime;
    });

    const referencedModifierIds = new Set<string>();
    for (const item of availableItems) {
      for (const modId of item.modifierIds) {
        referencedModifierIds.add(modId);
      }
    }

    const modifiers = await this.menuModifierModel
      .find({
        branchId,
        isActive: true,
        _id: { $in: Array.from(referencedModifierIds).map((id) => new Types.ObjectId(id)) },
      })
      .exec();

    const defaultTaxDoc = await this.taxModel
      .findOne({
        branchId,
        isActive: true,
        ...({ isDefault: true } as any),
      })
      .exec();

    const defaultTax = defaultTaxDoc
      ? {
          id: defaultTaxDoc._id.toString(),
          name: defaultTaxDoc.name,
          rate: defaultTaxDoc.rate,
          isIncludedInPrice: defaultTaxDoc.isIncludedInPrice,
        }
      : null;

    return {
      restaurant: {
        id: restaurant._id.toString(),
        name: restaurant.name,
        logoUrl: restaurant.logoUrl,
        currency: restaurant.currency,
        locale: restaurant.locale,
      },
      branch: {
        id: branch._id.toString(),
        name: branch.name,
        timezone: branch.timezone,
      },
      categories: categories.map((c) => ({
        id: c._id.toString(),
        name: c.name,
        description: c.description,
        sortOrder: c.sortOrder,
        imageUrl: (c as any).imageUrl,
      })),
      items: availableItems.map((item) => ({
        id: item._id.toString(),
        categoryId: item.categoryId,
        name: item.name,
        description: item.description,
        priceCents: item.price,
        imageUrl: item.imageUrl,
        status: item.status,
        sortOrder: item.sortOrder,
        isTaxable: item.isTaxable,
        taxIds: item.taxIds,
        modifierIds: item.modifierIds,
      })),
      modifiers: modifiers.map((mod) => ({
        id: mod._id.toString(),
        name: mod.name,
        description: mod.description,
        required: mod.required,
        multiSelect: mod.multiSelect,
        minSelections: mod.minSelections,
        maxSelections: mod.maxSelections,
        options: (mod.options ?? [])
          .filter((o: any) => o.isActive !== false)
          .map((o: any) => ({
            id: o.id,
            name: o.name,
            priceDeltaCents: o.priceDelta,
            isDefault: o.isDefault,
          })),
      })),
      defaultTax,
    };
  }

  async joinOrStartTableSession(
    qrToken: string,
    customerHint?: {
      displayName?: string;
      customerId?: string;
      phone?: string;
      email?: string;
    }
  ): Promise<JoinedSessionResponse> {
    const resolved = await this.resolveQr(qrToken);
    const { restaurant, branch, table, qr } = resolved;

    let session = await this.tableSessionModel
      .findOne({
        tableId: table.id,
        status: { $in: ACTIVE_SESSION_STATUSES },
      })
      .exec();

    let joinedCustomerId: string | undefined = customerHint?.customerId;

    const customerCtx: AuthContext = {
      userId: 'qr-guest',
      employeeId: null,
      restaurantId: restaurant.id,
      branchId: branch.id,
      role: S.Role.SUPER_ADMIN,
      permissions: [],
      tokenType: 'anonymous',
      email: customerHint?.email ?? '',
      firstName: customerHint?.displayName ?? '',
      lastName: '',
      fullName: customerHint?.displayName ?? '',
    };

    if ((customerHint?.phone || customerHint?.email) && !joinedCustomerId) {
      const customer = await this.customersService.findOrCreate(customerCtx, {
        firstName: customerHint.displayName,
        phone: customerHint.phone,
        email: customerHint.email,
      });
      joinedCustomerId = customer._id.toString();
    }

    if (!session || (session as any).closedAt) {
      const now = new Date();
      session = await this.tableSessionModel.create({
        restaurantId: restaurant.id,
        branchId: branch.id,
        tableId: table.id,
        qrCodeId: qr.token,
        status: S.TableSessionStatus.OPEN,
        openedAt: now,
        customerIds: joinedCustomerId ? [joinedCustomerId] : [],
        orderIds: [],
        totalAmount: 0,
        paidAmount: 0,
        balanceDue: 0,
        splitGroups: [],
        orderRefs: [],
        ...({ orderedCustomerIds: joinedCustomerId ? [joinedCustomerId] : [] } as any),
        ...({ customerCount: 1 } as any),
        ...({ startedAt: now } as any),
        ...({ closedAt: null } as any),
        ...({ closedBy: null } as any),
      });
    } else if (joinedCustomerId) {
      const sessionAny = session as any;
      const orderedCustomerIds: string[] = sessionAny.orderedCustomerIds ?? [];
      const customerIds: string[] = session.customerIds ?? [];

      const updateOps: Record<string, unknown> = {};
      const pushOps: Record<string, unknown> = {};

      if (!customerIds.includes(joinedCustomerId)) {
        pushOps['customerIds'] = joinedCustomerId;
      }
      if (!orderedCustomerIds.includes(joinedCustomerId)) {
        pushOps['orderedCustomerIds'] = joinedCustomerId;
      }

      if (Object.keys(pushOps).length > 0) {
        updateOps['$push'] = pushOps;
      }

      if (Object.keys(updateOps).length > 0) {
        const updatedSession = await this.tableSessionModel
          .findByIdAndUpdate(session._id, updateOps, { new: true, minimize: false })
          .exec();
        if (updatedSession) {
          session = updatedSession as any;
        }
      }
    }

    if (!session) {
      throw new NotFoundException('Table session not found');
    }

    const sessionAny = session as any;
    const guestToken = generateGuestToken();

    this.socketGateway.broadcast(`table:${table.id}`, 'server:table:session-joined', {
      sessionId: session._id.toString(),
      tableId: table.id,
      status: session.status,
      joinedAt: new Date(),
    });

    return {
      session: {
        id: session._id.toString(),
        status: session.status,
        startedAt: sessionAny.startedAt ?? session.openedAt,
        tableId: session.tableId,
        orderIds: session.orderIds,
        totalAmountCents: sessionAny.totalAmountCents ?? session.totalAmount,
        paidAmountCents: sessionAny.paidAmountCents ?? session.paidAmount,
        balanceDueCents: sessionAny.balanceDueCents ?? session.balanceDue,
      },
      table: {
        id: table.id,
        name: table.name,
        capacity: table.capacity,
        zone: table.zone,
      },
      restaurant: {
        id: restaurant.id,
        name: restaurant.name,
        logoUrl: restaurant.logoUrl,
        currency: restaurant.currency,
        locale: restaurant.locale,
      },
      branch: {
        id: branch.id,
        name: branch.name,
        timezone: branch.timezone,
      },
      qrToken,
      guestToken,
    };
  }

  async submitOrderFromTable(
    qrToken: string,
    sessionId: string,
    guestToken: string,
    input: SubmitTableOrderInput
  ): Promise<{ order: any; paymentIntent: any }> {
    const resolved = await this.resolveQr(qrToken);
    const { restaurant, branch, table } = resolved;

    const session = await this.tableSessionModel
      .findOne({
        _id: sessionId,
        tableId: table.id,
        status: S.TableSessionStatus.OPEN,
      })
      .exec();

    if (!session) {
      throw new NotFoundException('Active table session not found for this table');
    }

    const ctx: AuthContext & { authType?: string; sessionId?: string } = {
      userId: 'qr-guest',
      employeeId: null,
      restaurantId: restaurant.id,
      branchId: branch.id,
      role: S.Role.SUPER_ADMIN,
      permissions: [S.Permission.ORDER_CREATE, S.Permission.PAYMENT_ACCEPT],
      tokenType: 'anonymous',
      email: input.customerInfo?.email ?? '',
      firstName: input.displayName ?? input.customerInfo?.name ?? 'Guest',
      lastName: '',
      fullName: input.displayName ?? input.customerInfo?.name ?? 'Guest',
      authType: 'qr_guest',
      sessionId: session._id.toString(),
    };

    let customerId: string | undefined;
    if (input.customerInfo?.phone || input.customerInfo?.email) {
      const customer = await this.customersService.findOrCreate(ctx, {
        firstName: input.customerInfo.name ?? input.displayName,
        phone: input.customerInfo.phone,
        email: input.customerInfo.email,
      });
      customerId = customer._id.toString();
    }

    const mappedItems: OrderItemInput[] = input.items.map((it) => {
      const modifierMap = new Map<string, string[]>();
      for (const sel of it.selectedModifierOptions ?? []) {
        if (!modifierMap.has(sel.modifierId)) {
          modifierMap.set(sel.modifierId, []);
        }
        modifierMap.get(sel.modifierId)!.push(sel.optionId);
      }
      const modifierOptions: Array<{ modifierId: string; optionIds: string[] }> = [];
      for (const [modifierId, optionIds] of modifierMap.entries()) {
        modifierOptions.push({ modifierId, optionIds });
      }
      return {
        menuItemId: it.menuItemId,
        quantity: it.quantity,
        notes: it.specialInstructions,
        modifierOptions,
      };
    });

    const minuteBucket = Math.floor(Date.now() / 60_000);
    const idempotencyKey = hashIdempotencyKey([
      qrToken,
      session._id.toString(),
      guestToken,
      String(minuteBucket),
    ]);

    const requestedStatus =
      input.payIntent === 'PAY_AT_POS'
        ? S.OrderStatus.AWAITING_PAYMENT
        : S.OrderStatus.PENDING;

    const createInput: CreateOrderInput = {
      idempotencyKey,
      type: input.orderType as S.OrderType,
      source: 'QR',
      tableId: table.id,
      tableSessionId: session._id.toString(),
      qrCodeId: resolved.qr.token,
      customerId,
      // Denormalized customer snapshots so the Admin orders page search +
      // row-level display show name/phone/email immediately without a join.
      customerName: input.displayName ?? input.customerInfo?.name ?? undefined,
      customerPhone: input.customerInfo?.phone ?? undefined,
      customerEmail: input.customerInfo?.email ?? undefined,
      items: mappedItems,
      notes: input.displayName ? `Customer: ${input.displayName}` : undefined,
      status: requestedStatus,
    };

    let savedOrder = await this.ordersService.createOrder(ctx, createInput);

    let paymentIntent: any;

    if (input.payIntent === 'PAY_AT_POS') {
      if (savedOrder.status !== S.OrderStatus.AWAITING_PAYMENT) {
        savedOrder = await this.ordersService.updateOrderStatus(
          ctx,
          savedOrder._id.toString(),
          S.OrderStatus.AWAITING_PAYMENT
        );
      }

      const orderObj = savedOrder.toObject ? savedOrder.toObject() : savedOrder;
      this.socketGateway.broadcast(
        `branch:${branch.id}`,
        'server:order:new',
        orderObj
      );
      this.socketGateway.broadcast(
        `role:${S.Role.CASHIER}`,
        'server:order:new',
        {
          ...orderObj,
          message: `NEW ORDER TABLE ${table.name} AWAITING PAYMENT`,
        }
      );

      paymentIntent = {
        type: 'PAY_AT_POS',
        nextStep: 'Show "Pay at Counter" screen',
      };
    } else {
      const providerName = (input.onlineProvider ?? 'PAYSTACK') as PaymentProvider;
      const adapter = this.paymentProviderFactory.get(providerName);

      const publicApiBaseRaw = process.env.PUBLIC_API_URL ?? 'http://localhost:4000';
      const publicApiBase = String(publicApiBaseRaw).replace(/\/+$/, '');

      const initResult = await adapter.initialize({
        amountCents: savedOrder.totalCents,
        currency: restaurant.currency,
        email: input.customerInfo?.email ?? 'guest@unknown.local',
        customerId,
        orderId: savedOrder._id.toString(),
        branchId: branch.id,
        restaurantId: restaurant.id,
        callbackUrl: `${publicApiBase}/api/v1/public/payments/callback?orderId=${encodeURIComponent(
          savedOrder._id.toString()
        )}&token=${encodeURIComponent(qrToken)}`,
        metadata: {
          sessionId: session._id.toString(),
          qrToken,
          displayName: input.displayName ?? input.customerInfo?.name ?? 'Guest',
          tableId: table.id,
        },
      });

      await this.paymentsService.recordPayment(
        {
          userId: 'qr-guest',
          employeeId: null,
          restaurantId: restaurant.id,
          branchId: branch.id,
          role: S.Role.SUPER_ADMIN,
          permissions: [S.Permission.PAYMENT_ACCEPT],
          tokenType: 'anonymous',
          email: input.customerInfo?.email ?? '',
          firstName: input.displayName ?? input.customerInfo?.name ?? 'Guest',
          lastName: '',
          fullName: input.displayName ?? input.customerInfo?.name ?? 'Guest',
        } as any,
        {
          idempotencyKey: `pay-init-${savedOrder._id.toString()}-${Date.now()}`,
          orderId: savedOrder._id.toString(),
          amountCents: savedOrder.totalCents,
          currency: restaurant.currency,
          method: providerName === 'PAYSTACK' ? 'ONLINE_PAYSTACK' : 'ONLINE_FLUTTERWAVE',
          customerName: input.displayName ?? input.customerInfo?.name ?? 'Guest',
          customerPhone: input.customerInfo?.phone,
          transactionReference: initResult.transactionReference,
          provider: providerName,
          providerResponse: initResult.providerPayload,
        }
      );

      await this.orderModel
        .findByIdAndUpdate(
          savedOrder._id,
          {
            $set: {
              paymentStatus: S.PaymentStatus.PENDING,
            } as any,
          },
          { new: true }
        )
        .exec();

      savedOrder = (await this.orderModel.findById(savedOrder._id).exec()) as any;

      paymentIntent = {
        type: 'PAY_ONLINE',
        provider: providerName,
        checkoutUrl: initResult.checkoutUrl,
        transactionRef: initResult.transactionReference,
        expiresAt: initResult.expiresAt,
        providerPayload: initResult,
      };
    }

    const orderIdStr = savedOrder._id.toString();
    const sessionAny = session as any;
    const currentOrderIds = sessionAny.orderIds ?? [];

    if (!currentOrderIds.includes(orderIdStr)) {
      const orders = await this.orderModel
        .find({ _id: { $in: [...currentOrderIds, orderIdStr].map((id) => new Types.ObjectId(id)) } })
        .exec();

      const totalAmountCents = orders.reduce((sum, o) => sum + o.totalCents, 0);
      const paidAmountCents = orders.reduce((sum, o) => {
        if (o.paymentStatus === S.PaymentStatus.PAID) return sum + o.totalCents;
        if (o.paymentStatus === S.PaymentStatus.PARTIALLY_PAID) return sum + Math.floor(o.totalCents / 2);
        return sum;
      }, 0);

      await this.tableSessionModel
        .findByIdAndUpdate(
          session._id,
          {
            $push: {
              orderIds: orderIdStr,
              orderRefs: {
                orderId: orderIdStr,
                addedAt: new Date(),
                addedBy: 'qr-guest',
              },
            },
            $set: {
              totalAmount: totalAmountCents,
              paidAmount: paidAmountCents,
              balanceDue: Math.max(0, totalAmountCents - paidAmountCents),
              ...({
                totalAmountCents,
                paidAmountCents,
                balanceDueCents: Math.max(0, totalAmountCents - paidAmountCents),
              } as any),
            },
          },
          { new: true }
        )
        .exec();
    }

    return {
      order: savedOrder,
      paymentIntent,
    };
  }

  async submitOrderFromWebsite(
    branchId: string,
    input: SubmitWebsiteOrderInput
  ): Promise<{ order: any; paymentIntent: any }> {
    const branch = await this.branchModel.findById(branchId).exec();
    if (!branch) {
      throw new NotFoundException('Branch not found');
    }
    const restaurant = await this.restaurantModel.findById((branch as any).restaurantId).exec();
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    const ctx: AuthContext = {
      userId: 'website-guest',
      employeeId: null,
      restaurantId: restaurant._id.toString(),
      branchId: branch._id.toString(),
      role: S.Role.SUPER_ADMIN,
      permissions: [S.Permission.ORDER_CREATE, S.Permission.PAYMENT_ACCEPT],
      tokenType: 'anonymous',
      email: input.customerInfo?.email ?? '',
      firstName: input.displayName ?? input.customerInfo?.name ?? 'Guest',
      lastName: '',
      fullName: input.displayName ?? input.customerInfo?.name ?? 'Guest',
    } as any;

    let customerId: string | undefined;
    if (input.customerInfo?.phone || input.customerInfo?.email) {
      const customer = await this.customersService.findOrCreate(ctx as any, {
        firstName: input.customerInfo.name ?? input.displayName,
        phone: input.customerInfo.phone,
        email: input.customerInfo.email,
      });
      customerId = customer._id.toString();
    }

    const mappedItems: OrderItemInput[] = input.items.map((it) => {
      const modifierMap = new Map<string, string[]>();
      for (const sel of it.selectedModifierOptions ?? []) {
        if (!modifierMap.has(sel.modifierId)) {
          modifierMap.set(sel.modifierId, []);
        }
        modifierMap.get(sel.modifierId)!.push(sel.optionId);
      }
      const modifierOptions: Array<{ modifierId: string; optionIds: string[] }> = [];
      for (const [modifierId, optionIds] of modifierMap.entries()) {
        modifierOptions.push({ modifierId, optionIds });
      }
      return {
        menuItemId: it.menuItemId,
        quantity: it.quantity,
        notes: it.specialInstructions,
        modifierOptions,
      };
    });

    const minuteBucket = Math.floor(Date.now() / 60_000);
    const idempotencyKey = hashIdempotencyKey([
      'website',
      branch._id.toString(),
      input.customerInfo?.email ?? input.customerInfo?.phone ?? 'guest',
      String(minuteBucket),
    ]);

    const requestedStatus =
      input.payIntent === 'PAY_AT_POS'
        ? S.OrderStatus.AWAITING_PAYMENT
        : S.OrderStatus.PENDING;

    const createInput: CreateOrderInput = {
      idempotencyKey,
      type: input.orderType as S.OrderType,
      source: 'WEBSITE',
      customerId,
      // Denormalized customer snapshots so the Admin orders page search +
      // row-level display show name/phone/email immediately without a join.
      customerName: input.displayName ?? input.customerInfo?.name ?? undefined,
      customerPhone: input.customerInfo?.phone ?? undefined,
      customerEmail: input.customerInfo?.email ?? undefined,
      items: mappedItems,
      notes: input.displayName ? `Customer: ${input.displayName}` : undefined,
      status: requestedStatus,
    };

    let savedOrder = await this.ordersService.createOrder(ctx as any, createInput);

    let paymentIntent: any;
    if (input.payIntent === 'PAY_AT_POS') {
      if (savedOrder.status !== S.OrderStatus.AWAITING_PAYMENT) {
        savedOrder = await this.ordersService.updateOrderStatus(
          ctx as any,
          savedOrder._id.toString(),
          S.OrderStatus.AWAITING_PAYMENT
        );
      }

      const orderObj = savedOrder.toObject ? savedOrder.toObject() : savedOrder;
      this.socketGateway.broadcast(
        `branch:${branch._id.toString()}`,
        'server:order:new',
        orderObj
      );
      this.socketGateway.broadcast(
        `role:${S.Role.CASHIER}`,
        'server:order:new',
        {
          ...orderObj,
          message: `NEW WEBSITE ORDER AWAITING PAYMENT`,
        }
      );

      paymentIntent = {
        type: 'PAY_AT_POS',
        nextStep: 'Show "Pay at Counter" screen',
      };
    } else {
      const providerName = (input.onlineProvider ?? 'PAYSTACK') as PaymentProvider;
      const adapter = this.paymentProviderFactory.get(providerName);

      const publicApiBaseRaw = process.env.PUBLIC_API_URL ?? 'http://localhost:4000';
      const publicApiBase = String(publicApiBaseRaw).replace(/\/+$/, '');

      const initResult = await adapter.initialize({
        amountCents: savedOrder.totalCents,
        currency: restaurant.currency,
        email: input.customerInfo?.email ?? 'guest@unknown.local',
        customerId,
        orderId: savedOrder._id.toString(),
        branchId: branch._id.toString(),
        restaurantId: restaurant._id.toString(),
        callbackUrl: `${publicApiBase}/api/v1/public/payments/callback?orderId=${encodeURIComponent(
          savedOrder._id.toString()
        )}&mode=website`,
        metadata: {
          displayName: input.displayName ?? input.customerInfo?.name ?? 'Guest',
          source: 'WEBSITE',
        },
      });

      await this.paymentsService.recordPayment(
        ctx as any,
        {
          idempotencyKey: `pay-init-${savedOrder._id.toString()}-${Date.now()}`,
          orderId: savedOrder._id.toString(),
          amountCents: savedOrder.totalCents,
          currency: restaurant.currency,
          method: providerName === 'PAYSTACK' ? 'ONLINE_PAYSTACK' : 'ONLINE_FLUTTERWAVE',
          customerName: input.displayName ?? input.customerInfo?.name ?? 'Guest',
          customerPhone: input.customerInfo?.phone,
          transactionReference: initResult.transactionReference,
          provider: providerName,
          providerResponse: initResult.providerPayload,
        } as any
      );

      await this.orderModel
        .findByIdAndUpdate(
          savedOrder._id,
          {
            $set: {
              paymentStatus: S.PaymentStatus.PENDING,
            } as any,
          },
          { new: true }
        )
        .exec();

      savedOrder = (await this.orderModel.findById(savedOrder._id).exec()) as any;

      paymentIntent = {
        type: 'PAY_ONLINE',
        provider: providerName,
        checkoutUrl: initResult.checkoutUrl,
        transactionRef: initResult.transactionReference,
        expiresAt: initResult.expiresAt,
        providerPayload: initResult,
      };
    }

    return {
      order: savedOrder,
      paymentIntent,
    };
  }

  async getTableSessionStatus(sessionId: string): Promise<{
    session: any;
    recentOrders: Array<{
      id: string;
      status: S.OrderStatus;
      paymentStatus: S.PaymentStatus;
      totalAmountCents: number;
      itemsSummary: string[];
    }>;
  }> {
    const session = await this.tableSessionModel.findById(sessionId).exec();
    if (!session) {
      throw new NotFoundException('Table session not found');
    }

    const orderIds = (session as any).orderIds ?? [];
    const orders = await this.orderModel
      .find({ _id: { $in: orderIds.map((id: string) => new Types.ObjectId(id)) } })
      .sort({ createdAt: -1 })
      .limit(20)
      .exec();

    const recentOrders = orders.map((o) => {
      const itemsSummary = (o.items ?? [])
        .slice(0, 5)
        .map((it) => `${it.quantity}x ${it.menuItemName}`);
      return {
        id: o._id.toString(),
        status: o.status,
        paymentStatus: o.paymentStatus,
        totalAmountCents: o.totalCents,
        itemsSummary,
      };
    });

    const sessionAny = session as any;
    return {
      session: {
        id: session._id.toString(),
        status: session.status,
        tableId: session.tableId,
        orderIds: session.orderIds,
        totalAmountCents: sessionAny.totalAmountCents ?? session.totalAmount,
        paidAmountCents: sessionAny.paidAmountCents ?? session.paidAmount,
        balanceDueCents: sessionAny.balanceDueCents ?? session.balanceDue,
        startedAt: sessionAny.startedAt ?? session.openedAt,
        closedAt: sessionAny.closedAt ?? session.closedAt,
      },
      recentOrders,
    };
  }

  async getPublicOrderStatus(orderId: string): Promise<{
    id: string;
    orderNumber: string;
    status: S.OrderStatus;
    paymentStatus: S.PaymentStatus;
    items: Array<{
      name: string;
      quantity: number;
      perUnitTotalCents: number;
      totalCents: number;
      modifiersSummary?: string[];
    }>;
    subtotalCents: number;
    discountCents: number;
    taxCents: number;
    totalCents: number;
    createdAt: Date;
    estimatedReadyMinutes?: number;
    tableName?: string;
    customerName?: string;
  }> {
    const order = await this.orderModel.findById(orderId).exec();
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    const orderAny = order as any;
    const items = (orderAny.items || []).map((it: any) => {
      const modSummary: string[] = [];
      const modifierOptions: any[] = Array.isArray(it.modifierOptions)
        ? it.modifierOptions
        : Array.isArray(it.selectedModifiers)
          ? it.selectedModifiers
          : [];
      modifierOptions.forEach((m: any) => {
        const name = m?.name;
        if (typeof name === 'string' && name) modSummary.push(name);
        (Array.isArray(m?.optionNames) ? m.optionNames : []).forEach((n: any) => {
          if (typeof n === 'string' && n) modSummary.push(n);
        });
      });

      const quantity = Number(it.quantity ?? 0) || 0;
      const subtotalCents =
        Number(it.subtotalCents ?? it.subtotal ?? it.subTotalCents ?? 0) || 0;
      const totalCents =
        Number(it.totalCents ?? it.totalAmountCents ?? it.totalAmount ?? 0) || 0;
      const perUnitTotalCents =
        quantity > 0
          ? Math.round(subtotalCents / quantity)
          : Number(it.unitPriceCents ?? it.unitPrice ?? 0) || 0;
      return {
        name: it.menuItemName || it.name,
        quantity,
        perUnitTotalCents,
        totalCents,
        modifiersSummary: modSummary.length ? modSummary : undefined,
      };
    });
    const subtotalCents = orderAny.subtotalCents ?? orderAny.subtotal ?? 0;
    const taxCents = orderAny.taxCents ?? orderAny.taxAmount ?? 0;
    const discountCents = orderAny.discountCents ?? orderAny.discountAmount ?? 0;
    const totalCents = orderAny.totalCents ?? orderAny.totalAmount ?? 0;

    // --- Customer lookup for name
    let customerName: string | undefined;
    if (orderAny.customerId) {
      try {
        const customer = await this.customerModel.findById(orderAny.customerId).select('firstName lastName').exec();
        const cAny: any = customer;
        if (customer && (cAny.firstName || cAny.lastName)) {
          customerName = [cAny.firstName, cAny.lastName].filter(Boolean).join(' ').trim();
        }
      } catch {
        /* ignore */
      }
    }
    // Also accept denormalized snapshot field if present on older docs already has it
    if (!customerName && orderAny.customerName) customerName = String(orderAny.customerName);

    // Try to resolve table name from orderAny.tableName or orderAny.tableId via lookup
    let tableName: string | undefined = orderAny.tableName;
    if (!tableName && orderAny.tableId) {
      try {
        const t = await this.tableModel.findById(orderAny.tableId).select('name').lean().exec();
        if (t && (t as any).name) tableName = String((t as any).name);
      } catch { /* ignore */ }
    }
    if (!tableName && orderAny.table_session_id) {
      try {
        const ts = await this.tableSessionModel.findById(orderAny.table_session_id).select('tableId').lean().exec();
        const tsAny: any = ts;
        if (tsAny?.tableId) {
          const t = await this.tableModel.findById(tsAny.tableId).select('name').lean().exec();
          if (t && (t as any).name) tableName = String((t as any).name);
        }
      } catch { /* ignore */ }
    }

    const acceptedAt = orderAny.acceptedAt;
    const readyAt = orderAny.readyAt;
    let estimatedReadyMinutes: number | undefined = 20;
    if (acceptedAt && readyAt) {
      estimatedReadyMinutes = Math.max(
        1,
        Math.round((+new Date(readyAt) - +new Date(acceptedAt)) / 60000)
      );
    }

    return {
      id: order._id.toString(),
      orderNumber: orderAny.orderNumber ?? String(orderAny.order_number ?? `#${order._id.toString().slice(-6)}`),
      status: orderAny.status ?? order.status,
      paymentStatus: orderAny.paymentStatus ?? order.paymentStatus,
      items,
      subtotalCents,
      discountCents,
      taxCents,
      totalCents,
      createdAt: orderAny.createdAt ?? new Date(),
      estimatedReadyMinutes: orderAny.estimatedReadyMinutes ?? estimatedReadyMinutes,
      tableName,
      customerName,
    };
  }

  /**
   * Public (POS browser-dev bridge — mirrors the Electron cloud-pull-worker but for Vite/browser mode.
   * Returns recent WEBSITE/QR orders (UNPAID always + anything paid within ~24h) with fully
   * denormalized customer name/phone/email and embedded items[] + modifierOptions[].
   * Consumed by apps/pos mock shim's 30-second auto-poll loop so browser POS view shows real
   * backend orders even when not running packaged Electron.
   */
  async listRecentPosExternalOrders(input: {
    branchId?: string;
    sinceHours?: number;
  }): Promise<{
    orders: Array<{
      id: string;
      orderNumber: string;
      orderType: string;
      source: string;
      paymentStatus: string;
      subtotal: number;
      subtotalAmount: number;
      discountAmount: number;
      taxAmount: number;
      totalAmount: number;
      tipAmount: number;
      paidAmount: number;
      balanceDue: number;
      notes?: string | null;
      createdAt: number;
      updatedAt: number;
      customerId?: string;
      customerName?: string;
      customerPhone?: string;
      customerEmail?: string;
      sourceChannel?: string;
      branchId?: string;
      restaurantId?: string;
      items: Array<{
        menuItemId: string;
        name: string;
        unitPrice: number;
        quantity: number;
        subtotal: number;
        totalAmount: number;
        notes?: string;
        selectedModifiers: Array<Record<string, any>>;
      }>;
      _lineItems: Array<Record<string, any>>;
    }>;
  }> {
    const sinceMs = Math.max(1, Math.min(72, Number(input.sinceHours ?? 24) || 24)) * 60 * 60 * 1000;
    const cutoff = new Date(Date.now() - sinceMs);

    const filter: any = {
      source: { $in: ['WEBSITE', 'QR', 'website', 'qr'] },
      createdAt: { $gte: cutoff },
    };
    if (input.branchId) filter.branchId = input.branchId;

    const docs = await this.orderModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean()
      .exec();

    // Collect unique customerIds to denormalize in single bulk
    const customerIds = new Set<string>();
    for (const d of docs as any[]) {
      if (d.customerId) customerIds.add(String(d.customerId));
    }
    const custById = new Map<string, { firstName?: string; lastName?: string; phone?: string; email?: string }>();
    if (customerIds.size) {
      const customers = await this.customerModel
        .find({ _id: { $in: Array.from(customerIds).map((id) => new Types.ObjectId(id)) } })
        .select('firstName lastName phone email')
        .lean()
        .exec();
      for (const c of customers as any[]) {
        custById.set(String(c._id), {
          firstName: c.firstName,
          lastName: c.lastName,
          phone: c.phone,
          email: c.email,
        });
      }
    }

    const orderPayload: any[] = [];
    for (const doc of docs as any[]) {
      const id = String(doc._id);
      const sourceRaw = String(doc.source || doc.sourceChannel || '').toUpperCase();
      const orderType = String(doc.type || doc.orderType || 'DINE_IN');
      const subtotalCents = Number(doc.subtotalCents ?? doc.subtotal ?? 0) || 0;
      const discountCents = Number(doc.discountCents ?? doc.discountAmount ?? 0) || 0;
      const taxCents = Number(doc.taxCents ?? doc.taxAmount ?? 0) || 0;
      const totalCents = Number(doc.totalCents ?? doc.totalAmount ?? 0) || 0;
      const paidCents = Number(doc.paidCents ?? doc.paidAmountCents ?? doc.paidAmount ?? 0) || 0;
      const tipCents = Number(doc.tipCents ?? doc.tipAmountCents ?? doc.tipAmount ?? 0) || 0;
      const balanceCents = Math.max(0, totalCents - paidCents);

      // Currency to dollar scalars (mock shim camelCase (totalAmount / subtotal / etc are dollar floats
      const toDol = (c: number) => c / 100;

      // Customer contact fields: prefer denormalized doc fields fall back CUSTOMER join
      let customerName = doc.customerName;
      let customerPhone = doc.customerPhone;
      let customerEmail = doc.customerEmail;
      if ((!customerName || !customerPhone || !customerEmail) && doc.customerId) {
        const c = custById.get(String(doc.customerId));
        if (c) {
          if (!customerName && (c.firstName || c.lastName)) customerName = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
          if (!customerPhone && c.phone) customerPhone = c.phone;
          if (!customerEmail && c.email) customerEmail = c.email;
        }
      }

      const createdAtMs = doc.createdAt instanceof Date ? doc.createdAt.getTime() : new Date(doc.createdAt ?? Date.now()).getTime();
      const updatedAtMs = doc.updatedAt instanceof Date ? doc.updatedAt.getTime() : createdAtMs;

      // Extract embedded items[] for both POS camelCase items (for mockOrders.items) and
      // snake_case lineItems (for upsert into mockOrderItems).
      const rawItems: any[] = Array.isArray(doc.items) ? doc.items : [];
      const posItems = rawItems.map((it) => {
        const unitCents = Number(it.unitPriceCents ?? it.unitPrice ?? 0) || 0;
        const subC = Number(it.subtotalCents ?? it.subtotal ?? 0) || unitCents * (Number(it.quantity ?? 1) || 1);
        const totC = Number(it.totalCents ?? it.totalAmount ?? 0) || subC;
        return {
          menuItemId: String(it.menuItemId ?? it.menu_item_id ?? ''),
          name: String(it.menuItemName ?? it.name ?? ''),
          unitPrice: unitCents / 100,
          quantity: Number(it.quantity ?? 1),
          subtotal: subC / 100,
          totalAmount: totC / 100,
          notes: it.notes ?? it.specialInstructions ?? undefined,
          selectedModifiers: Array.isArray(it.modifierOptions) ? it.modifierOptions : [],
        };
      });

      // _lineItems (snake_case shape for addItem into mockOrderItems — mirror of orders.repository.addItem
      const lineItems = rawItems.map((it, i) => ({
        id: `${id}__${i}`,
        menu_item_id: String(it.menuItemId ?? it.menu_item_id ?? ''),
        name_snapshot: String(it.menuItemName ?? it.name ?? ''),
        price_snapshot_cents: Number(it.unitPriceCents ?? (it.unitPrice ? Math.round(Number(it.unitPrice) * 100) : 0)) || 0,
        quantity: Number(it.quantity ?? 1) || 1,
        subtotal_cents: Number(it.subtotalCents ?? it.subtotal ?? 0) || 0,
        tax_cents: Number(it.taxCents ?? 0) || 0,
        discount_cents: Number(it.discountCents ?? 0) || 0,
        total_cents: Number(it.totalCents ?? it.totalAmount ?? 0) || 0,
        special_instructions: it.notes ?? it.specialInstructions ?? null,
        preparation_status: String(it.preparationStatus ?? 'NEW'),
        _modifierOptions: Array.isArray(it.modifierOptions) ? it.modifierOptions.map((mo: any, j: number) => ({
          id: `${id}__${i}__${j}`,
          modifier_id: String(mo.modifierId ?? mo.modifier_id ?? ''),
          modifier_name: String(mo.modifierName ?? mo.modifier_name ?? mo.name ?? ''),
          option_id: String(mo.optionId ?? mo.option_id ?? ''),
          option_name: String(mo.optionName ?? mo.option_name ?? mo.option ?? ''),
          price_delta_cents: Number(mo.priceDeltaCents ?? mo.priceDelta ? Math.round(Number(mo.priceDelta) * 100) : 0) || 0,
        })) : [],
      }));

      orderPayload.push({
        id,
        orderNumber: String(doc.orderNumber ?? doc.order_number ?? `#${id.slice(-6)}`),
        orderType,
        source: sourceRaw,
        sourceChannel: sourceRaw,
        paymentStatus: String(doc.paymentStatus ?? 'UNPAID'),
        subtotal: toDol(subtotalCents),
        subtotalAmount: toDol(subtotalCents),
        discountAmount: toDol(discountCents),
        taxAmount: toDol(taxCents),
        totalAmount: toDol(totalCents),
        tipAmount: toDol(tipCents),
        paidAmount: toDol(paidCents),
        balanceDue: toDol(balanceCents),
        notes: doc.notes ?? null,
        createdAt: createdAtMs,
        updatedAt: updatedAtMs,
        customerId: doc.customerId ? String(doc.customerId) : undefined,
        customerName: customerName ?? undefined,
        customerPhone: customerPhone ?? undefined,
        customerEmail: customerEmail ?? undefined,
        branchId: doc.branchId ? String(doc.branchId) : undefined,
        restaurantId: doc.restaurantId ? String(doc.restaurantId) : undefined,
        items: posItems,
        _lineItems: lineItems,
      });
    }
    return { orders: orderPayload };
  }

  // =========================================================================
  // Public POS-originated sync batch (mark-paid + status updates)
  // Mirrors SyncService.applyBatch but without JWT — browser POS uses this.
  // =========================================================================
  async applyPosSyncBatch(input: {
    deviceId?: string;
    commands: Array<{
      idempotencyKey: string;
      entityType: string;
      operation: 'CREATE' | 'UPDATE' | 'DELETE';
      entityId?: string;
      payload: Record<string, unknown>;
      localEntityVersion?: number;
    }>;
  }): Promise<{
    results: Array<{
      idempotencyKey: string;
      entityType: string;
      entityId: string | null;
      status: 'SUCCESS' | 'FAILED' | 'CONFLICT';
      errorMessage?: string;
    }>;
  }> {
    const deviceId = input.deviceId ?? 'pos-browser-device';
    const results: Array<{
      idempotencyKey: string;
      entityType: string;
      entityId: string | null;
      status: 'SUCCESS' | 'FAILED' | 'CONFLICT';
      errorMessage?: string;
    }> = [];

    for (const cmd of input.commands) {
      let entityId: string | null = cmd.entityId ?? null;
      try {
        const entityTypeUpper = String(cmd.entityType || '').toUpperCase();
        let status: 'SUCCESS' | 'FAILED' | 'CONFLICT' = 'SUCCESS';
        let errorMessage: string | undefined;

        switch (entityTypeUpper) {
          case 'ORDER': {
            const res = await this.applyPosOrderCommand(cmd);
            entityId = res.entityId;
            break;
          }
          case 'PAYMENT': {
            const res = await this.applyPosPaymentCommand(cmd);
            entityId = res.entityId;
            break;
          }
          default:
            // Ignore unsupported entity types — POS only pushes ORDER + PAYMENT
            this.logger.warn(`[applyPosSyncBatch] skipping unsupported entityType=${cmd.entityType}`);
            break;
        }

        results.push({
          idempotencyKey: cmd.idempotencyKey,
          entityType: cmd.entityType,
          entityId,
          status,
          errorMessage,
        });
      } catch (e) {
        this.logger.error(
          `[applyPosSyncBatch] cmd=${cmd.idempotencyKey}/${cmd.entityType} failed: ${(e as Error).message}`
        );
        results.push({
          idempotencyKey: cmd.idempotencyKey,
          entityType: cmd.entityType,
          entityId,
          status: 'FAILED',
          errorMessage: (e as Error).message,
        });
      }
    }

    return { results };
  }

  // ----- ORDER command handler (pos-originated) --------------------------
  private async applyPosOrderCommand(cmd: {
    operation: 'CREATE' | 'UPDATE' | 'DELETE';
    entityId?: string;
    payload: Record<string, unknown>;
  }): Promise<{ entityId: string | null }> {
    const payload = cmd.payload;
    const branchId = (payload.branchId as string) ?? '';
    const restaurantId = (payload.restaurantId as string) ?? '';

    if (cmd.operation === 'UPDATE') {
      const entityId =
        cmd.entityId ??
        (payload._id as string) ??
        (payload.id as string);
      if (!entityId) throw new Error('UPDATE ORDER requires entityId');

      const existing = await this.orderModel.findById(entityId).exec();
      if (existing) {
        // Pick the fields we allow POS to mutate remotely (payment + status fields)
        const allowedPatch: Record<string, unknown> = {};
        const allowedKeys = [
          'paymentStatus',
          'paymentMethod',
          'paidAmountCents',
          'paidAmount',
          'balanceDueCents',
          'balanceDue',
          'acceptedByEmployeeId',
          'acceptedAt',
          'notes',
          'status',
          'deliveredAt',
          'deliveredByEmployeeId',
          'updatedAt',
          'completedAt',
        ];
        for (const k of allowedKeys) {
          if (payload[k] !== undefined) allowedPatch[k] = payload[k];
        }
        // Convert any epoch-ms timestamps in the patch to Date objects
        for (const tsKey of ['acceptedAt', 'deliveredAt', 'updatedAt', 'completedAt']) {
          if (typeof allowedPatch[tsKey] === 'number') {
            allowedPatch[tsKey] = new Date(allowedPatch[tsKey] as number);
          }
        }
        const updated = await this.orderModel
          .findByIdAndUpdate(entityId, { $set: allowedPatch }, { new: true })
          .exec();
        return { entityId: updated?._id.toString() ?? entityId };
      }

      // Not found: if we have enough context, try upsert; otherwise skip (not found)
      if (restaurantId && branchId) {
        const upserted = await this.orderModel.create({
          _id: entityId,
          restaurantId,
          branchId,
          ...payload,
        });
        return { entityId: upserted._id.toString() };
      }
      this.logger.warn(`[applyPosOrderCommand] order ${entityId} not found in Mongo, skipping UPDATE`);
      return { entityId };
    }

    if (cmd.operation === 'CREATE') {
      if (!restaurantId || !branchId) {
        throw new Error('CREATE ORDER requires restaurantId + branchId');
      }
      const created = await this.orderModel.create({
        restaurantId,
        branchId,
        ...payload,
      });
      return { entityId: created._id.toString() };
    }

    if (cmd.operation === 'DELETE') {
      const entityId =
        cmd.entityId ?? (payload._id as string) ?? (payload.id as string);
      if (!entityId) throw new Error('DELETE ORDER requires entityId');
      await this.orderModel.findByIdAndDelete(entityId).exec();
      return { entityId };
    }

    throw new Error(`Unknown ORDER operation: ${cmd.operation}`);
  }

  // ----- PAYMENT command handler (pos-originated) ----------------------
  private async applyPosPaymentCommand(cmd: {
    operation: 'CREATE' | 'UPDATE' | 'DELETE';
    entityId?: string;
    payload: Record<string, unknown>;
  }): Promise<{ entityId: string | null }> {
    const payload = cmd.payload as any;
    const branchId = String(payload.branchId ?? '');
    const restaurantId = String(payload.restaurantId ?? '');

    const amountCents =
      typeof payload.amountCents === 'number'
        ? Number(payload.amountCents)
        : typeof payload.amount_cents === 'number'
          ? Number(payload.amount_cents)
          : typeof payload.amount === 'number'
            ? Math.round(Number(payload.amount) * 100)
            : 0;
    if (amountCents <= 0 && cmd.operation === 'CREATE') {
      throw new Error(`Invalid payment amount: ${amountCents}`);
    }
    const orderId =
      payload.orderId != null
        ? String(payload.orderId)
        : payload.order_id != null
          ? String(payload.order_id)
          : '';
    const employeeId =
      payload.employeeId != null
        ? String(payload.employeeId)
        : payload.employee_id != null
          ? String(payload.employee_id)
          : '';
    const shiftId =
      payload.shiftId != null
        ? String(payload.shiftId)
        : payload.shift_id != null
          ? String(payload.shift_id)
          : '';
    const idempotencyKey = String(
      payload.idempotencyKey ??
        payload.idempotency_key ??
        `pos-payment-${orderId}-${Date.now()}`
    );

    if (cmd.operation === 'CREATE') {
      if (!restaurantId || !branchId) {
        throw new Error('CREATE PAYMENT requires restaurantId + branchId');
      }

      // Idempotency: if already created with same key, return existing
      const existingPayment = await this.paymentModel
        .findOne({ idempotencyKey })
        .exec();
      if (existingPayment) {
        return { entityId: existingPayment._id.toString() };
      }

      const completedAt =
        payload.completedAt != null
          ? new Date(payload.completedAt)
          : payload.completed_at != null
            ? new Date(payload.completed_at)
            : payload.status === S.PaymentStatus.PAID ||
                payload.status === 'COMPLETED'
              ? new Date()
              : undefined;

      // Build final create doc. For provider-originated payments (Paystack,
      // Flutterwave, etc.) the caller supplies transactionReference. For
      // local POS counter payments (CASH / CARD_POS / BANK_TRANSFER) no
      // external reference exists — synthesize one from the globally-unique
      // idempotencyKey so the sparse compound unique index
      //   { transactionReference: 1, provider: 1 } sparse unique
      // never collides. Using idempotencyKey as a base guarantees global
      // uniqueness (idempotencyKey has its own unique index) and keeps the
      // reference auditably traceable back to the POS sync command.
      const createDoc: any = {
        restaurantId,
        branchId,
        ...(payload as any),
        ...(orderId ? { orderId } : {}),
        ...(employeeId ? { employeeId } : {}),
        ...(shiftId ? { shiftId } : {}),
        amountCents,
        idempotencyKey,
        verificationSource: payload.verificationSource ?? payload.verification_source ?? 'LOCAL',
        provider: payload.provider ?? 'LOCAL_POS',
        completedAt,
      };
      // Clean up null optional fields that would otherwise be serialized as
      // explicit nulls (adds noise to Mongo docs; can confuse aggregations).
      // For transactionReference specifically, fall back to synthetic ref
      // derived from idempotencyKey — guaranteed unique.
      if (createDoc.transactionReference == null) {
        createDoc.transactionReference = `pos-${String(idempotencyKey).slice(0, 40)}`;
      }
      if (createDoc.providerResponse == null) delete createDoc.providerResponse;
      const created = await this.paymentModel.create(createDoc);

      // Reconcile order paymentStatus against ALL realized payments
      if (orderId) {
        const realizedStatuses = [
          S.PaymentStatus.PAID,
          S.PaymentStatus.PENDING,
          S.PaymentStatus.PARTIALLY_PAID,
          // Mongo Payment schema has a COMPLETED string status that isn't in
          // shared-types S.PaymentStatus enum; include as raw string for
          // backwards compatibility with existing payment docs.
          'COMPLETED' as S.PaymentStatus,
        ];
        const realizedPayments = await this.paymentModel
          .find({
            orderId,
            status: { $in: realizedStatuses },
          })
          .exec();
        const sumCents = realizedPayments.reduce(
          (acc, p) => acc + (Number((p as any).amountCents) || 0),
          0
        );
        const order = await this.orderModel.findById(orderId).exec();
        if (order) {
          const totalCents = Number((order as any).totalCents || 0);
          const paymentStatus: S.PaymentStatus =
            sumCents >= totalCents && totalCents > 0
              ? S.PaymentStatus.PAID
              : sumCents > 0
                ? S.PaymentStatus.PARTIALLY_PAID
                : S.PaymentStatus.UNPAID;
          const orderPatch: Record<string, unknown> = { paymentStatus };
          if (!(order as any).shiftId && shiftId) orderPatch.shiftId = shiftId;
          if (!(order as any).employeeId && employeeId) orderPatch.employeeId = employeeId;
          // Auto-advance AWAITING_PAYMENT → RECEIVED upon full payment
          const curStatus = String((order as any).status || '');
          if (
            curStatus === S.OrderStatus.AWAITING_PAYMENT &&
            paymentStatus === S.PaymentStatus.PAID
          ) {
            orderPatch.status = S.OrderStatus.RECEIVED;
          }
          // Denormalize paid/balance onto order for quick list queries
          orderPatch.paidAmountCents = sumCents;
          orderPatch.balanceDueCents = Math.max(0, totalCents - sumCents);
          await this.orderModel
            .findByIdAndUpdate(order._id, { $set: orderPatch }, { new: true })
            .exec();
        }
      }

      return { entityId: created._id.toString() };
    }

    if (cmd.operation === 'UPDATE') {
      const entityId = cmd.entityId ?? (payload._id as string);
      if (!entityId) throw new Error('UPDATE PAYMENT requires entityId');
      const updated = await this.paymentModel
        .findByIdAndUpdate(entityId, { $set: payload }, { new: true })
        .exec();
      if (!updated) {
        this.logger.warn(`[applyPosPaymentCommand] payment ${entityId} not found`);
        return { entityId };
      }
      return { entityId: updated._id.toString() };
    }

    if (cmd.operation === 'DELETE') {
      const entityId =
        cmd.entityId ?? (payload._id as string) ?? (payload.id as string);
      if (!entityId) throw new Error('DELETE PAYMENT requires entityId');
      await this.paymentModel.findByIdAndDelete(entityId).exec();
      return { entityId };
    }

    throw new Error(`Unknown PAYMENT operation: ${cmd.operation}`);
  }
}
