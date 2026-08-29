import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Supplier } from './schemas/supplier.schema';
import { PurchaseOrder, PurchaseOrderItem } from './schemas/purchase-order.schema';
import { InventoryItem } from '../inventory/schemas/inventory-item.schema';
import { InventoryService } from '../inventory/inventory.service';
import * as S from '@prolific/shared-types';
import type { AuthContext } from '../common/decorators/current-user.decorator';

export interface ListSuppliersFilters {
  q?: string;
  isActive?: boolean;
  cursor?: string;
  limit?: number;
}

export interface CreateSupplierInput {
  name: string;
  contactName?: string;
  email?: string;
  phone: string;
  address?: string;
  city?: string;
  country?: string;
  taxId?: string;
  paymentTerms?: string;
  creditLimitCents?: number;
  notes?: string;
  isActive?: boolean;
}

export interface UpdateSupplierInput extends Partial<CreateSupplierInput> {}

export interface CreatePurchaseOrderInput {
  supplierId: string;
  expectedDeliveryDate?: Date;
  notes?: string;
  items: Array<{
    inventoryItemId: string;
    quantityOrdered: number;
    unitCostCents: number;
  }>;
}

export interface ReceivePurchaseOrderInput {
  items?: Array<{
    inventoryItemId: string;
    quantityReceived: number;
  }>;
  notes?: string;
}

export interface ListPurchaseOrdersFilters {
  supplierId?: string;
  status?: S.PurchaseOrderStatus[];
  q?: string;
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

function withVirtualId<T extends { _id?: any; id?: string }>(doc: any): any {
  if (!doc) return doc;
  const obj = doc.toObject ? doc.toObject() : doc;
  return { ...obj, id: obj.id || obj._id?.toString?.() || String(obj._id) };
}

function toSharedSupplier(doc: any, fallbackBranchId: string): S.Supplier {
  const s = withVirtualId(doc);
  return {
    id: s.id,
    restaurantId: String(s.restaurantId),
    branchId: String(s.branchId ?? fallbackBranchId),
    name: String(s.name),
    contactName: s.contactName ? String(s.contactName) : undefined,
    phone: String(s.phone),
    email: s.email ? String(s.email) : undefined,
    address: s.address ? String(s.address) : undefined,
    isActive: Boolean(s.isActive),
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

function toSharedPurchaseOrder(doc: any): S.PurchaseOrder {
  const po = withVirtualId(doc);
  return {
    id: po.id,
    restaurantId: String(po.restaurantId),
    branchId: String(po.branchId),
    supplierId: String(po.supplierId),
    orderNumber: String(po.poNumber ?? ''),
    status: po.status as S.PurchaseOrderStatus,
    items: (po.items ?? []).map((it: any) => ({
      inventoryItemId: String(it.inventoryItemId),
      quantity: Number(it.quantityOrdered ?? 0),
      unitCost: Number(it.unitCostCents ?? 0),
      receivedQuantity: Number(it.quantityReceived ?? 0),
    })),
    subtotal: Number(po.subtotalCents ?? 0),
    taxAmount: Number(po.taxCents ?? 0),
    totalAmount: Number(po.totalCents ?? 0),
    expectedDate: po.expectedDeliveryDate ?? undefined,
    notes: po.notes ?? undefined,
    createdBy: String(po.orderedById ?? po.createdById ?? ''),
    approvedBy: po.approvedById ? String(po.approvedById) : undefined,
    receivedBy: po.receivedById ? String(po.receivedById) : undefined,
    receivedAt: po.receivedAt ?? undefined,
    createdAt: po.createdAt,
    updatedAt: po.updatedAt,
  };
}

function generatePoNumber(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `PO-${yyyy}${mm}${dd}-${rand}`;
}

@Injectable()
export class SuppliersService {
  constructor(
    @InjectModel(Supplier.name)
    private readonly supplierModel: Model<Supplier>,
    @InjectModel(PurchaseOrder.name)
    private readonly purchaseOrderModel: Model<PurchaseOrder>,
    @InjectModel(InventoryItem.name)
    private readonly inventoryItemModel: Model<InventoryItem>,
    private readonly inventoryService: InventoryService
  ) {}

  async listSuppliers(
    ctx: AuthContext,
    filters: ListSuppliersFilters = {}
  ): Promise<PaginatedResult<S.Supplier>> {
    const branchId = ctx.branchId;
    const restaurantId = ctx.restaurantId;
    if (!branchId || !restaurantId) {
      throw new BadRequestException('Branch and restaurant context required');
    }

    const limit = Math.min(filters.limit ?? 50, 100);
    const query: Record<string, unknown> = {
      restaurantId,
      $or: [{ branchId }, { branchId: null }, { branchId: { $exists: false } }],
    };

    if (filters.isActive !== undefined) query.isActive = filters.isActive;
    if (filters.q) {
      (query as any).$and = [
        {
          $or: [
            { name: { $regex: filters.q, $options: 'i' } },
            { email: { $regex: filters.q, $options: 'i' } },
            { phone: { $regex: filters.q, $options: 'i' } },
          ],
        },
      ];
    }

    if (filters.cursor) {
      try {
        const decoded = Buffer.from(filters.cursor, 'base64').toString('utf-8');
        const parsed = JSON.parse(decoded);
        if (parsed._id) {
          query._id = { $lt: new Types.ObjectId(parsed._id) };
        }
      } catch (_e) {
        throw new BadRequestException('Invalid cursor');
      }
    }

    const docs = await this.supplierModel
      .find(query)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .exec();

    const hasMore = docs.length > limit;
    const data = docs.slice(0, limit);
    const count = data.length;

    let cursor: string | null = null;
    if (hasMore && data.length > 0) {
      const last = data[data.length - 1];
      cursor = Buffer.from(JSON.stringify({ _id: String(last._id) })).toString(
        'base64'
      );
    }

    return {
      data: data.map((d) => toSharedSupplier(d, branchId)),
      meta: { cursor, count, hasMore },
    };
  }

  async createSupplier(
    ctx: AuthContext,
    input: CreateSupplierInput
  ): Promise<S.Supplier> {
    const branchId = ctx.branchId;
    const restaurantId = ctx.restaurantId;
    if (!branchId || !restaurantId) {
      throw new BadRequestException('Branch and restaurant context required');
    }
    if (!input.name || input.name.trim().length === 0) {
      throw new BadRequestException('Supplier name is required');
    }
    if (!input.phone || input.phone.trim().length === 0) {
      throw new BadRequestException('Supplier phone is required');
    }

    const doc = await this.supplierModel.create({
      restaurantId,
      branchId,
      name: input.name,
      contactName: input.contactName,
      email: input.email,
      phone: input.phone,
      address: input.address,
      city: input.city,
      country: input.country,
      taxId: input.taxId,
      paymentTerms: input.paymentTerms,
      creditLimitCents: input.creditLimitCents,
      notes: input.notes,
      isActive: input.isActive ?? true,
    });

    return toSharedSupplier(doc, branchId);
  }

  async updateSupplier(
    ctx: AuthContext,
    id: string,
    input: UpdateSupplierInput
  ): Promise<S.Supplier> {
    const branchId = ctx.branchId;
    const restaurantId = ctx.restaurantId;
    if (!branchId || !restaurantId) {
      throw new BadRequestException('Branch and restaurant context required');
    }

    const doc = await this.supplierModel
      .findOne({ _id: id, restaurantId, $or: [{ branchId }, { branchId: null }, { branchId: { $exists: false } }] })
      .exec();
    if (!doc) throw new NotFoundException(`Supplier ${id} not found`);

    const updated = await this.supplierModel
      .findByIdAndUpdate(doc._id, { $set: input }, { new: true })
      .exec();
    if (!updated) throw new NotFoundException('Supplier disappeared');

    return toSharedSupplier(updated, branchId);
  }

  async listPurchaseOrders(
    ctx: AuthContext,
    filters: ListPurchaseOrdersFilters = {}
  ): Promise<PaginatedResult<S.PurchaseOrder>> {
    const branchId = ctx.branchId;
    const restaurantId = ctx.restaurantId;
    if (!branchId || !restaurantId) {
      throw new BadRequestException('Branch and restaurant context required');
    }

    const limit = Math.min(filters.limit ?? 50, 100);
    const query: Record<string, unknown> = { branchId, restaurantId };

    if (filters.supplierId) query.supplierId = filters.supplierId;
    if (filters.status && filters.status.length > 0) {
      query.status = { $in: filters.status };
    }
    if (filters.q) {
      (query as any).$or = [
        { poNumber: { $regex: filters.q, $options: 'i' } },
        { notes: { $regex: filters.q, $options: 'i' } },
      ];
    }

    if (filters.cursor) {
      try {
        const decoded = Buffer.from(filters.cursor, 'base64').toString('utf-8');
        const parsed = JSON.parse(decoded);
        if (parsed._id) {
          query._id = { $lt: new Types.ObjectId(parsed._id) };
        }
      } catch (_e) {
        throw new BadRequestException('Invalid cursor');
      }
    }

    const docs = await this.purchaseOrderModel
      .find(query)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .exec();

    const hasMore = docs.length > limit;
    const data = docs.slice(0, limit);
    const count = data.length;

    let cursor: string | null = null;
    if (hasMore && data.length > 0) {
      const last = data[data.length - 1];
      cursor = Buffer.from(JSON.stringify({ _id: String(last._id) })).toString(
        'base64'
      );
    }

    return {
      data: data.map((d) => toSharedPurchaseOrder(d)),
      meta: { cursor, count, hasMore },
    };
  }

  async createPurchaseOrder(
    ctx: AuthContext,
    input: CreatePurchaseOrderInput
  ): Promise<S.PurchaseOrder> {
    const branchId = ctx.branchId;
    const restaurantId = ctx.restaurantId;
    if (!branchId || !restaurantId) {
      throw new BadRequestException('Branch and restaurant context required');
    }
    if (!input.supplierId) {
      throw new BadRequestException('supplierId is required');
    }
    if (!input.items || input.items.length === 0) {
      throw new BadRequestException('At least one item is required');
    }

    const invIds = Array.from(new Set(input.items.map((i) => i.inventoryItemId)));
    const inventoryItems = await this.inventoryItemModel
      .find({ _id: { $in: invIds }, branchId })
      .exec();
    const invById = new Map<string, any>();
    inventoryItems.forEach((it: any) => invById.set(String(it._id), it));

    const items: PurchaseOrderItem[] = input.items.map((i) => {
      if (!i.inventoryItemId) {
        throw new BadRequestException('inventoryItemId is required');
      }
      if (!i.quantityOrdered || i.quantityOrdered <= 0) {
        throw new BadRequestException('quantityOrdered must be > 0');
      }
      if (i.unitCostCents === undefined || i.unitCostCents < 0) {
        throw new BadRequestException('unitCostCents must be >= 0');
      }

      const inv = invById.get(String(i.inventoryItemId));
      if (!inv) {
        throw new BadRequestException(
          `InventoryItem ${i.inventoryItemId} not found in this branch`
        );
      }

      const subtotalCents = i.quantityOrdered * i.unitCostCents;
      return {
        inventoryItemId: String(i.inventoryItemId),
        name: String(inv.name),
        unit: inv.unit,
        quantityOrdered: i.quantityOrdered,
        unitCostCents: i.unitCostCents,
        quantityReceived: 0,
        subtotalCents,
      } as any;
    });

    const subtotalCents = items.reduce((acc, it: any) => acc + (it.subtotalCents ?? 0), 0);
    const taxCents = 0;
    const discountCents = 0;
    const totalCents = subtotalCents + taxCents - discountCents;

    let poNumber = generatePoNumber();
    for (let attempt = 0; attempt < 5; attempt++) {
      const exists = await this.purchaseOrderModel
        .findOne({ branchId, poNumber })
        .exec();
      if (!exists) break;
      poNumber = generatePoNumber();
    }

    const doc = await this.purchaseOrderModel.create({
      restaurantId,
      branchId,
      supplierId: input.supplierId,
      poNumber,
      status: S.PurchaseOrderStatus.DRAFT,
      orderedById: ctx.employeeId ?? ctx.userId,
      orderedAt: new Date(),
      expectedDeliveryDate: input.expectedDeliveryDate,
      notes: input.notes,
      items,
      subtotalCents,
      taxCents,
      discountCents,
      totalCents,
    });

    return toSharedPurchaseOrder(doc);
  }

  async receivePurchaseOrder(
    ctx: AuthContext,
    id: string,
    input: ReceivePurchaseOrderInput = {}
  ): Promise<S.PurchaseOrder> {
    const branchId = ctx.branchId;
    const restaurantId = ctx.restaurantId;
    if (!branchId || !restaurantId) {
      throw new BadRequestException('Branch and restaurant context required');
    }

    const po = await this.purchaseOrderModel
      .findOne({ _id: id, branchId })
      .exec();
    if (!po) throw new NotFoundException(`PurchaseOrder ${id} not found`);

    if (po.status === S.PurchaseOrderStatus.CANCELLED) {
      throw new BadRequestException('Cannot receive a cancelled purchase order');
    }
    if (po.status === S.PurchaseOrderStatus.RECEIVED) {
      return toSharedPurchaseOrder(po);
    }

    const receivedMap = new Map<string, number>();
    if (input.items && input.items.length > 0) {
      for (const it of input.items) {
        if (it.quantityReceived <= 0) continue;
        receivedMap.set(String(it.inventoryItemId), Number(it.quantityReceived));
      }
    }

    const nextItems = (po.items ?? []).map((it: any) => {
      const key = String(it.inventoryItemId);
      const qty = receivedMap.has(key)
        ? receivedMap.get(key)!
        : Number(it.quantityOrdered ?? 0);
      return {
        ...it.toObject?.(),
        quantityReceived: Math.min(qty, Number(it.quantityOrdered ?? qty)),
      };
    });

    const anyPartial = nextItems.some(
      (it: any) => Number(it.quantityReceived ?? 0) < Number(it.quantityOrdered ?? 0)
    );
    const nextStatus = anyPartial
      ? S.PurchaseOrderStatus.PARTIALLY_RECEIVED
      : S.PurchaseOrderStatus.RECEIVED;

    const updated = await this.purchaseOrderModel
      .findByIdAndUpdate(
        po._id,
        {
          $set: {
            status: nextStatus,
            receivedAt: new Date(),
            receivedById: ctx.employeeId ?? ctx.userId,
            notes: input.notes ?? po.notes,
            items: nextItems,
          },
        },
        { new: true }
      )
      .exec();
    if (!updated) throw new NotFoundException('PurchaseOrder disappeared');

    for (const it of nextItems) {
      const qtyIn = Number((it as any).quantityReceived ?? 0);
      if (qtyIn <= 0) continue;
      await this.inventoryService.updateStockLevel(ctx, String((it as any).inventoryItemId), {
        quantityChange: qtyIn,
        type: S.InventoryTransactionType.PURCHASE,
        reason: `PO ${updated.poNumber}`,
        supplierId: String(updated.supplierId),
        referenceId: String(updated._id),
        referenceType: 'PURCHASE',
      });
    }

    return toSharedPurchaseOrder(updated);
  }

  async cancelPurchaseOrder(ctx: AuthContext, id: string): Promise<S.PurchaseOrder> {
    const branchId = ctx.branchId;
    if (!branchId) {
      throw new BadRequestException('Branch context required');
    }

    const po = await this.purchaseOrderModel.findOne({ _id: id, branchId }).exec();
    if (!po) throw new NotFoundException(`PurchaseOrder ${id} not found`);

    const updated = await this.purchaseOrderModel
      .findByIdAndUpdate(po._id, { $set: { status: S.PurchaseOrderStatus.CANCELLED } }, { new: true })
      .exec();
    if (!updated) throw new NotFoundException('PurchaseOrder disappeared');
    return toSharedPurchaseOrder(updated);
  }
}

