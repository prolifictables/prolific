import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as S from '@prolific/shared-types';
import { RoleDefinition } from './schemas/role.schema';

const DEFAULT_ROLE_PERMISSIONS: Record<S.Role, S.Permission[]> = {
  [S.Role.SUPER_ADMIN]: Object.values(S.Permission),

  [S.Role.ADMIN]: [
    S.Permission.VIEW_DASHBOARD, S.Permission.VIEW_REPORTS, S.Permission.VIEW_FINANCIALS,
    S.Permission.MENU_VIEW, S.Permission.MENU_CREATE, S.Permission.MENU_EDIT,
    S.Permission.MENU_DELETE, S.Permission.MENU_CHANGE_PRICE, S.Permission.MENU_MARK_OOS,
    S.Permission.ORDER_VIEW, S.Permission.ORDER_CREATE, S.Permission.ORDER_EDIT,
    S.Permission.ORDER_CANCEL, S.Permission.ORDER_HOLD, S.Permission.ORDER_VOID,
    S.Permission.ORDER_REFUND, S.Permission.ORDER_DISCOUNT, S.Permission.ORDER_DISCOUNT_LARGE,
    S.Permission.ORDER_COMPLETE, S.Permission.ORDER_ACCEPT_ONLINE,
    S.Permission.PAYMENT_ACCEPT, S.Permission.PAYMENT_REFUND, S.Permission.PAYMENT_RECORD_CASH,
    S.Permission.PAYMENT_RECORD_CARD,
    S.Permission.KITCHEN_VIEW, S.Permission.KITCHEN_UPDATE_STATUS,
    S.Permission.TABLE_VIEW, S.Permission.TABLE_SESSION_OPEN, S.Permission.TABLE_SESSION_CLOSE,
    S.Permission.TABLE_SESSION_SPLIT, S.Permission.TABLE_SESSION_COMBINE,
    S.Permission.INVENTORY_VIEW, S.Permission.INVENTORY_CREATE, S.Permission.INVENTORY_EDIT,
    S.Permission.INVENTORY_ADJUST, S.Permission.INVENTORY_PURCHASE, S.Permission.INVENTORY_WASTAGE,
    S.Permission.SHIFT_OPEN, S.Permission.SHIFT_CLOSE, S.Permission.SHIFT_VIEW_ALL,
    S.Permission.CASH_PAYIN, S.Permission.CASH_PAYOUT,
    S.Permission.EMPLOYEE_VIEW, S.Permission.EMPLOYEE_CREATE, S.Permission.EMPLOYEE_EDIT,
    S.Permission.EMPLOYEE_DELETE, S.Permission.ROLE_ASSIGN,
    S.Permission.SETTINGS_VIEW, S.Permission.SETTINGS_EDIT, S.Permission.BRANCH_MANAGE,
    S.Permission.CUSTOMER_VIEW, S.Permission.CUSTOMER_CREATE, S.Permission.CUSTOMER_EDIT,
    S.Permission.AUDIT_VIEW,
    S.Permission.APPROVE_REFUND, S.Permission.APPROVE_VOID, S.Permission.APPROVE_DISCOUNT,
    S.Permission.APPROVE_PRICE_CHANGE, S.Permission.APPROVE_CASH_ADJUST,
  ],

  [S.Role.MANAGER]: [
    S.Permission.VIEW_DASHBOARD, S.Permission.VIEW_REPORTS, S.Permission.VIEW_FINANCIALS,
    S.Permission.MENU_VIEW, S.Permission.MENU_CREATE, S.Permission.MENU_EDIT,
    // Also grant DELETE so managers can soft-remove items/categories/modifiers
    // directly from the POS terminal (Admin parity) — the server controller
    // actually soft-deletes via status change so this just gates access.
    S.Permission.MENU_DELETE,
    S.Permission.MENU_MARK_OOS, S.Permission.MENU_CHANGE_PRICE,
    S.Permission.ORDER_VIEW, S.Permission.ORDER_CREATE, S.Permission.ORDER_EDIT,
    S.Permission.ORDER_CANCEL, S.Permission.ORDER_HOLD, S.Permission.ORDER_VOID,
    S.Permission.ORDER_REFUND, S.Permission.ORDER_DISCOUNT, S.Permission.ORDER_DISCOUNT_LARGE,
    S.Permission.ORDER_COMPLETE, S.Permission.ORDER_ACCEPT_ONLINE,
    S.Permission.PAYMENT_ACCEPT, S.Permission.PAYMENT_REFUND, S.Permission.PAYMENT_RECORD_CASH,
    S.Permission.PAYMENT_RECORD_CARD,
    S.Permission.KITCHEN_VIEW, S.Permission.KITCHEN_UPDATE_STATUS,
    S.Permission.TABLE_VIEW, S.Permission.TABLE_SESSION_OPEN, S.Permission.TABLE_SESSION_CLOSE,
    S.Permission.TABLE_SESSION_SPLIT, S.Permission.TABLE_SESSION_COMBINE,
    S.Permission.INVENTORY_VIEW, S.Permission.INVENTORY_EDIT, S.Permission.INVENTORY_ADJUST,
    S.Permission.INVENTORY_PURCHASE, S.Permission.INVENTORY_WASTAGE,
    S.Permission.SHIFT_OPEN, S.Permission.SHIFT_CLOSE, S.Permission.SHIFT_VIEW_ALL,
    S.Permission.CASH_PAYIN, S.Permission.CASH_PAYOUT,
    S.Permission.EMPLOYEE_VIEW,
    S.Permission.SETTINGS_VIEW,
    S.Permission.CUSTOMER_VIEW, S.Permission.CUSTOMER_CREATE, S.Permission.CUSTOMER_EDIT,
    S.Permission.AUDIT_VIEW,
    S.Permission.APPROVE_REFUND, S.Permission.APPROVE_VOID, S.Permission.APPROVE_DISCOUNT,
    S.Permission.APPROVE_PRICE_CHANGE, S.Permission.APPROVE_CASH_ADJUST,
  ],

  [S.Role.SUPERVISOR]: [
    S.Permission.VIEW_DASHBOARD, S.Permission.VIEW_REPORTS,
    S.Permission.MENU_VIEW, S.Permission.MENU_MARK_OOS,
    S.Permission.ORDER_VIEW, S.Permission.ORDER_CREATE, S.Permission.ORDER_EDIT,
    S.Permission.ORDER_CANCEL, S.Permission.ORDER_HOLD,
    S.Permission.ORDER_VOID, S.Permission.ORDER_REFUND,
    S.Permission.ORDER_DISCOUNT, S.Permission.ORDER_DISCOUNT_LARGE,
    S.Permission.ORDER_COMPLETE, S.Permission.ORDER_ACCEPT_ONLINE,
    S.Permission.PAYMENT_ACCEPT, S.Permission.PAYMENT_REFUND, S.Permission.PAYMENT_RECORD_CASH,
    S.Permission.PAYMENT_RECORD_CARD,
    S.Permission.KITCHEN_VIEW, S.Permission.KITCHEN_UPDATE_STATUS,
    S.Permission.TABLE_VIEW, S.Permission.TABLE_SESSION_OPEN, S.Permission.TABLE_SESSION_CLOSE,
    S.Permission.TABLE_SESSION_SPLIT, S.Permission.TABLE_SESSION_COMBINE,
    S.Permission.INVENTORY_VIEW, S.Permission.INVENTORY_ADJUST, S.Permission.INVENTORY_WASTAGE,
    S.Permission.SHIFT_OPEN, S.Permission.SHIFT_CLOSE, S.Permission.SHIFT_VIEW_ALL,
    S.Permission.CASH_PAYIN, S.Permission.CASH_PAYOUT,
    S.Permission.CUSTOMER_VIEW, S.Permission.CUSTOMER_CREATE, S.Permission.CUSTOMER_EDIT,
    S.Permission.APPROVE_VOID, S.Permission.APPROVE_DISCOUNT, S.Permission.APPROVE_CASH_ADJUST,
  ],

  [S.Role.CASHIER]: [
    S.Permission.MENU_VIEW,
    S.Permission.ORDER_VIEW, S.Permission.ORDER_CREATE, S.Permission.ORDER_EDIT,
    S.Permission.ORDER_HOLD, S.Permission.ORDER_DISCOUNT, S.Permission.ORDER_COMPLETE,
    S.Permission.PAYMENT_ACCEPT, S.Permission.PAYMENT_RECORD_CASH, S.Permission.PAYMENT_RECORD_CARD,
    S.Permission.KITCHEN_VIEW,
    S.Permission.TABLE_VIEW, S.Permission.TABLE_SESSION_OPEN, S.Permission.TABLE_SESSION_CLOSE,
    S.Permission.SHIFT_OPEN, S.Permission.SHIFT_CLOSE,
    S.Permission.CUSTOMER_VIEW, S.Permission.CUSTOMER_CREATE, S.Permission.CUSTOMER_EDIT,
  ],

  [S.Role.KITCHEN]: [
    S.Permission.KITCHEN_VIEW, S.Permission.KITCHEN_UPDATE_STATUS,
    S.Permission.ORDER_VIEW,
    S.Permission.MENU_VIEW,
  ],

  [S.Role.WAITER]: [
    S.Permission.MENU_VIEW,
    S.Permission.ORDER_VIEW, S.Permission.ORDER_CREATE, S.Permission.ORDER_EDIT,
    S.Permission.KITCHEN_VIEW,
    S.Permission.TABLE_VIEW, S.Permission.TABLE_SESSION_OPEN, S.Permission.TABLE_SESSION_CLOSE,
    S.Permission.CUSTOMER_VIEW, S.Permission.CUSTOMER_CREATE,
    S.Permission.PAYMENT_ACCEPT,
  ],

  [S.Role.ACCOUNTANT]: [
    S.Permission.VIEW_DASHBOARD, S.Permission.VIEW_REPORTS, S.Permission.VIEW_FINANCIALS,
    S.Permission.ORDER_VIEW,
    S.Permission.INVENTORY_VIEW,
    S.Permission.SHIFT_VIEW_ALL,
    S.Permission.AUDIT_VIEW,
    S.Permission.CUSTOMER_VIEW,
    S.Permission.EMPLOYEE_VIEW,
  ],
};

@Injectable()
export class RbacService implements OnModuleInit {
  private readonly logger = new Logger(RbacService.name);

  constructor(
    @InjectModel(RoleDefinition.name)
    private readonly roleModel: Model<RoleDefinition>
  ) {}

  async onModuleInit() {
    for (const role of Object.values(S.Role)) {
      const defaults = DEFAULT_ROLE_PERMISSIONS[role] ?? [];
      const existing = await this.roleModel.findOne({ role }).exec();
      if (!existing) {
        await this.roleModel
          .create({
            role,
            permissions: defaults,
            description: `Default permissions for ${role}`,
          })
          .catch(() => null);
        continue;
      }

      const existingPerms = Array.isArray(existing.permissions) ? existing.permissions : [];
      const merged = Array.from(new Set([...existingPerms, ...defaults]));
      if (merged.length !== existingPerms.length) {
        await this.roleModel
          .updateOne(
            { role },
            {
              $set: {
                permissions: merged,
              },
              $setOnInsert: {
                description: `Default permissions for ${role}`,
              },
            },
            { upsert: true }
          )
          .exec();
      }
    }
    this.logger.log('Default roles upserted');
  }

  async getPermissionsForRole(role: S.Role): Promise<S.Permission[]> {
    const row = await this.roleModel.findOne({ role }).exec();
    if (row) return row.permissions as S.Permission[];
    return DEFAULT_ROLE_PERMISSIONS[role] ?? [];
  }
}
