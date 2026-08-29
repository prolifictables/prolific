export interface MetaRow {
  id: string;
  value: string | null;
  updated_at: number;
}

export interface EmployeeRow {
  id: string;
  user_id: string | null;
  restaurant_id: string | null;
  branch_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  position_title: string | null;
  employee_number: string | null;
  pin_hash: string | null;
  is_active: number;
  joined_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface MenuCategoryRow {
  id: string;
  branch_id: string | null;
  restaurant_id: string | null;
  name: string | null;
  description: string | null;
  image_url: string | null;
  sort_order: number | null;
  is_active: number;
  created_at: number;
  updated_at: number;
}

export interface MenuItemRow {
  id: string;
  category_id: string | null;
  branch_id: string | null;
  restaurant_id: string | null;
  sku: string | null;
  name: string | null;
  description: string | null;
  image_url: string | null;
  price_cents: number | null;
  cost_cents: number | null;
  status: string | null;
  allergen_tags: string | null;
  tax_ids: string | null;
  modifier_ids: string | null;
  preparation_needed: number;
  kitchen_station: string | null;
  version: number;
  last_modified_at: number | null;
  last_modified_by: string | null;
  scheduled_availability: string | null;
  is_tax_inclusive: number;
  max_per_order: number;
  is_active: number;
  created_at: number;
  updated_at: number;
}

export interface MenuModifierRow {
  id: string;
  branch_id: string | null;
  name: string | null;
  description: string | null;
  is_required: number;
  min_select: number;
  max_select: number;
  is_active: number;
  created_at: number;
  updated_at: number;
}

export interface MenuModifierOptionRow {
  id: string;
  modifier_id: string | null;
  name: string | null;
  price_delta_cents: number | null;
  is_default: number;
  sort_order: number | null;
  is_active: number;
  created_at: number;
  updated_at: number;
}

export interface TaxRow {
  id: string;
  branch_id: string | null;
  name: string | null;
  rate_percent: number | null;
  is_compound: number;
  is_inclusive: number;
  is_active: number;
  is_default: number;
  created_at: number;
  updated_at: number;
}

export interface DiscountRow {
  id: string;
  branch_id: string | null;
  name: string | null;
  type: string | null;
  value_cents: number | null;
  value_percent: number | null;
  max_amount_cents: number | null;
  min_order_cents: number | null;
  is_active: number;
  valid_times: string | null;
  created_at: number;
  updated_at: number;
}

export interface TableRow {
  id: string;
  branch_id: string | null;
  restaurant_id: string | null;
  name: string | null;
  zone: string | null;
  capacity: number | null;
  status: string | null;
  qr_code_id: string | null;
  created_at: number;
  updated_at: number;
}

/** Professional dine-in "running tab" container for a table visit.
 *  Groups one or more orders per table and accumulates running totals
 *  so attendants can add menu items to a table progressively without
 *  holding or charging first. */
export interface TableSessionRow {
  id: string;
  branch_id: string | null;
  restaurant_id: string | null;
  table_id: string | null;
  /** Display tab number, e.g. "T-1024" */
  tab_number: string | null;
  status:
    | 'OPEN'
    | 'AWAITING_PAYMENT'
    | 'PARTIALLY_PAID'
    | 'PAID'
    | 'CLOSED'
    | 'VOIDED'
    | null;
  covers: number;
  /** ID of the employee who opened the tab */
  opened_by: string | null;
  opened_by_name: string | null;
  /** Employee/server currently responsible for the table */
  server_id: string | null;
  server_name: string | null;
  opened_at: number | null;
  closed_at: number | null;
  closed_by: string | null;
  /** Running balances (updated on every mutation) */
  subtotal_cents: number;
  discount_cents: number;
  tax_cents: number;
  tip_cents: number;
  total_cents: number;
  paid_amount_cents: number;
  balance_due_cents: number;
  customer_count: number;
  customer_name: string | null;
  note: string | null;
  /** The active/open order for incremental edits */
  current_order_id: string | null;
  server_version: number;
  local_version: number;
  synced: number;
  created_at: number;
  updated_at: number;
}

/** Immutable ledger entry — every mutating action on a table session
 *  (add item, void, discount, payment, open/close, note, transfer)
 *  creates one row. Gives operators full auditability (who did what,
 *  when, and by how much the tab changed). */
export type TableLedgerEntryType =
  | 'OPENED'
  | 'ADD_ITEM'
  | 'EDIT_QTY'
  | 'VOID_ITEM'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'NOTE'
  | 'DISCOUNT'
  | 'TIP'
  | 'PAYMENT'
  | 'AWAITING_PAYMENT'
  | 'CLOSED'
  | 'VOIDED'
  | 'COVERS_UPDATED'
  | 'SERVER_CHANGED';

export interface TableSessionLedgerRow {
  id: number | null;
  session_id: string | null;
  branch_id: string | null;
  restaurant_id: string | null;
  entry_type: TableLedgerEntryType;
  /** Order id, order item id, payment id — whatever this entry is about */
  reference_id: string | null;
  actor_id: string | null;
  actor_name: string | null;
  /** Human-readable item name / memo */
  label: string | null;
  quantity: number;
  amount_delta_cents: number;
  amount_after_cents: number;
  /** Reason for void / comment / note text / payment method */
  note: string | null;
  metadata_json: string | null;
  created_at: number;
}

export interface CustomerRow {
  id: string;
  restaurant_id: string | null;
  branch_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  loyalty_level: number | null;
  total_visits: number;
  total_spent_cents: number;
  note: string | null;
  created_at: number;
  updated_at: number;
}

export interface OrderRow {
  id: string;
  branch_id: string | null;
  restaurant_id: string | null;
  order_number: string | null;
  source: string | null;
  order_type: string | null;
  table_id: string | null;
  table_session_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  employee_id: string | null;
  held_by: string | null;
  held_at: number | null;
  status: string | null;
  payment_status: string | null;
  payment_method: string | null;
  paid_amount_cents: number | null;
  balance_due_cents: number | null;
  subtotal_cents: number | null;
  discount_cents: number | null;
  tax_cents: number | null;
  total_cents: number | null;
  tip_cents: number | null;
  change_due_cents: number | null;
  discount_id: string | null;
  note: string | null;
  split_group_id: string | null;
  idempotency_key: string | null;
  server_version: number;
  local_version: number;
  synced: number;
  created_at: number;
  updated_at: number;
}

export interface OrderItemRow {
  id: string;
  order_id: string | null;
  menu_item_id: string | null;
  name_snapshot: string | null;
  price_snapshot_cents: number | null;
  quantity: number | null;
  subtotal_cents: number | null;
  tax_cents: number | null;
  discount_cents: number | null;
  total_cents: number | null;
  special_instructions: string | null;
  preparation_status: string | null;
}

export interface OrderItemModifierOptionRow {
  id: string;
  order_item_id: string | null;
  modifier_id: string | null;
  modifier_name: string | null;
  option_id: string | null;
  option_name: string | null;
  price_delta_cents: number | null;
}

export interface PaymentRow {
  id: string;
  order_id: string | null;
  employee_id: string | null;
  shift_id: string | null;
  branch_id: string | null;
  restaurant_id: string | null;
  method: string | null;
  provider: string | null;
  transaction_reference: string | null;
  amount_cents: number | null;
  tip_cents: number | null;
  change_due_cents: number | null;
  status: string | null;
  verification_source: string | null;
  completed_at: number | null;
  reference_note: string | null;
  idempotency_key: string | null;
  server_version: number;
  local_version: number;
  synced: number;
  failure_reason: string | null;
  provider_response_json: string | null;
  created_at: number;
  updated_at: number;
}

export interface ShiftRow {
  id: string;
  device_id: string | null;
  branch_id: string | null;
  restaurant_id: string | null;
  employee_id: string | null;
  status: string | null;
  opening_cash_cents: number | null;
  expected_cash_cents: number | null;
  closing_cash_cents: number | null;
  variance_cents: number | null;
  cash_sales_cents: number | null;
  card_sales_cents: number | null;
  other_sales_cents: number | null;
  refunds_cents: number | null;
  payout_cents: number | null;
  note: string | null;
  opened_at: number | null;
  closed_at: number | null;
  idempotency_key: string | null;
  server_version: number;
  local_version: number;
  synced: number;
  created_at: number;
  updated_at: number;
}

export interface CashAdjustmentRow {
  id: string;
  shift_id: string | null;
  employee_id: string | null;
  branch_id: string | null;
  amount_cents: number | null;
  type: string | null;
  reason: string | null;
  reference: string | null;
  created_at: number;
}

export interface KitchenOrderRow {
  id: string;
  order_id: string | null;
  branch_id: string | null;
  station: string | null;
  status: string | null;
  priority: string | null;
  started_at: number | null;
  ready_at: number | null;
  completed_at: number | null;
  served_by: string | null;
  created_at: number;
  updated_at: number;
}

export interface KitchenOrderItemRow {
  id: string;
  kitchen_order_id: string | null;
  order_item_id: string | null;
  menu_item_id: string | null;
  menu_item_name: string | null;
  qty: number | null;
  special_instructions: string | null;
  status: string | null;
}

export interface InventoryItemRow {
  id: string;
  branch_id: string | null;
  sku: string | null;
  name: string | null;
  unit: string | null;
  supplier_id: string | null;
  current_stock_level: number | null;
  min_stock_level: number | null;
  unit_cost_cents: number | null;
  last_counted_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface InventoryTransactionRow {
  id: string;
  inventory_item_id: string | null;
  branch_id: string | null;
  reference_id: string | null;
  reference_type: string | null;
  type: string | null;
  qty: number | null;
  unit_cost_cents: number | null;
  reason: string | null;
  performed_by: string | null;
  performed_at: number;
}

export interface RecipeRow {
  id: string;
  menu_item_id: string | null;
  branch_id: string | null;
  restaurant_id: string | null;
  name: string | null;
  portion_yield: number | null;
  cost_at_recipe_time_cents: number;
  created_at: number;
  updated_at: number;
}

export interface RecipeIngredientRow {
  id: string;
  recipe_id: string | null;
  inventory_item_id: string | null;
  ingredient_name: string | null;
  qty: number | null;
  unit: string | null;
  cost_snapshot_cents: number;
}

export interface SettingRow {
  id: number;
  scope: string | null;
  key: string | null;
  value: string | null;
  restaurant_id: string | null;
  branch_id: string | null;
  updated_at: number;
}

export interface SyncQueueRow {
  id: number;
  op_id: string | null;
  entity_type: string | null;
  operation: string | null;
  entity_id: string | null;
  payload: string | null;
  idempotency_key: string | null;
  local_entity_version: number;
  status: string | null;
  attempts: number;
  error_message: string | null;
  next_attempt_at: number | null;
  created_at: number | null;
  claimed_at: number | null;
  completed_at: number | null;
}

export interface SyncRecordRow {
  id: number;
  device_id: string | null;
  idempotency_key: string | null;
  entity_type: string | null;
  operation: string | null;
  entity_id: string | null;
  status: string | null;
  conflict_resolution: string | null;
  attempt_count: number;
  response_snapshot: string | null;
  applied_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

export interface AuditLogRow {
  id: number;
  restaurant_id: string | null;
  branch_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  action: string | null;
  actor_id: string | null;
  actor_role: string | null;
  ip_address: string | null;
  device_id: string | null;
  changes_json: string | null;
  metadata_json: string | null;
  created_at: number;
}

export interface ConnectionEventRow {
  id: number;
  device_id: string | null;
  status: string | null;
  from_status: string | null;
  to_status: string | null;
  reason: string | null;
  ip_address: string | null;
  created_at: number;
}

export interface LoyaltyAccountRow {
  id: string;
  restaurant_id: string | null;
  customer_id: string | null;
  points: number;
  tier: string | null;
  joined_at: number | null;
  last_activity_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface PromotionRow {
  id: string;
  branch_id: string | null;
  name: string | null;
  description: string | null;
  type: string | null;
  discount_id: string | null;
  min_order_cents: number | null;
  start_at: number | null;
  end_at: number | null;
  uses_per_customer: number;
  is_active: number;
  created_at: number;
  updated_at: number;
}

export interface LastAuthPayload {
  employeeId?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  restaurantId?: string;
  branchId?: string;
  cashier?: unknown;
  deviceId?: string;
}
