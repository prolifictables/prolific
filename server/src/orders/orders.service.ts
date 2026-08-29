import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import * as S from '@prolific/shared-types';
import { Order, OrderItem, OrderItemModifierOption } from './schemas/order.schema';
import { KitchenOrder, KitchenOrderItem } from './schemas/kitchen-order.schema';
import { MenuItem } from '../menu/schemas/menu-item.schema';
import { MenuModifier } from '../menu/schemas/menu-modifier.schema';
import { TableSession } from '../table-sessions/schemas/table-session.schema';
import { Customer } from '../customers/schemas/customer.schema';
import { Table } from '../tables/schemas/table.schema';
import { Discount } from '../discounts/schemas/discount.schema';
import { Tax } from '../taxes/schemas/tax.schema';
import { Recipe } from '../menu/schemas/recipe.schema';
import { InventoryItem } from '../inventory/schemas/inventory-item.schema';
import { InventoryTransaction } from '../inventory/schemas/inventory-transaction.schema';
import { LoyaltyAccount } from '../loyalty/schemas/loyalty-account.schema';
import { Shift } from '../shifts/schemas/shift.schema';
import { Employee } from '../employees/schemas/employee.schema';
import { User } from '../users/schemas/user.schema';
import type { AuthContext } from '../common/decorators/current-user.decorator';

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

export interface OrderItemModifierInput {
  modifierId: string;
  optionIds: string[];
}

export interface OrderItemInput {
  menuItemId: string;
  quantity: number;
  modifierOptions?: OrderItemModifierInput[];
  notes?: string;
  kitchenNotes?: string;
}

export interface CreateOrderInput {
  idempotencyKey: string;
  type: S.OrderType;
  source: 'POS' | 'QR' | 'WEBSITE' | 'APP' | 'PHONE';
  tableId?: string;
  tableSessionId?: string;
  qrCodeId?: string;
  customerId?: string;
  employeeId?: string;
  shiftId?: string;
  items: OrderItemInput[];
  discountId?: string;
  taxIds?: string[];
  notes?: string;
  status?: S.OrderStatus;
}

export interface UpdateOrderStatusOpts {
  reason?: string;
  approvalToken?: string;
}

export interface ListOrdersFilters {
  status?: S.OrderStatus;
  tableId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  source?: string;
  search?: string;
  sort?: string;
  cursor?: string;
  limit?: number;
  branchId?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    cursor: string | null;
    count: number;
    hasMore: boolean;
    requestId: string | undefined;
    timestamp: string | undefined;
  };
}

// ---------------------------------------------------------------------------
// Terminal statuses — these are immutable once set
// ---------------------------------------------------------------------------
const TERMINAL_STATUSES = new Set([
  S.OrderStatus.COMPLETED,
  S.OrderStatus.REFUNDED,
  S.OrderStatus.VOIDED,
  S.OrderStatus.CANCELLED,
]);

// Valid payment statuses for "already paid" check
const PAID_PAYMENT_STATUSES = new Set([
  S.PaymentStatus.PAID,
  S.PaymentStatus.PARTIALLY_PAID,
]);

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<Order>,
    @InjectModel(KitchenOrder.name) private readonly kitchenOrderModel: Model<KitchenOrder>,
    @InjectModel(MenuItem.name) private readonly menuItemModel: Model<MenuItem>,
    @InjectModel(MenuModifier.name) private readonly menuModifierModel: Model<MenuModifier>,
    @InjectModel(TableSession.name) private readonly tableSessionModel: Model<TableSession>,
    @InjectModel(Customer.name) private readonly customerModel: Model<Customer>,
    @InjectModel(Table.name) private readonly tableModel: Model<Table>,
    @InjectModel(Discount.name) private readonly discountModel: Model<Discount>,
    @InjectModel(Tax.name) private readonly taxModel: Model<Tax>,
    @InjectModel(Recipe.name) private readonly recipeModel: Model<Recipe>,
    @InjectModel(InventoryItem.name) private readonly inventoryItemModel: Model<InventoryItem>,
    @InjectModel(InventoryTransaction.name) private readonly inventoryTxModel: Model<InventoryTransaction>,
    @InjectModel(LoyaltyAccount.name) private readonly loyaltyAccountModel: Model<LoyaltyAccount>,
    @InjectModel(Shift.name) private readonly shiftModel: Model<Shift>,
    @InjectModel(Employee.name) private readonly employeeModel: Model<Employee>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly jwtService: JwtService
  ) {}

  // =========================================================================
  // 1. createOrder
  // =========================================================================

  async createOrder(
    ctx: AuthContext,
    input: CreateOrderInput
  ): Promise<Order> {
    const branchId = ctx.branchId;
    const restaurantId = ctx.restaurantId;
    if (!branchId || !restaurantId) {
      throw new BadRequestException('Branch and restaurant context required');
    }

    // Step 1: Idempotency check — service-level first (unique index is last line of defense)
    const existing = await this.orderModel
      .findOne({ idempotencyKey: input.idempotencyKey })
      .exec();
    if (existing) {
      this.logger.log(`Idempotent replay: returning existing order ${existing._id}`);
      return this.withVirtualId(existing);
    }

    // Step 2: Validate items and resolve menu items + modifiers (server-side pricing)
    const { orderItems, subtotalCents, preparationNeededItems } = await this.computeOrderItems(
      branchId,
      restaurantId,
      input.items
    );

    // Step 3: Apply discount
    let discountCents = 0;
    let discountId: string | undefined = input.discountId;
    if (input.discountId) {
      const discount = await this.discountModel
        .findOne({ _id: input.discountId, branchId, isActive: true })
        .exec();
      if (!discount) {
        throw new BadRequestException(`Discount ${input.discountId} not found or inactive`);
      }
      if (discount.minOrderAmount && subtotalCents < discount.minOrderAmount) {
        throw new BadRequestException(
          `Order subtotal ${subtotalCents} below minimum ${discount.minOrderAmount} for discount`
        );
      }
      if (discount.type === 'PERCENTAGE') {
        discountCents = Math.floor((subtotalCents * discount.value) / 100);
        if (discount.maxAmount) {
          discountCents = Math.min(discountCents, discount.maxAmount);
        }
      } else {
        discountCents = discount.value;
      }
      // Never allow discount to exceed subtotal
      discountCents = Math.min(discountCents, subtotalCents);
    }

    // Step 4: Apply taxes
    const taxableSubtotal = subtotalCents - discountCents;
    let taxCents = 0;
    const taxIdsToApply: string[] = [];

    // Collect taxIds: explicit from input + from individual menu items that are taxable
    if (input.taxIds && input.taxIds.length > 0) {
      taxIdsToApply.push(...input.taxIds);
    }
    // Also add per-item taxIds from items that are taxable
    for (const itemInput of input.items) {
      const menuItem = await this.menuItemModel.findById(itemInput.menuItemId).exec();
      if (menuItem?.isTaxable && menuItem.taxIds?.length) {
        for (const tid of menuItem.taxIds) {
          if (!taxIdsToApply.includes(tid)) taxIdsToApply.push(tid);
        }
      }
    }

    if (taxIdsToApply.length > 0) {
      const activeTaxes = await this.taxModel
        .find({ _id: { $in: taxIdsToApply }, branchId, isActive: true })
        .exec();
      for (const tax of activeTaxes) {
        if (!tax.isIncludedInPrice) {
          taxCents += Math.floor((taxableSubtotal * tax.rate) / 100);
        }
      }
    }

    // Step 5: Compute final totals
    const totalCents = subtotalCents - discountCents + taxCents;

    // Step 6: Generate auto-incrementing order number per branch + date prefix
    const orderNumber = await this.generateOrderNumber(branchId);

    // Step 7: Resolve table session (if provided) and validate it's OPEN
    if (input.tableSessionId) {
      const session = await this.tableSessionModel
        .findOne({ _id: input.tableSessionId, branchId })
        .exec();
      if (!session) {
        throw new NotFoundException(`TableSession ${input.tableSessionId} not found`);
      }
      if (session.status !== S.TableSessionStatus.OPEN) {
        throw new BadRequestException(
          `TableSession must be OPEN to add orders (status=${session.status})`
        );
      }
    }

    // Step 8: Build and save the order
    let resolvedShiftId = input.shiftId;
    if (!resolvedShiftId && ctx.employeeId) {
      const latestOpen = await this.shiftModel
        .findOne({
          employeeId: ctx.employeeId,
          status: 'OPEN',
          branchId,
        })
        .sort({ openingTimestamp: -1 })
        .exec();
      if (latestOpen) {
        resolvedShiftId = latestOpen._id.toString();
      }
    }

    // Note: S.OrderStatus.NEW does not exist in shared-types — use PENDING (draft)
    // as the initial persisted state, which aligns with docs/09-state-machines.md.
    const initialStatus = input.status ?? S.OrderStatus.PENDING;
    const order = await this.orderModel.create({
      restaurantId,
      branchId,
      orderNumber,
      type: input.type,
      status: initialStatus,
      paymentStatus: S.PaymentStatus.UNPAID,
      source: input.source,
      tableId: input.tableId,
      tableSessionId: input.tableSessionId,
      qrCodeId: input.qrCodeId,
      customerId: input.customerId,
      employeeId: input.employeeId ?? ctx.employeeId ?? undefined,
      shiftId: resolvedShiftId,
      subtotalCents,
      discountCents,
      taxCents,
      totalCents,
      discountId,
      taxIds: taxIdsToApply,
      notes: input.notes,
      idempotencyKey: input.idempotencyKey,
      items: orderItems,
    });

    // Step 9: Append orderId to the table session if provided
    if (input.tableSessionId) {
      await this.tableSessionModel
        .findByIdAndUpdate(
          input.tableSessionId,
          {
            $push: {
              orderIds: order._id.toString(),
              orderRefs: {
                orderId: order._id.toString(),
                addedAt: new Date(),
                addedBy: ctx.employeeId ?? undefined,
              },
            },
            $inc: {
              totalAmount: totalCents,
              balanceDue: totalCents,
            },
          },
          { new: true }
        )
        .exec();
    }

    // Step 10: Create KitchenOrder for items that need preparation
    if (preparationNeededItems.length > 0) {
      await this.createKitchenOrderForOrder(order, preparationNeededItems);
    }

    return this.withVirtualId(order);
  }

  // =========================================================================
  // 2. updateOrderStatus
  // =========================================================================

  async updateOrderStatus(
    ctx: AuthContext,
    orderId: string,
    newStatus: S.OrderStatus,
    opts: UpdateOrderStatusOpts = {}
  ): Promise<Order> {
    const branchId = ctx.branchId;
    if (!branchId) {
      throw new BadRequestException('Branch context required');
    }

    const order = await this.orderModel
      .findOne({ _id: orderId, branchId })
      .exec();
    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    const oldStatus = order.status;

    // Terminal immutability check
    if (TERMINAL_STATUSES.has(oldStatus)) {
      throw new BadRequestException(
        `Order status ${oldStatus} is terminal and cannot be changed. Use dedicated refund/void endpoints.`
      );
    }

    // Validate transition allowed per state machine rules
    this.validateStatusTransition(oldStatus, newStatus);

    // Approval required for REFUND / VOID / CANCELLED (if after kitchen started)
    const needsApproval =
      newStatus === S.OrderStatus.REFUNDED ||
      newStatus === S.OrderStatus.VOIDED ||
      (newStatus === S.OrderStatus.CANCELLED &&
        (oldStatus === S.OrderStatus.PREPARING ||
          oldStatus === S.OrderStatus.READY ||
          oldStatus === S.OrderStatus.SERVED));

    if (needsApproval) {
      await this.verifyApprovalToken(ctx, opts.approvalToken, {
        action:
          newStatus === S.OrderStatus.REFUNDED
            ? S.AuditAction.REFUND
            : newStatus === S.OrderStatus.VOIDED
            ? S.AuditAction.VOID
            : S.AuditAction.UPDATE,
        entityType: 'ORDER',
        entityId: orderId,
      });
    }

    // Apply the status change
    const updateFields: Record<string, unknown> = { status: newStatus };

    // Apply status-specific timestamps and side effects
    switch (newStatus) {
      case S.OrderStatus.COMPLETED:
        // Check if order is fully paid before allowing COMPLETED
        if (order.paymentStatus !== S.PaymentStatus.PAID) {
          throw new BadRequestException(
            `Order must be fully PAID before COMPLETED (paymentStatus=${order.paymentStatus})`
          );
        }
        updateFields.completedAt = new Date();
        break;
      case S.OrderStatus.CANCELLED:
        updateFields.cancelledAt = new Date();
        updateFields.voidReason = opts.reason;
        break;
      case S.OrderStatus.VOIDED:
        updateFields.voidedAt = new Date();
        updateFields.voidReason = opts.reason;
        break;
      case S.OrderStatus.REFUNDED:
        updateFields.refundReason = opts.reason;
        break;
    }

    const updated = await this.orderModel
      .findByIdAndUpdate(order._id, { $set: updateFields }, { new: true })
      .exec();
    if (!updated) throw new NotFoundException('Order disappeared during update');

    // ---- Side effects after save ----

    // CANCELLED after NEW → cancel KitchenOrder
    if (newStatus === S.OrderStatus.CANCELLED && oldStatus !== S.OrderStatus.PENDING) {
      await this.kitchenOrderModel
        .updateOne(
          { orderId: order._id.toString() },
          { $set: { status: S.KitchenStatus.CANCELLED } }
        )
        .exec();
    }

    // COMPLETED → deduct inventory + accrue loyalty
    if (newStatus === S.OrderStatus.COMPLETED) {
      await this.deductInventoryForOrder(ctx, updated);
      await this.accrueLoyaltyForOrder(ctx, updated);
    }

    // VOIDED → cancel kitchen
    if (newStatus === S.OrderStatus.VOIDED) {
      await this.kitchenOrderModel
        .updateOne(
          { orderId: order._id.toString() },
          { $set: { status: S.KitchenStatus.CANCELLED } }
        )
        .exec();
    }

    return this.withVirtualId(updated);
  }

  // =========================================================================
  // 3. listOrders — cursor pagination
  // =========================================================================

  async listOrders(
    ctx: AuthContext,
    filters: ListOrdersFilters = {}
  ): Promise<PaginatedResult<S.Order>> {
    const branchId = ctx.branchId || filters.branchId;
    if (!branchId) {
      throw new BadRequestException('Branch context required');
    }

    const limit = Math.min(filters.limit ?? 50, 100);

    const query: Record<string, unknown> = { branchId };
    if (filters.status) query.status = filters.status;
    if (filters.tableId) query.tableId = filters.tableId;
    if (filters.source) query.source = filters.source;
    if (filters.search) {
      const s = filters.search.trim();
      if (s) {
        query.$or = [
          { orderNumber: { $regex: s, $options: 'i' } },
          { notes: { $regex: s, $options: 'i' } },
        ];
      }
    }
    if (filters.dateFrom || filters.dateTo) {
      query.createdAt = {} as Record<string, Date>;
      if (filters.dateFrom) (query.createdAt as Record<string, Date>).$gte = filters.dateFrom;
      if (filters.dateTo) (query.createdAt as Record<string, Date>).$lte = filters.dateTo;
    }

    // Cursor-based pagination: cursor is the last document's _id (base64)
    if (filters.cursor) {
      try {
        const decoded = Buffer.from(filters.cursor, 'base64').toString('utf-8');
        const parsed = JSON.parse(decoded);
        if (parsed._id && parsed.createdAt) {
          // Pagination by (createdAt DESC, _id DESC)
          query.$or = [
            { createdAt: { $lt: new Date(parsed.createdAt) } },
            {
              createdAt: { $eq: new Date(parsed.createdAt) },
              _id: { $lt: new Types.ObjectId(parsed._id) },
            },
          ];
        }
      } catch (e) {
        throw new BadRequestException('Invalid cursor');
      }
    }

    const sort: Record<string, 1 | -1> = { createdAt: -1, _id: -1 };
    if (filters.sort === 'createdAt') sort.createdAt = 1;
    if (filters.sort === '-createdAt') sort.createdAt = -1;

    // Fetch one extra to detect hasMore
    const docs = await this.orderModel
      .find(query)
      .sort(sort)
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
          createdAt: (last as unknown as { createdAt: Date }).createdAt.toISOString(),
        })
      ).toString('base64');
    }

    const tableIds = Array.from(
      new Set(data.map((d: any) => String(d.tableId || '')).filter(Boolean))
    );
    const customerIds = Array.from(
      new Set(data.map((d: any) => String(d.customerId || '')).filter(Boolean))
    );
    const employeeIds = Array.from(
      new Set(data.map((d: any) => String(d.employeeId || '')).filter(Boolean))
    );

    const [tables, customers, employees] = await Promise.all([
      tableIds.length
        ? this.tableModel.find({ _id: { $in: tableIds }, branchId }).exec()
        : Promise.resolve([]),
      customerIds.length
        ? this.customerModel.find({ _id: { $in: customerIds }, branchId }).exec()
        : Promise.resolve([]),
      employeeIds.length
        ? this.employeeModel.find({ _id: { $in: employeeIds }, branchId }).exec()
        : Promise.resolve([]),
    ]);

    const tableNameById = new Map<string, string>();
    tables.forEach((t: any) => tableNameById.set(String(t._id), String(t.name)));
    const customerById = new Map<string, any>();
    customers.forEach((c: any) => customerById.set(String(c._id), c));
    const employeeById = new Map<string, any>();
    employees.forEach((e: any) => employeeById.set(String(e._id), e));
    const userIdSet = new Set<string>(
      employees
        .map((e: any) => String(e.userId || ''))
        .filter((id: string) => Boolean(id))
    );
    const users = userIdSet.size
      ? await this.userModel.find({ _id: { $in: Array.from(userIdSet) } }).exec()
      : [];
    const userById = new Map<string, any>();
    users.forEach((u: any) => userById.set(String(u._id), u));

    return {
      data: data.map((d) => {
        const doc: any = this.withVirtualId(d);
        const customer = doc.customerId ? customerById.get(String(doc.customerId)) : null;
        const employee = doc.employeeId ? employeeById.get(String(doc.employeeId)) : null;
        const user = employee?.userId ? userById.get(String(employee.userId)) : null;
        const employeeName =
          user
            ? `${String(user.firstName || '')} ${String(user.lastName || '')}`.trim()
            : null;
        return this.toSharedOrder(doc, {
          tableName: doc.tableId ? tableNameById.get(String(doc.tableId)) : undefined,
          customerName: customer ? String(customer.fullName || customer.name || '') : undefined,
          customerPhone: customer ? String(customer.phone || '') : undefined,
          employeeName: employeeName || undefined,
        });
      }),
      meta: {
        cursor,
        count,
        hasMore,
        requestId: undefined,
        timestamp: undefined,
      },
    };
  }

  // =========================================================================
  // 4. getOrder
  // =========================================================================

  async getOrder(ctx: AuthContext, id: string): Promise<Order> {
    const branchId = ctx.branchId;
    if (!branchId) {
      throw new BadRequestException('Branch context required');
    }
    const order = await this.orderModel
      .findOne({ _id: id, branchId })
      .exec();
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    const doc: any = this.withVirtualId(order);
    const [table, customer, employee] = await Promise.all([
      doc.tableId ? this.tableModel.findOne({ _id: doc.tableId, branchId }).exec() : null,
      doc.customerId ? this.customerModel.findOne({ _id: doc.customerId, branchId }).exec() : null,
      doc.employeeId ? this.employeeModel.findOne({ _id: doc.employeeId, branchId }).exec() : null,
    ]);
    const user = employee?.userId ? await this.userModel.findById((employee as any).userId).exec() : null;
    const employeeName = user
      ? `${String((user as any).firstName || '')} ${String((user as any).lastName || '')}`.trim()
      : null;
    return this.toSharedOrder(doc, {
      tableName: table ? String((table as any).name || '') : undefined,
      customerName: customer ? String((customer as any).fullName || (customer as any).name || '') : undefined,
      customerPhone: customer ? String((customer as any).phone || '') : undefined,
      employeeName: employeeName || undefined,
    }) as any;
  }

  // =========================================================================
  // 5. addItems
  // =========================================================================

  async addItems(
    ctx: AuthContext,
    orderId: string,
    newItems: OrderItemInput[]
  ): Promise<Order> {
    const branchId = ctx.branchId;
    const restaurantId = ctx.restaurantId;
    if (!branchId || !restaurantId) {
      throw new BadRequestException('Branch and restaurant context required');
    }

    const order = await this.orderModel
      .findOne({ _id: orderId, branchId })
      .exec();
    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }
    if (TERMINAL_STATUSES.has(order.status)) {
      throw new BadRequestException(`Cannot add items to terminal order (status=${order.status})`);
    }

    // Compute the new items (server-side pricing)
    const {
      orderItems: computedNewItems,
      subtotalCents: newItemsSubtotal,
      preparationNeededItems,
    } = await this.computeOrderItems(branchId, restaurantId, newItems);

    // Merge existing + new items
    const mergedItems = [...order.items, ...computedNewItems];

    // Recompute subtotal, discount, tax, totals
    const newSubtotal = order.subtotalCents + newItemsSubtotal;

    // Re-apply discount proportionally (capped at new subtotal)
    let newDiscountCents = order.discountCents;
    if (newDiscountCents > newSubtotal) {
      newDiscountCents = newSubtotal;
    }

    // Recompute taxes on the new taxable amount
    const newTaxable = newSubtotal - newDiscountCents;
    let newTaxCents = 0;
    if (order.taxIds.length > 0) {
      const activeTaxes = await this.taxModel
        .find({ _id: { $in: order.taxIds }, branchId, isActive: true })
        .exec();
      for (const tax of activeTaxes) {
        if (!tax.isIncludedInPrice) {
          newTaxCents += Math.floor((newTaxable * tax.rate) / 100);
        }
      }
    }

    const newTotal = newSubtotal - newDiscountCents + newTaxCents;

    const updated = await this.orderModel
      .findByIdAndUpdate(
        order._id,
        {
          $set: {
            items: mergedItems,
            subtotalCents: newSubtotal,
            discountCents: newDiscountCents,
            taxCents: newTaxCents,
            totalCents: newTotal,
          },
        },
        { new: true }
      )
      .exec();
    if (!updated) throw new NotFoundException('Order disappeared');

    // Also add items to the corresponding KitchenOrder (or create one if missing)
    if (preparationNeededItems.length > 0) {
      const existingKO = await this.kitchenOrderModel
        .findOne({ orderId: updated._id.toString() })
        .exec();

      const newKOItems: KitchenOrderItem[] = preparationNeededItems.map((pi) => ({
        orderItemId: mergedItems.findIndex((_, i) => i >= order.items.length) + '',
        menuItemId: pi.menuItemId,
        name: pi.name,
        quantity: pi.quantity,
        notes: pi.kitchenNotes,
        modifierSummary: pi.modifierSummary,
        status: S.KitchenStatus.NEW,
      } as unknown as KitchenOrderItem));

      if (existingKO && existingKO.status !== S.KitchenStatus.CANCELLED) {
        // Append to existing kitchen order's items
        await this.kitchenOrderModel
          .findByIdAndUpdate(
            existingKO._id,
            {
              $push: { items: { $each: newKOItems } },
              $set: { status: S.KitchenStatus.NEW },
            },
            { new: true }
          )
          .exec();
      } else {
        // Create a new kitchen order for these items
        await this.createKitchenOrderForOrder(updated, preparationNeededItems);
      }
    }

    // If table session exists, update its totals
    if (updated.tableSessionId) {
      const deltaTotal = newTotal - order.totalCents;
      await this.tableSessionModel
        .findByIdAndUpdate(updated.tableSessionId, {
          $inc: { totalAmount: deltaTotal, balanceDue: deltaTotal },
        })
        .exec();
    }

    return this.withVirtualId(updated);
  }

  // =========================================================================
  // 6. removeItem
  // =========================================================================

  async removeItem(
    ctx: AuthContext,
    orderId: string,
    itemIndex: number,
    opts: UpdateOrderStatusOpts = {}
  ): Promise<Order> {
    const branchId = ctx.branchId;
    if (!branchId) {
      throw new BadRequestException('Branch context required');
    }

    const order = await this.orderModel
      .findOne({ _id: orderId, branchId })
      .exec();
    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }
    if (TERMINAL_STATUSES.has(order.status)) {
      throw new BadRequestException(
        `Cannot remove items from terminal order (status=${order.status})`
      );
    }
    if (itemIndex < 0 || itemIndex >= order.items.length) {
      throw new BadRequestException(
        `Invalid item index ${itemIndex} (order has ${order.items.length} items)`
      );
    }

    // If order has any payment made, require manager approval
    const isPaid = PAID_PAYMENT_STATUSES.has(order.paymentStatus);
    if (isPaid) {
      await this.verifyApprovalToken(ctx, opts.approvalToken, {
        action: S.AuditAction.UPDATE,
        entityType: 'ORDER',
        entityId: orderId,
      });
    }

    const removedItem = order.items[itemIndex];
    const newItems = order.items.filter((_, i) => i !== itemIndex);

    // Recompute totals without the removed item
    let newSubtotal = 0;
    for (const it of newItems) newSubtotal += it.subtotalCents;

    let newDiscountCents = order.discountCents;
    if (newDiscountCents > newSubtotal) newDiscountCents = newSubtotal;

    const newTaxable = newSubtotal - newDiscountCents;
    let newTaxCents = 0;
    if (order.taxIds.length > 0) {
      const activeTaxes = await this.taxModel
        .find({ _id: { $in: order.taxIds }, branchId, isActive: true })
        .exec();
      for (const tax of activeTaxes) {
        if (!tax.isIncludedInPrice) {
          newTaxCents += Math.floor((newTaxable * tax.rate) / 100);
        }
      }
    }
    const newTotal = newSubtotal - newDiscountCents + newTaxCents;

    const updated = await this.orderModel
      .findByIdAndUpdate(
        order._id,
        {
          $set: {
            items: newItems,
            subtotalCents: newSubtotal,
            discountCents: newDiscountCents,
            taxCents: newTaxCents,
            totalCents: newTotal,
          },
        },
        { new: true }
      )
      .exec();
    if (!updated) throw new NotFoundException('Order disappeared');

    // Also remove from KitchenOrder if present
    await this.kitchenOrderModel
      .updateOne(
        { orderId: updated._id.toString() },
        {
          $pull: { items: { menuItemId: removedItem.menuItemId } },
        }
      )
      .exec();

    // Update table session totals if applicable
    if (updated.tableSessionId) {
      const deltaTotal = newTotal - order.totalCents;
      await this.tableSessionModel
        .findByIdAndUpdate(updated.tableSessionId, {
          $inc: { totalAmount: deltaTotal, balanceDue: deltaTotal },
        })
        .exec();
    }

    return this.withVirtualId(updated);
  }

  // =========================================================================
  // 7. holdOrder / retrieveOrder
  // =========================================================================

  async holdOrder(ctx: AuthContext, orderId: string): Promise<Order> {
    const branchId = ctx.branchId;
    if (!branchId) {
      throw new BadRequestException('Branch context required');
    }
    const order = await this.orderModel
      .findOne({ _id: orderId, branchId })
      .exec();
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    if (TERMINAL_STATUSES.has(order.status)) {
      throw new BadRequestException(`Cannot hold terminal order (status=${order.status})`);
    }

    const updated = await this.orderModel
      .findByIdAndUpdate(
        order._id,
        {
          $set: {
            heldBy: ctx.employeeId ?? undefined,
            heldAt: new Date(),
          },
        },
        { new: true }
      )
      .exec();
    if (!updated) throw new NotFoundException('Order disappeared');
    return this.withVirtualId(updated);
  }

  async retrieveOrder(ctx: AuthContext, orderId: string): Promise<Order> {
    const branchId = ctx.branchId;
    if (!branchId) {
      throw new BadRequestException('Branch context required');
    }
    const order = await this.orderModel
      .findOne({ _id: orderId, branchId })
      .exec();
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);

    const updated = await this.orderModel
      .findByIdAndUpdate(
        order._id,
        {
          $set: {
            heldBy: undefined,
            heldAt: undefined,
          },
        },
        { new: true }
      )
      .exec();
    if (!updated) throw new NotFoundException('Order disappeared');
    return this.withVirtualId(updated);
  }

  // =========================================================================
  // 8. refundOrder
  // =========================================================================

  async refundOrder(
    ctx: AuthContext,
    orderId: string,
    amountCents?: number,
    reason?: string,
    approvalToken?: string
  ): Promise<Order> {
    const branchId = ctx.branchId;
    if (!branchId) {
      throw new BadRequestException('Branch context required');
    }
    const order = await this.orderModel
      .findOne({ _id: orderId, branchId })
      .exec();
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);

    // Approval is always required for refunds
    await this.verifyApprovalToken(ctx, approvalToken, {
      action: S.AuditAction.REFUND,
      entityType: 'ORDER',
      entityId: orderId,
    });

    // Only COMPLETED orders can be refunded (others go via cancel/void)
    if (order.status !== S.OrderStatus.COMPLETED) {
      throw new BadRequestException(
        `Only COMPLETED orders can be refunded (status=${order.status}). Use cancel/void instead.`
      );
    }

    const refundAmount = amountCents ?? order.totalCents;
    if (refundAmount <= 0) {
      throw new BadRequestException('Refund amount must be positive');
    }
    if (refundAmount > order.totalCents) {
      throw new BadRequestException(
        `Refund amount ${refundAmount} exceeds order total ${order.totalCents}`
      );
    }

    // Mark as REFUNDED (or PARTIALLY_REFUNDED semantics via paymentStatus)
    const isFullRefund = refundAmount >= order.totalCents;
    const updateFields: Record<string, unknown> = {
      refundReason: reason,
    };
    if (isFullRefund) {
      updateFields.status = S.OrderStatus.REFUNDED;
    }

    const updated = await this.orderModel
      .findByIdAndUpdate(order._id, { $set: updateFields }, { new: true })
      .exec();
    if (!updated) throw new NotFoundException('Order disappeared');

    // Reverse loyalty points for full refund
    if (isFullRefund) {
      await this.reverseLoyaltyForOrder(ctx, updated);
    }

    return this.withVirtualId(updated);
  }

  // =========================================================================
  // 9. voidOrder
  // =========================================================================

  async voidOrder(
    ctx: AuthContext,
    orderId: string,
    reason?: string,
    approvalToken?: string
  ): Promise<Order> {
    const branchId = ctx.branchId;
    if (!branchId) {
      throw new BadRequestException('Branch context required');
    }
    const order = await this.orderModel
      .findOne({ _id: orderId, branchId })
      .exec();
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);

    if (TERMINAL_STATUSES.has(order.status)) {
      throw new BadRequestException(`Order is already terminal (status=${order.status})`);
    }

    // Approval always required for void
    await this.verifyApprovalToken(ctx, approvalToken, {
      action: S.AuditAction.VOID,
      entityType: 'ORDER',
      entityId: orderId,
    });

    // Void should only be allowed within 1 day of creation (per docs)
    const createdAt = (order as unknown as { createdAt: Date }).createdAt;
    const oneDayMs = 24 * 60 * 60 * 1000;
    if (Date.now() - createdAt.getTime() > oneDayMs) {
      throw new BadRequestException(
        'Orders can only be voided within 24 hours of creation. Use refund instead.'
      );
    }

    const updated = await this.orderModel
      .findByIdAndUpdate(
        order._id,
        {
          $set: {
            status: S.OrderStatus.VOIDED,
            voidedAt: new Date(),
            voidReason: reason,
          },
        },
        { new: true }
      )
      .exec();
    if (!updated) throw new NotFoundException('Order disappeared');

    // Cancel the kitchen order too
    await this.kitchenOrderModel
      .updateOne(
        { orderId: order._id.toString() },
        { $set: { status: S.KitchenStatus.CANCELLED } }
      )
      .exec();

    return this.withVirtualId(updated);
  }

  // =========================================================================
  // Internal helpers
  // =========================================================================

  /**
   * Validates order items against the current DB state and computes
   * server-side totals (never trusts client totals).
   */
  private async computeOrderItems(
    branchId: string,
    restaurantId: string,
    items: OrderItemInput[]
  ): Promise<{
    orderItems: OrderItem[];
    subtotalCents: number;
    preparationNeededItems: Array<{
      menuItemId: string;
      name: string;
      quantity: number;
      kitchenNotes?: string;
      modifierSummary?: string;
    }>;
  }> {
    if (!items || items.length === 0) {
      throw new BadRequestException('Order must contain at least one item');
    }

    const orderItems: OrderItem[] = [];
    let subtotalCents = 0;
    const preparationNeededItems: Array<{
      menuItemId: string;
      name: string;
      quantity: number;
      kitchenNotes?: string;
      modifierSummary?: string;
    }> = [];

    for (const input of items) {
      // Validate quantity
      if (!input.quantity || input.quantity < 1) {
        throw new BadRequestException('Item quantity must be >= 1');
      }

      // Resolve current menu item + price from DB (NEVER trust client price)
      const menuItem = await this.menuItemModel
        .findOne({ _id: input.menuItemId, branchId })
        .exec();
      if (!menuItem) {
        throw new NotFoundException(`MenuItem ${input.menuItemId} not found in branch`);
      }
      if (menuItem.status !== S.MenuItemStatus.AVAILABLE) {
        throw new BadRequestException(
          `MenuItem ${menuItem.name} is not available (status=${menuItem.status})`
        );
      }

      const unitPriceCents = menuItem.price;

      // Resolve modifier options + apply price deltas
      const resolvedModifiers: OrderItemModifierOption[] = [];
      let modifierDeltaTotal = 0;
      const modifierNames: string[] = [];

      if (input.modifierOptions && input.modifierOptions.length > 0) {
        for (const modInput of input.modifierOptions) {
          const modifier = await this.menuModifierModel
            .findOne({ _id: modInput.modifierId, branchId })
            .exec();
          if (!modifier) {
            throw new NotFoundException(`Modifier ${modInput.modifierId} not found`);
          }
          for (const optionId of modInput.optionIds) {
            const option = modifier.options.find((o) => o.id === optionId);
            if (!option) {
              throw new BadRequestException(
                `Option ${optionId} not found on modifier ${modifier.name}`
              );
            }
            resolvedModifiers.push({
              modifierId: modInput.modifierId,
              optionId,
              name: option.name,
              priceDeltaCents: option.priceDelta,
            } as unknown as OrderItemModifierOption);
            modifierDeltaTotal += option.priceDelta;
            modifierNames.push(option.name);
          }
        }
      }

      const lineSubtotal = (unitPriceCents + modifierDeltaTotal) * input.quantity;
      const lineTotal = lineSubtotal; // discount/tax applied at order level
      subtotalCents += lineSubtotal;

      // Mark for kitchen — everything except certain categories (we default to all needing prep)
      preparationNeededItems.push({
        menuItemId: menuItem._id.toString(),
        name: menuItem.name,
        quantity: input.quantity,
        kitchenNotes: input.kitchenNotes,
        modifierSummary: modifierNames.length > 0 ? modifierNames.join(', ') : undefined,
      });

      orderItems.push({
        menuItemId: menuItem._id.toString(),
        menuItemName: menuItem.name,
        menuItemSnapshot: menuItem.toObject() as unknown as Record<string, unknown>,
        quantity: input.quantity,
        unitPriceCents,
        subtotalCents: lineSubtotal,
        modifierOptions: resolvedModifiers,
        discountCents: 0,
        taxCents: 0,
        totalCents: lineTotal,
        notes: input.notes,
        isVoided: false,
        preparationStatus: S.KitchenStatus.NEW,
      } as unknown as OrderItem);
    }

    return { orderItems, subtotalCents, preparationNeededItems };
  }

  /**
   * Generates the next order number with format: YYYYMMDD-NNNNN per branch.
   */
  private async generateOrderNumber(branchId: string): Promise<string> {
    const today = new Date();
    const datePrefix = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(
      2,
      '0'
    )}${String(today.getDate()).padStart(2, '0')}`;
    const prefixRegex = `^${datePrefix}-`;

    const lastOrder = await this.orderModel
      .findOne({
        branchId,
        orderNumber: { $regex: prefixRegex },
      })
      .sort({ orderNumber: -1 })
      .exec();

    let nextSeq = 1;
    if (lastOrder) {
      const parts = lastOrder.orderNumber.split('-');
      const seq = parseInt(parts[1] || '0', 10);
      nextSeq = seq + 1;
    }
    return `${datePrefix}-${String(nextSeq).padStart(5, '0')}`;
  }

  /**
   * Creates a KitchenOrder for an order. Filters items that need preparation.
   * Station is inferred from item categoryId.
   */
  private async createKitchenOrderForOrder(
    order: Order,
    items: Array<{
      menuItemId: string;
      name: string;
      quantity: number;
      kitchenNotes?: string;
      modifierSummary?: string;
    }>
  ): Promise<KitchenOrder> {
    const koItems: KitchenOrderItem[] = items.map((it, idx) => ({
      orderItemId: `item-${idx}`,
      menuItemId: it.menuItemId,
      name: it.name,
      quantity: it.quantity,
      notes: it.kitchenNotes,
      modifierSummary: it.modifierSummary,
      status: S.KitchenStatus.NEW,
    } as unknown as KitchenOrderItem));

    // Infer station from first item's category (simple heuristic for phase 1)
    const firstItem = await this.menuItemModel.findById(items[0].menuItemId).exec();
    const station = firstItem?.categoryId ? `cat-${firstItem.categoryId}` : undefined;

    return this.kitchenOrderModel.create({
      restaurantId: order.restaurantId,
      branchId: order.branchId,
      orderId: order._id.toString(),
      orderNumber: order.orderNumber,
      tableId: order.tableId,
      priority: 'NORMAL',
      status: S.KitchenStatus.NEW,
      station,
      items: koItems,
      orderPlacedAt: new Date(),
      orderItemIds: koItems.map((k) => k.orderItemId),
    });
  }

  /**
   * Validates status transition per the state machine rules in docs/09-state-machines.md.
   */
  private validateStatusTransition(from: S.OrderStatus, to: S.OrderStatus): void {
    const allowed: Partial<Record<S.OrderStatus, S.OrderStatus[]>> = {
      [S.OrderStatus.PENDING]: [
        S.OrderStatus.AWAITING_PAYMENT,
        S.OrderStatus.RECEIVED,
        S.OrderStatus.CANCELLED,
        S.OrderStatus.VOIDED,
      ],
      [S.OrderStatus.AWAITING_PAYMENT]: [
        // Per docs/09-state-machines.md: verified online payment → RECEIVED
        S.OrderStatus.RECEIVED,
        S.OrderStatus.CANCELLED,
      ],
      [S.OrderStatus.RECEIVED]: [
        S.OrderStatus.ACCEPTED,
        S.OrderStatus.CANCELLED,
        S.OrderStatus.ON_HOLD,
        S.OrderStatus.VOIDED,
      ],
      [S.OrderStatus.ACCEPTED]: [
        S.OrderStatus.PREPARING,
        S.OrderStatus.CANCELLED,
        S.OrderStatus.ON_HOLD,
        S.OrderStatus.VOIDED,
      ],
      [S.OrderStatus.PREPARING]: [
        S.OrderStatus.READY,
        S.OrderStatus.CANCELLED,
        S.OrderStatus.VOIDED,
      ],
      [S.OrderStatus.READY]: [
        S.OrderStatus.SERVED,
        S.OrderStatus.COMPLETED,
        S.OrderStatus.CANCELLED,
        S.OrderStatus.VOIDED,
      ],
      [S.OrderStatus.SERVED]: [
        S.OrderStatus.COMPLETED,
        S.OrderStatus.CANCELLED,
        S.OrderStatus.VOIDED,
      ],
      [S.OrderStatus.ON_HOLD]: [S.OrderStatus.RECEIVED, S.OrderStatus.CANCELLED],
      // Allow COMPLETED to go to REFUNDED (full-refund path per state machine)
      [S.OrderStatus.COMPLETED]: [S.OrderStatus.REFUNDED],
    };

    const allowedTargets = allowed[from];
    if (!allowedTargets || !allowedTargets.includes(to)) {
      throw new BadRequestException(
        `Invalid status transition: ${from} → ${to}. Check docs/09-state-machines.md for allowed transitions.`
      );
    }
  }

  /**
   * Verifies the short-lived manager approval JWT for sensitive actions.
   */
  private async verifyApprovalToken(
    ctx: AuthContext,
    approvalToken: string | undefined,
    expectedScope: {
      action: S.AuditAction;
      entityType: string;
      entityId: string;
    }
  ): Promise<void> {
    if (!approvalToken) {
      throw new UnauthorizedException(
        `Manager approval token required for ${expectedScope.action} on ${expectedScope.entityType}`
      );
    }
    try {
      const decoded = (await this.jwtService.verifyAsync(approvalToken, {
        secret: process.env.JWT_ACCESS_SECRET,
        issuer: process.env.JWT_ISSUER,
        audience: process.env.JWT_AUDIENCE,
      })) as {
        tokenType: string;
        approverId: string;
        approverRole: S.Role;
        scope: {
          action: S.AuditAction;
          entityType: string;
          entityId: string;
        };
      };

      if (decoded.tokenType !== 'approval') {
        throw new ForbiddenException('Token is not an approval token');
      }
      if (!decoded.scope) {
        throw new ForbiddenException('Approval token missing scope');
      }
      if (decoded.scope.action !== expectedScope.action) {
        throw new ForbiddenException(
          `Approval scope action mismatch: expected ${expectedScope.action}, got ${decoded.scope.action}`
        );
      }
      if (decoded.scope.entityType !== expectedScope.entityType) {
        throw new ForbiddenException(
          `Approval scope entityType mismatch: expected ${expectedScope.entityType}`
        );
      }
      if (decoded.scope.entityId !== expectedScope.entityId) {
        throw new ForbiddenException(
          `Approval scope entityId mismatch: expected ${expectedScope.entityId}`
        );
      }

      // Approver must have a manager-level role
      const managerRoles = new Set([
        S.Role.MANAGER,
        S.Role.SUPERVISOR,
        S.Role.ADMIN,
        S.Role.SUPER_ADMIN,
      ]);
      if (!managerRoles.has(decoded.approverRole)) {
        throw new ForbiddenException(
          `Approver role ${decoded.approverRole} does not have approval authority`
        );
      }
    } catch (e) {
      if (e instanceof ForbiddenException || e instanceof UnauthorizedException) {
        throw e;
      }
      this.logger.warn(`Approval token verification failed: ${(e as Error).message}`);
      throw new ForbiddenException('Invalid or expired approval token');
    }
  }

  /**
   * Recipe-based inventory deduction when order hits COMPLETED.
   * Creates InventoryTransaction rows with type=RECIPE_DEDUCTION.
   */
  private async deductInventoryForOrder(ctx: AuthContext, order: Order): Promise<void> {
    try {
      for (const item of order.items) {
        if (item.isVoided) continue;

        // Look up recipe for this menu item
        const recipe = await this.recipeModel
          .findOne({
            menuItemId: item.menuItemId,
            branchId: order.branchId,
          })
          .exec();

        if (!recipe) {
          this.logger.log(
            `No recipe found for menuItem ${item.menuItemId} — skipping inventory deduction`
          );
          continue;
        }

        // portionMultiplier: how many ingredients per serving relative to recipe servings
        const portionMultiplier = item.quantity / Math.max(1, recipe.servings);

        for (const ingredient of recipe.ingredients) {
          const qtyChange = -1 * portionMultiplier * ingredient.quantity;

          // 1. Create the transaction record
          // Note: S.InventoryTransactionType does not have RECIPE_DEDUCTION,
          // so we use SALE_DEDUCTION for the type enum and set referenceType
          // to 'RECIPE_DEDUCTION' (which is supported by the schema's referenceType enum).
          await this.inventoryTxModel.create({
            restaurantId: order.restaurantId,
            branchId: order.branchId,
            inventoryItemId: ingredient.inventoryItemId,
            type: S.InventoryTransactionType.SALE_DEDUCTION,
            quantityChange: qtyChange,
            unitCostCentsAtTime: ingredient.costAtRecipeTime,
            referenceType: 'RECIPE_DEDUCTION' as any,
            referenceId: order._id.toString(),
            reason: `Order ${order.orderNumber}: ${item.menuItemName} x${item.quantity}`,
            performedById: ctx.employeeId ?? undefined,
            performedAt: new Date(),
          });

          // 2. Deduct from inventory item current stock
          await this.inventoryItemModel
            .findByIdAndUpdate(ingredient.inventoryItemId, {
              $inc: { currentStockLevel: qtyChange },
            })
            .exec();
        }
      }
    } catch (e) {
      this.logger.error(
        `Inventory deduction failed for order ${order._id}: ${(e as Error).message}`
      );
      // Don't block order completion for inventory errors — log and continue
    }
  }

  /**
   * Accrue loyalty points when order is COMPLETED and customer is attached.
   * Default rule: 1 point per 100 cents (1 dollar) spent; tier multipliers TBD.
   */
  private async accrueLoyaltyForOrder(ctx: AuthContext, order: Order): Promise<void> {
    try {
      if (!order.customerId) return;

      const account = await this.loyaltyAccountModel
        .findOne({
          restaurantId: order.restaurantId,
          customerId: order.customerId,
        })
        .exec();

      if (!account || !account.isActive) return;

      const basePoints = Math.floor(order.totalCents / 100);
      const tierMultiplier = this.getLoyaltyTierMultiplier(account.programTier);
      const earned = Math.max(0, Math.floor(basePoints * tierMultiplier));

      await this.loyaltyAccountModel
        .findByIdAndUpdate(account._id, {
          $inc: {
            pointsBalance: earned,
            totalPointsEarned: earned,
          },
          $set: { lastActivityAt: new Date() },
        })
        .exec();

      // Also update the customer's total visits and total spent
      await this.customerModel
        .findByIdAndUpdate(order.customerId, {
          $inc: { totalVisits: 1, totalSpent: order.totalCents },
          $set: { lastVisitAt: new Date() },
        })
        .exec();

      this.logger.log(
        `Loyalty: accrued ${earned} points for customer ${order.customerId} (order ${order._id})`
      );
    } catch (e) {
      this.logger.error(
        `Loyalty accrual failed for order ${order._id}: ${(e as Error).message}`
      );
    }
  }

  /** Reverse loyalty points on full refund. */
  private async reverseLoyaltyForOrder(ctx: AuthContext, order: Order): Promise<void> {
    try {
      if (!order.customerId) return;

      const account = await this.loyaltyAccountModel
        .findOne({
          restaurantId: order.restaurantId,
          customerId: order.customerId,
        })
        .exec();
      if (!account) return;

      const basePoints = Math.floor(order.totalCents / 100);
      const tierMultiplier = this.getLoyaltyTierMultiplier(account.programTier);
      const toDeduct = Math.max(0, Math.floor(basePoints * tierMultiplier));

      const newBalance = Math.max(0, account.pointsBalance - toDeduct);

      await this.loyaltyAccountModel
        .findByIdAndUpdate(account._id, {
          $set: {
            pointsBalance: newBalance,
            lastActivityAt: new Date(),
          },
          $inc: { totalPointsRedeemed: toDeduct },
        })
        .exec();
    } catch (e) {
      this.logger.error(
        `Loyalty reversal failed for order ${order._id}: ${(e as Error).message}`
      );
    }
  }

  private getLoyaltyTierMultiplier(tier?: string): number {
    switch (tier) {
      case 'PLATINUM':
        return 2.0;
      case 'GOLD':
        return 1.5;
      case 'SILVER':
        return 1.25;
      case 'BRONZE':
      default:
        return 1.0;
    }
  }

  /**
   * Attaches a virtual 'id' field (stringified _id) to a document
   * to match the S.Order interface contract.
   */
  private withVirtualId<T extends Order>(doc: T): T {
    // Cast through unknown to allow adding 'id'
    const result = doc as unknown as T & { id: string };
    if (!result.id) {
      result.id = result._id.toString();
    }
    return result;
  }

  private toSharedOrder(
    doc: any,
    enrich: { tableName?: string; customerName?: string; customerPhone?: string; employeeName?: string } = {}
  ): S.Order {
    const createdAt = doc.createdAt instanceof Date ? doc.createdAt : new Date(doc.createdAt);
    const updatedAt = doc.updatedAt instanceof Date ? doc.updatedAt : new Date(doc.updatedAt);

    const items: S.OrderItem[] = (doc.items || []).map((it: any, index: number) => {
      const selectedModifiers: S.SelectedModifier[] = Array.isArray(it.modifierOptions)
        ? it.modifierOptions.map((m: any) => ({
            modifierId: String(m.modifierId),
            name: String(m.name || ''),
            optionIds: [String(m.optionId)],
            optionNames: [String(m.name || '')],
            totalPriceDelta: Number(m.priceDeltaCents || 0),
          }))
        : [];

      return {
        id: `${String(doc.id)}:${index}`,
        orderId: String(doc.id),
        menuItemId: String(it.menuItemId),
        name: String(it.menuItemName),
        unitPrice: Number(it.unitPriceCents || 0),
        quantity: Number(it.quantity || 0),
        selectedModifiers,
        specialInstructions: it.notes ? String(it.notes) : undefined,
        subtotal: Number(it.subtotalCents || 0),
        discountAmount: Number(it.discountCents || 0),
        taxAmount: Number(it.taxCents || 0),
        totalAmount: Number(it.totalCents || 0),
        kitchenStatus: (it.preparationStatus || S.KitchenStatus.NEW) as any,
        createdAt,
        updatedAt,
      };
    });

    const totalCents = Number(doc.totalCents || 0);

    // paidAmount: prefer denormalized cents fields written by sync reconciliation,
    // then fall back to binary legacy rule (PAID→full, else 0). The denormalized
    // fields correctly reflect PARTIAL payments and split-tender scenarios.
    const denormalizedPaid =
      Number(doc.paidAmountCents ?? doc.paidAmount ?? doc.paidCents) || 0;
    const denormalizedBalance =
      Number(doc.balanceDueCents ?? doc.balanceDue ?? doc.balanceCents) || 0;
    let paidAmount: number;
    let balanceDue: number;
    if (denormalizedPaid > 0) {
      paidAmount = denormalizedPaid;
      balanceDue = denormalizedBalance > 0 ? denormalizedBalance : Math.max(0, totalCents - paidAmount);
    } else if (
      doc.paymentStatus === S.PaymentStatus.PAID ||
      doc.paymentStatus === 'COMPLETED'
    ) {
      paidAmount = totalCents;
      balanceDue = 0;
    } else {
      paidAmount = 0;
      balanceDue = totalCents;
    }

    return {
      id: String(doc.id),
      restaurantId: String(doc.restaurantId),
      branchId: String(doc.branchId),
      orderNumber: String(doc.orderNumber),
      orderType: doc.type as any,
      status: doc.status as any,
      customerId: doc.customerId ? String(doc.customerId) : undefined,
      customerName: enrich.customerName || undefined,
      customerPhone: enrich.customerPhone || undefined,
      tableId: doc.tableId ? String(doc.tableId) : undefined,
      tableSessionId: doc.tableSessionId ? String(doc.tableSessionId) : undefined,
      tableName: enrich.tableName || undefined,
      employeeId: doc.employeeId ? String(doc.employeeId) : undefined,
      employeeName: enrich.employeeName || undefined,
      sourceChannel: doc.source as any,
      items,
      subtotal: Number(doc.subtotalCents || 0),
      discountAmount: Number(doc.discountCents || 0),
      discountId: doc.discountId ? String(doc.discountId) : undefined,
      taxAmount: Number(doc.taxCents || 0),
      totalAmount: totalCents,
      paidAmount,
      balanceDue: Math.max(0, balanceDue),
      notes: doc.notes ? String(doc.notes) : undefined,
      paymentStatus: doc.paymentStatus as any,
      acceptedAt: doc.acceptedAt ? new Date(doc.acceptedAt) : undefined,
      startedPreparingAt: doc.startedPreparingAt ? new Date(doc.startedPreparingAt) : undefined,
      readyAt: doc.readyAt ? new Date(doc.readyAt) : undefined,
      servedAt: doc.servedAt ? new Date(doc.servedAt) : undefined,
      completedAt: doc.completedAt ? new Date(doc.completedAt) : undefined,
      cancelledAt: doc.cancelledAt ? new Date(doc.cancelledAt) : undefined,
      cancelledBy: doc.cancelledBy ? String(doc.cancelledBy) : undefined,
      cancelReason: doc.cancelReason ? String(doc.cancelReason) : undefined,
      voidedAt: doc.voidedAt ? new Date(doc.voidedAt) : undefined,
      voidedBy: doc.voidedBy ? String(doc.voidedBy) : undefined,
      voidReason: doc.voidReason ? String(doc.voidReason) : undefined,
      heldAt: doc.heldAt ? new Date(doc.heldAt) : undefined,
      onHoldReason: doc.onHoldReason ? String(doc.onHoldReason) : undefined,
      createdAt,
      updatedAt,
    };
  }
}
