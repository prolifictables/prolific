import { z } from 'zod';
import {
  OrderStatus,
  PaymentMethod,
  OrderType,
  MenuItemStatus,
  Role,
} from '@prolific/shared-types';

export const createOrderSchema = z.object({
  orderType: z.nativeEnum(OrderType),
  branchId: z.string().min(1),
  tableId: z.string().optional(),
  customerId: z.string().optional(),
  employeeId: z.string().min(1),
  items: z.array(
    z.object({
      menuItemId: z.string().min(1),
      quantity: z.number().int().min(1),
      selectedModifiers: z.array(
        z.object({
          modifierId: z.string().min(1),
          optionIds: z.array(z.string().min(1)),
        })
      ),
      specialInstructions: z.string().optional(),
    })
  ).min(1),
  discountId: z.string().optional(),
  notes: z.string().optional(),
});

export const updateOrderStatusSchema = z.object({
  orderId: z.string().min(1),
  status: z.nativeEnum(OrderStatus),
});

export const recordPaymentSchema = z.object({
  orderId: z.string().min(1),
  amount: z.number().positive(),
  method: z.nativeEnum(PaymentMethod),
  employeeId: z.string().min(1),
  terminalId: z.string().optional(),
  notes: z.string().optional(),
});

export const createEmployeeSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  password: z.string().min(4),
  role: z.nativeEnum(Role),
  branchId: z.string().min(1),
  restaurantId: z.string().min(1),
  pin: z.string().regex(/^\d{4,6}$/).optional(),
});

export const createMenuItemSchema = z.object({
  name: z.string().min(1),
  categoryId: z.string().min(1),
  price: z.number().min(0),
  status: z.nativeEnum(MenuItemStatus).default(MenuItemStatus.AVAILABLE),
  isTaxable: z.boolean().default(true),
  taxIds: z.array(z.string().min(1)).default([]),
  modifierIds: z.array(z.string().min(1)).default([]),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  branchId: z.string().optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type CreateMenuItemInput = z.infer<typeof createMenuItemSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
