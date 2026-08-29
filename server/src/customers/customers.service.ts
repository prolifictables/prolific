import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Customer } from './schemas/customer.schema';
import type { AuthContext } from '../common/decorators/current-user.decorator';

export interface CreateCustomerInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
}

export interface FindOrCreateCustomerInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
}

@Injectable()
export class CustomersService {
  constructor(
    @InjectModel(Customer.name) private readonly customerModel: Model<Customer>
  ) {}

  /**
   * Creates a new customer record scoped to the current restaurant/branch.
   */
  async createCustomer(
    ctx: AuthContext,
    input: CreateCustomerInput
  ): Promise<Customer> {
    const restaurantId = ctx.restaurantId;
    if (!restaurantId) {
      throw new Error('Restaurant context required to create customer');
    }

    const customer = await this.customerModel.create({
      restaurantId,
      branchId: ctx.branchId ?? undefined,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone,
      address: input.address,
      notes: input.notes,
      totalVisits: 0,
      totalSpent: 0,
    });

    return customer;
  }

  /**
   * Finds an existing customer by email or phone (within branch scope),
   * or creates a new one if no match is found. Used during order creation
   * to attach a customer without requiring an explicit lookup step.
   */
  async findOrCreate(
    ctx: AuthContext,
    input: FindOrCreateCustomerInput
  ): Promise<Customer> {
    const restaurantId = ctx.restaurantId;
    if (!restaurantId) {
      throw new Error('Restaurant context required for findOrCreate');
    }
    const branchId = ctx.branchId;

    // Build lookup query — match by email or phone when provided
    const lookupConditions: Record<string, unknown>[] = [];
    if (input.email) {
      lookupConditions.push({ restaurantId, ...(branchId ? { branchId } : {}), email: input.email });
    }
    if (input.phone) {
      lookupConditions.push({ restaurantId, ...(branchId ? { branchId } : {}), phone: input.phone });
    }

    let existing: Customer | null = null;
    if (lookupConditions.length > 0) {
      existing = await this.customerModel
        .findOne({ $or: lookupConditions })
        .exec();
    }

    if (existing) {
      return existing;
    }

    return this.createCustomer(ctx, input);
  }

  /**
   * Lists customers scoped to the current restaurant/branch context.
   */
  async list(ctx: AuthContext): Promise<Customer[]> {
    const restaurantId = ctx.restaurantId;
    if (!restaurantId) {
      throw new Error('Restaurant context required to list customers');
    }

    const query: Record<string, unknown> = { restaurantId };
    if (ctx.branchId) {
      query.branchId = ctx.branchId;
    }

    return this.customerModel.find(query).sort({ createdAt: -1 }).exec();
  }

  /**
   * Retrieves a single customer by id, scoped to tenant context.
   */
  async findById(ctx: AuthContext, id: string): Promise<Customer> {
    const restaurantId = ctx.restaurantId;
    if (!restaurantId) {
      throw new Error('Restaurant context required');
    }

    const query: Record<string, unknown> = { _id: id, restaurantId };
    if (ctx.branchId) {
      query.branchId = ctx.branchId;
    }

    const customer = await this.customerModel.findOne(query).exec();
    if (!customer) {
      throw new NotFoundException(`Customer ${id} not found`);
    }
    return customer;
  }

  /**
   * Updates a customer's mutable fields.
   */
  async update(
    ctx: AuthContext,
    id: string,
    updates: Partial<CreateCustomerInput>
  ): Promise<Customer> {
    const customer = await this.findById(ctx, id);
    const updated = await this.customerModel
      .findByIdAndUpdate(customer._id, { $set: updates }, { new: true })
      .exec();
    if (!updated) {
      throw new NotFoundException(`Customer ${id} not found`);
    }
    return updated;
  }
}
