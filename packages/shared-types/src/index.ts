// ============================================================================
// BASE TYPES & ENUMS
// ============================================================================

export type ID = string;
export type Timestamp = Date;
export type Currency = string; // ISO 4217: e.g., "USD", "NGN", "GHS"
export type Locale = string; // e.g., "en-US", "en-NG"

export enum Role {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  MANAGER = 'MANAGER',
  SUPERVISOR = 'SUPERVISOR',
  CASHIER = 'CASHIER',
  KITCHEN = 'KITCHEN',
  WAITER = 'WAITER',
  ACCOUNTANT = 'ACCOUNTANT',
}

export enum EmployeeStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  SUSPENDED = 'SUSPENDED',
  TERMINATED = 'TERMINATED',
  ON_LEAVE = 'ON_LEAVE',
}

export enum ConnectionStatus {
  ONLINE = 'ONLINE',
  OFFLINE = 'OFFLINE',
  SYNCHRONIZING = 'SYNCHRONIZING',
  SYNC_ERROR = 'SYNC_ERROR',
}

// ============================================================================
// MENU & PRODUCTS
// ============================================================================

export enum MenuItemStatus {
  AVAILABLE = 'AVAILABLE',
  OUT_OF_STOCK = 'OUT_OF_STOCK',
  DISABLED = 'DISABLED',
  SCHEDULED = 'SCHEDULED',
}

export enum OrderType {
  DINE_IN = 'DINE_IN',
  TAKEAWAY = 'TAKEAWAY',
  PICKUP = 'PICKUP',
  DELIVERY = 'DELIVERY',
  QR_ORDER = 'QR_ORDER',
  ONLINE = 'ONLINE',
}

export interface ModifierOption {
  id: ID;
  name: string;
  priceDelta: number;
  isDefault?: boolean;
}

export interface MenuModifier {
  id: ID;
  name: string;
  description?: string;
  required: boolean;
  multiSelect: boolean;
  minSelections: number;
  maxSelections: number;
  options: ModifierOption[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface MenuCategory {
  id: ID;
  restaurantId: ID;
  branchId: ID;
  name: string;
  description?: string;
  sortOrder: number;
  isActive: boolean;
  imageUrl?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface MenuItem {
  id: ID;
  restaurantId: ID;
  branchId: ID;
  categoryId: ID;
  name: string;
  description?: string;
  price: number;
  imageUrl?: string;
  status: MenuItemStatus;
  sortOrder: number;
  isTaxable: boolean;
  taxIds: ID[];
  modifierIds: ID[];
  recipeId?: ID;
  scheduledAvailability?: {
    daysOfWeek: number[]; // 0-6, Sun-Sat
    startTime: string; // "HH:mm"
    endTime: string; // "HH:mm"
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Tax {
  id: ID;
  restaurantId: ID;
  branchId: ID;
  name: string;
  rate: number; // percentage, e.g. 7.5 for 7.5%
  isIncludedInPrice: boolean;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Discount {
  id: ID;
  restaurantId: ID;
  branchId: ID;
  name: string;
  type: 'PERCENTAGE' | 'FIXED';
  value: number;
  maxAmount?: number;
  minOrderAmount?: number;
  isActive: boolean;
  requiresManagerApproval: boolean;
  approvalThreshold?: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ============================================================================
// RESTAURANT / BRANCH / TABLE
// ============================================================================

export interface Restaurant {
  id: ID;
  name: string;
  legalName?: string;
  logoUrl?: string;
  bannerUrl?: string;
  address: string;
  city: string;
  country: string;
  phone: string;
  email: string;
  currency: Currency;
  locale: Locale;
  taxId?: string;
  registrationNumber?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Branch {
  id: ID;
  restaurantId: ID;
  name: string;
  address: string;
  city: string;
  country: string;
  phone: string;
  email: string;
  timezone: string; // IANA, e.g. "Africa/Lagos"
  openingHours: {
    dayOfWeek: number;
    openTime: string;
    closeTime: string;
    isClosed: boolean;
  }[];
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Table {
  id: ID;
  restaurantId: ID;
  branchId: ID;
  name: string; // e.g., "Table 12", "VIP 1"
  capacity: number;
  floor?: string;
  zone?: string;
  position?: { x: number; y: number };
  isActive: boolean;
  qrCodeId: ID;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface QRCode {
  id: ID;
  restaurantId: ID;
  branchId: ID;
  tableId: ID;
  token: string; // URL-safe, unique token like "8H72KD"
  isActive: boolean;
  printedAt?: Timestamp;
  lastScannedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export enum TableSessionStatus {
  OPEN = 'OPEN',
  AWAITING_PAYMENT = 'AWAITING_PAYMENT',
  PARTIALLY_PAID = 'PARTIALLY_PAID',
  PAID = 'PAID',
  CLOSED = 'CLOSED',
}

export interface TableSession {
  id: ID;
  restaurantId: ID;
  branchId: ID;
  tableId: ID;
  qrCodeId: ID;
  status: TableSessionStatus;
  openedAt: Timestamp;
  openedBy?: ID; // employee id
  customerIds: ID[]; // multiple customers at the table
  orderIds: ID[];
  totalAmount: number;
  paidAmount: number;
  balanceDue: number;
  closedAt?: Timestamp;
  closedBy?: ID;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ============================================================================
// USERS / EMPLOYEES
// ============================================================================

export interface User {
  id: ID;
  email: string;
  hashedPassword: string;
  firstName: string;
  lastName: string;
  phone?: string;
  address?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
  };
  emergencyContact?: {
    name?: string;
    phone?: string;
    relationship?: string;
  };
  avatarUrl?: string;
  isActive: boolean;
  isEmailVerified: boolean;
  emailVerifiedAt?: Timestamp;
  lastLoginAt?: Timestamp;
  failedLoginAttempts: number;
  lockedUntil?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Employee {
  id: ID;
  userId: ID;
  restaurantId: ID;
  branchId: ID;
  role: Role;
  pin?: string; // hashed PIN for manager approval / cashier login
  employeeNumber?: string;
  positionTitle?: string;
  assignedZoneIds: ID[];
  status: EmployeeStatus;
  joinedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ============================================================================
// CUSTOMERS
// ============================================================================

export interface Customer {
  id: ID;
  restaurantId: ID;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  loyaltyAccountId?: ID;
  totalVisits: number;
  totalSpent: number;
  lastVisitAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface LoyaltyAccount {
  id: ID;
  customerId: ID;
  restaurantId: ID;
  points: number;
  tier: 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM';
  pointsToNextTier?: number;
  lastPointsEarnedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ============================================================================
// ORDERS
// ============================================================================

export enum OrderStatus {
  PENDING = 'PENDING',
  AWAITING_PAYMENT = 'AWAITING_PAYMENT',
  RECEIVED = 'RECEIVED',
  ACCEPTED = 'ACCEPTED',
  PREPARING = 'PREPARING',
  READY = 'READY',
  SERVED = 'SERVED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
  VOIDED = 'VOIDED',
  ON_HOLD = 'ON_HOLD',
}

export interface SelectedModifier {
  modifierId: ID;
  name: string;
  optionIds: ID[];
  optionNames: string[];
  totalPriceDelta: number;
}

export interface OrderItem {
  id: ID;
  orderId: ID;
  menuItemId: ID;
  name: string; // snapshot at time of order
  description?: string;
  unitPrice: number;
  quantity: number;
  selectedModifiers: SelectedModifier[];
  specialInstructions?: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  discountId?: ID;
  kitchenStatus: KitchenStatus;
  preparedAt?: Timestamp;
  servedAt?: Timestamp;
  refunded?: boolean;
  refundedAmount?: number;
  refundReason?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Order {
  id: ID;
  restaurantId: ID;
  branchId: ID;
  orderNumber: string; // Human-readable, e.g. "#10234"
  orderType: OrderType;
  status: OrderStatus;
  customerId?: ID;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  tableId?: ID;
  tableSessionId?: ID;
  tableName?: string;
  employeeId?: ID; // cashier / server
  employeeName?: string; // cashier / server display name snapshot
  deviceId?: ID; // which POS device created it
  sourceChannel: 'POS' | 'QR' | 'WEBSITE' | 'APP' | 'PHONE';
  items: OrderItem[];
  subtotal: number;
  discountAmount: number;
  discountId?: ID;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  balanceDue: number;
  tipAmount?: number;
  notes?: string;
  paymentStatus: PaymentStatus;
  estimatedReadyAt?: Timestamp;
  acceptedAt?: Timestamp;
  startedPreparingAt?: Timestamp;
  readyAt?: Timestamp;
  servedAt?: Timestamp;
  completedAt?: Timestamp;
  cancelledAt?: Timestamp;
  cancelledBy?: ID;
  cancelReason?: string;
  refundedAmount?: number;
  voidedAt?: Timestamp;
  voidedBy?: ID;
  voidReason?: string;
  heldAt?: Timestamp;
  onHoldReason?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ============================================================================
// PAYMENTS
// ============================================================================

export enum PaymentStatus {
  UNPAID = 'UNPAID',
  PENDING = 'PENDING', // online payment in progress
  PARTIALLY_PAID = 'PARTIALLY_PAID',
  PAID = 'PAID',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
}

export enum PaymentMethod {
  CASH = 'CASH',
  CARD_POS = 'CARD_POS', // physical terminal
  BANK_TRANSFER = 'BANK_TRANSFER',
  PAYSTACK = 'PAYSTACK',
  FLUTTERWAVE = 'FLUTTERWAVE',
  WALLET = 'WALLET',
  LOYALTY_POINTS = 'LOYALTY_POINTS',
  VOUCHER = 'VOUCHER',
}

export enum PaymentVerificationType {
  LOCAL = 'LOCAL', // recorded locally by cashier, no provider verification
  PROVIDER = 'PROVIDER', // verified by online payment provider
  SPLIT = 'SPLIT',
}

export interface Payment {
  id: ID;
  restaurantId: ID;
  branchId: ID;
  orderId: ID;
  customerId?: ID;
  employeeId?: ID; // cashier who recorded it
  deviceId?: ID;
  amount: number;
  currency: Currency;
  method: PaymentMethod;
  status: PaymentStatus;
  verificationType: PaymentVerificationType;
  providerTransactionId?: string; // from Paystack/Flutterwave
  providerReference?: string;
  terminalId?: string; // physical POS terminal id
  receiptNumber?: string;
  authorizationCode?: string;
  last4Digits?: string;
  cardBrand?: string;
  notes?: string;
  processedAt?: Timestamp;
  failedAt?: Timestamp;
  failureReason?: string;
  refundedAmount?: number;
  refundedAt?: Timestamp;
  refundReference?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ============================================================================
// KITCHEN
// ============================================================================

export enum KitchenStatus {
  NEW = 'NEW',
  PREPARING = 'PREPARING',
  READY = 'READY',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export interface KitchenDisplayStation {
  id: ID;
  restaurantId: ID;
  branchId: ID;
  name: string; // "Grill", "Fryer", "Cold Bar"
  categoryIds: ID[]; // which menu categories go to this station
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface KitchenOrder {
  id: ID;
  restaurantId: ID;
  branchId: ID;
  orderId: ID;
  orderItemIds: ID[];
  stationId?: ID;
  status: KitchenStatus;
  priority: 'NORMAL' | 'URGENT' | 'LATE';
  notes?: string;
  assignedCookId?: ID;
  startedAt?: Timestamp;
  readyAt?: Timestamp;
  completedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ============================================================================
// INVENTORY
// ============================================================================

export enum InventoryTransactionType {
  PURCHASE = 'PURCHASE',
  WASTAGE = 'WASTAGE',
  ADJUSTMENT = 'ADJUSTMENT',
  PRODUCTION = 'PRODUCTION',
  SALE_DEDUCTION = 'SALE_DEDUCTION',
  TRANSFER_IN = 'TRANSFER_IN',
  TRANSFER_OUT = 'TRANSFER_OUT',
}

export enum Unit {
  PIECE = 'PIECE',
  KG = 'KG',
  G = 'G',
  L = 'L',
  ML = 'ML',
  BOX = 'BOX',
  PACK = 'PACK',
  BOTTLE = 'BOTTLE',
  CAN = 'CAN',
}

export interface InventoryItem {
  id: ID;
  restaurantId: ID;
  branchId: ID;
  sku: string;
  name: string;
  description?: string;
  category?: string;
  unit: Unit;
  currentStock: number;
  minimumStock: number;
  optimalStock?: number;
  costPrice: number;
  supplierId?: ID;
  isActive: boolean;
  lastRestockedAt?: Timestamp;
  lastCountedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Recipe {
  id: ID;
  restaurantId: ID;
  branchId: ID;
  menuItemId: ID;
  name: string;
  servings: number;
  ingredients: {
    inventoryItemId: ID;
    inventoryItemName: string;
    quantity: number;
    unit: Unit;
    costAtRecipeTime?: number;
  }[];
  instructions?: string;
  prepTimeMinutes?: number;
  cookTimeMinutes?: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface InventoryTransaction {
  id: ID;
  restaurantId: ID;
  branchId: ID;
  inventoryItemId: ID;
  type: InventoryTransactionType;
  quantity: number; // positive for in, negative for out
  unitCost?: number;
  totalCost?: number;
  referenceId?: ID; // orderId, purchaseOrderId, etc.
  referenceType?: 'ORDER' | 'PURCHASE' | 'WASTAGE' | 'ADJUSTMENT';
  notes?: string;
  employeeId?: ID;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Supplier {
  id: ID;
  restaurantId: ID;
  branchId: ID;
  name: string;
  contactName?: string;
  phone: string;
  email?: string;
  address?: string;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export enum PurchaseOrderStatus {
  DRAFT = 'DRAFT',
  SENT = 'SENT',
  PARTIALLY_RECEIVED = 'PARTIALLY_RECEIVED',
  RECEIVED = 'RECEIVED',
  CANCELLED = 'CANCELLED',
}

export interface PurchaseOrder {
  id: ID;
  restaurantId: ID;
  branchId: ID;
  supplierId: ID;
  orderNumber: string;
  status: PurchaseOrderStatus;
  items: {
    inventoryItemId: ID;
    quantity: number;
    unitCost: number;
    receivedQuantity: number;
  }[];
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  expectedDate?: Timestamp;
  notes?: string;
  createdBy: ID;
  approvedBy?: ID;
  receivedBy?: ID;
  receivedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ============================================================================
// SHIFTS & CASH MANAGEMENT
// ============================================================================

export enum ShiftStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  MISMATCH = 'MISMATCH',
}

export interface Shift {
  id: ID;
  restaurantId: ID;
  branchId: ID;
  employeeId: ID;
  deviceId: ID;
  status: ShiftStatus;
  openingCash: number;
  expectedCash: number;
  actualCash: number;
  cashVariance: number;
  cardSales: number;
  transferSales: number;
  onlineSales: number;
  totalSales: number;
  totalRefunds: number;
  totalVoids: number;
  totalDiscounts: number;
  totalTips: number;
  cashPaidIn: number;
  cashPaidOut: number;
  openedAt: Timestamp;
  closedAt?: Timestamp;
  closedBy?: ID;
  closingNotes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CashAdjustment {
  id: ID;
  shiftId: ID;
  branchId: ID;
  restaurantId: ID;
  type: 'PAID_IN' | 'PAID_OUT';
  amount: number;
  reason: string;
  employeeId: ID;
  approvedBy?: ID;
  createdAt: Timestamp;
}

// ============================================================================
// DEVICES & SYNC
// ============================================================================

export enum DeviceType {
  POS_TERMINAL = 'POS_TERMINAL',
  KITCHEN_DISPLAY = 'KITCHEN_DISPLAY',
  CUSTOMER_DISPLAY = 'CUSTOMER_DISPLAY',
  MOBILE_ORDERING = 'MOBILE_ORDERING',
}

export interface Device {
  id: ID;
  restaurantId: ID;
  branchId: ID;
  name: string;
  type: DeviceType;
  hardwareId: string; // MAC or motherboard serial
  terminalNumber?: string;
  lastConnectedAt?: Timestamp;
  lastSyncAt?: Timestamp;
  currentSyncStatus: ConnectionStatus;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export enum SyncRecordStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CONFLICT = 'CONFLICT',
  SKIPPED = 'SKIPPED',
}

export enum SyncDirection {
  LOCAL_TO_CLOUD = 'LOCAL_TO_CLOUD',
  CLOUD_TO_LOCAL = 'CLOUD_TO_LOCAL',
}

export enum SyncEntityType {
  ORDER = 'ORDER',
  ORDER_ITEM = 'ORDER_ITEM',
  PAYMENT = 'PAYMENT',
  SHIFT = 'SHIFT',
  KITCHEN_ORDER = 'KITCHEN_ORDER',
  CASH_ADJUSTMENT = 'CASH_ADJUSTMENT',
  TABLE_SESSION = 'TABLE_SESSION',
  MENU_ITEM = 'MENU_ITEM',
  INVENTORY_TRANSACTION = 'INVENTORY_TRANSACTION',
  AUDIT_LOG = 'AUDIT_LOG',
}

export interface SyncRecord {
  id: ID;
  deviceId: ID;
  entityType: SyncEntityType;
  entityId: ID; // the local or cloud entity id
  externalEntityId?: ID; // the matching id on the other side
  direction: SyncDirection;
  status: SyncRecordStatus;
  attemptCount: number;
  lastAttemptAt?: Timestamp;
  completedAt?: Timestamp;
  conflictResolution?: 'LOCAL_WINS' | 'CLOUD_WINS' | 'MANUAL' | 'MERGED';
  errorMessage?: string;
  idempotencyKey: string; // globally unique, prevents duplicate processing
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ============================================================================
// AUDIT
// ============================================================================

export enum AuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  REFUND = 'REFUND',
  VOID = 'VOID',
  DISCOUNT = 'DISCOUNT',
  APPROVE = 'APPROVE',
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  OPEN_SHIFT = 'OPEN_SHIFT',
  CLOSE_SHIFT = 'CLOSE_SHIFT',
  PRICE_CHANGE = 'PRICE_CHANGE',
  STOCK_ADJUST = 'STOCK_ADJUST',
  CASH_PAYIN = 'CASH_PAYIN',
  CASH_PAYOUT = 'CASH_PAYOUT',
}

export interface AuditLog {
  id: ID;
  restaurantId: ID | null;
  branchId: ID | null;
  entityType: string;
  entityId?: ID | null;
  action: AuditAction;
  performedBy: ID; // employeeId
  performedByRole: Role;
  deviceId?: ID | null;
  timestamp: Timestamp;
  ipAddress?: string | null;
  changes?: {
    field: string;
    oldValue?: unknown;
    newValue?: unknown;
  }[];
  metadata?: Record<string, unknown>;
}

// ============================================================================
// RBAC
// ============================================================================

export interface RoleDefinition {
  role: Role;
  permissions: Permission[];
  description?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export enum Permission {
  // Dashboard / reporting
  VIEW_DASHBOARD = 'VIEW_DASHBOARD',
  VIEW_REPORTS = 'VIEW_REPORTS',
  VIEW_FINANCIALS = 'VIEW_FINANCIALS',

  // Menu
  MENU_VIEW = 'MENU_VIEW',
  MENU_CREATE = 'MENU_CREATE',
  MENU_EDIT = 'MENU_EDIT',
  MENU_DELETE = 'MENU_DELETE',
  MENU_CHANGE_PRICE = 'MENU_CHANGE_PRICE',
  MENU_MARK_OOS = 'MENU_MARK_OOS',

  // Orders
  ORDER_VIEW = 'ORDER_VIEW',
  ORDER_CREATE = 'ORDER_CREATE',
  ORDER_EDIT = 'ORDER_EDIT',
  ORDER_CANCEL = 'ORDER_CANCEL',
  ORDER_HOLD = 'ORDER_HOLD',
  ORDER_VOID = 'ORDER_VOID',
  ORDER_REFUND = 'ORDER_REFUND',
  ORDER_DISCOUNT = 'ORDER_DISCOUNT',
  ORDER_DISCOUNT_LARGE = 'ORDER_DISCOUNT_LARGE',
  ORDER_COMPLETE = 'ORDER_COMPLETE',
  ORDER_ACCEPT_ONLINE = 'ORDER_ACCEPT_ONLINE',

  // Payments
  PAYMENT_ACCEPT = 'PAYMENT_ACCEPT',
  PAYMENT_REFUND = 'PAYMENT_REFUND',
  PAYMENT_RECORD_CASH = 'PAYMENT_RECORD_CASH',
  PAYMENT_RECORD_CARD = 'PAYMENT_RECORD_CARD',

  // Kitchen
  KITCHEN_VIEW = 'KITCHEN_VIEW',
  KITCHEN_UPDATE_STATUS = 'KITCHEN_UPDATE_STATUS',

  // Tables
  TABLE_VIEW = 'TABLE_VIEW',
  TABLE_SESSION_OPEN = 'TABLE_SESSION_OPEN',
  TABLE_SESSION_CLOSE = 'TABLE_SESSION_CLOSE',
  TABLE_SESSION_SPLIT = 'TABLE_SESSION_SPLIT',
  TABLE_SESSION_COMBINE = 'TABLE_SESSION_COMBINE',

  // Inventory
  INVENTORY_VIEW = 'INVENTORY_VIEW',
  INVENTORY_CREATE = 'INVENTORY_CREATE',
  INVENTORY_EDIT = 'INVENTORY_EDIT',
  INVENTORY_ADJUST = 'INVENTORY_ADJUST',
  INVENTORY_PURCHASE = 'INVENTORY_PURCHASE',
  INVENTORY_WASTAGE = 'INVENTORY_WASTAGE',

  // Shifts / cash
  SHIFT_OPEN = 'SHIFT_OPEN',
  SHIFT_CLOSE = 'SHIFT_CLOSE',
  SHIFT_VIEW_ALL = 'SHIFT_VIEW_ALL',
  CASH_PAYIN = 'CASH_PAYIN',
  CASH_PAYOUT = 'CASH_PAYOUT',

  // Employees / users
  EMPLOYEE_VIEW = 'EMPLOYEE_VIEW',
  EMPLOYEE_CREATE = 'EMPLOYEE_CREATE',
  EMPLOYEE_EDIT = 'EMPLOYEE_EDIT',
  EMPLOYEE_DELETE = 'EMPLOYEE_DELETE',
  ROLE_ASSIGN = 'ROLE_ASSIGN',

  // Restaurant / branch config
  SETTINGS_VIEW = 'SETTINGS_VIEW',
  SETTINGS_EDIT = 'SETTINGS_EDIT',
  BRANCH_MANAGE = 'BRANCH_MANAGE',

  // Customer
  CUSTOMER_VIEW = 'CUSTOMER_VIEW',
  CUSTOMER_CREATE = 'CUSTOMER_CREATE',
  CUSTOMER_EDIT = 'CUSTOMER_EDIT',

  // Audit
  AUDIT_VIEW = 'AUDIT_VIEW',

  // Approval overwrites (manager PIN)
  APPROVE_REFUND = 'APPROVE_REFUND',
  APPROVE_VOID = 'APPROVE_VOID',
  APPROVE_DISCOUNT = 'APPROVE_DISCOUNT',
  APPROVE_PRICE_CHANGE = 'APPROVE_PRICE_CHANGE',
  APPROVE_CASH_ADJUST = 'APPROVE_CASH_ADJUST',
}

export interface RolePermission {
  role: Role;
  permissions: Permission[];
}

// ============================================================================
// SETTINGS
// ============================================================================

export interface BranchSettings {
  id: ID;
  restaurantId: ID;
  branchId: ID;
  receiptHeader: string;
  receiptFooter: string;
  logoUrlForReceipt?: string;
  enableTips: boolean;
  tipOptions: number[]; // e.g. [5, 10, 15]
  defaultTaxRateId?: ID;
  defaultServiceCharge?: number;
  autoPrintKitchenTickets: boolean;
  autoPrintReceipts: boolean;
  requireCustomerName: boolean;
  requireManagerPinFor: Permission[]; // which actions need approval
  lowStockAlertThreshold: number; // days
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ============================================================================
// SYNC / REAL-TIME
// ============================================================================

export interface SyncQueueItem {
  id: string;
  entityType: SyncEntityType;
  entityId: string;
  payload: unknown;
  direction: SyncDirection;
  idempotencyKey: string;
  attempts: number;
  nextRetryAt: Timestamp;
  status: SyncRecordStatus;
  error?: string;
  createdAt: Timestamp;
}

export interface SyncStatusPayload {
  status: ConnectionStatus;
  pendingCount: number;
  lastSyncAt?: Timestamp;
  errorMessage?: string;
}

// ============================================================================
// REAL-TIME EVENTS (Socket.IO)
// ============================================================================

export type ServerEventMap = {
  // Order events
  'order:new': Order;
  'order:status:changed': { orderId: ID; status: OrderStatus; timestamp: Timestamp };
  'order:item:kitchen:status': {
    orderId: ID;
    orderItemId: ID;
    kitchenStatus: KitchenStatus;
  };
  'order:payment:received': { orderId: ID; paymentId: ID; amount: number };
  'order:updated': Order;
  'order:held': Order;
  'order:voided': { orderId: ID; reason: string };
  'order:refunded': { orderId: ID; amount: number; reason?: string };

  // Kitchen events
  'kitchen:order:new': KitchenOrder;
  'kitchen:order:status': { kitchenOrderId: ID; status: KitchenStatus };

  // Table session events
  'table:session:opened': TableSession;
  'table:session:updated': TableSession;
  'table:session:closed': { tableSessionId: ID; timestamp: Timestamp };

  // Menu events
  'menu:item:status:changed': {
    menuItemId: ID;
    status: MenuItemStatus;
    branchId: ID;
  };
  'menu:item:price:changed': { menuItemId: ID; newPrice: number };

  // Sync events
  'sync:status': SyncStatusPayload;
  'sync:completed': { records: number; timestamp: Timestamp };
  'sync:error': { error: string };

  // Connection
  'device:connected': { deviceId: ID; branchId: ID };
  'device:disconnected': { deviceId: ID; branchId: ID };

  // Shift events
  'shift:opened': Shift;
  'shift:closed': Shift;

  // Manager / approval
  'approval:requested': {
    action: AuditAction;
    entityType: string;
    entityId: ID;
    requestingEmployeeId: ID;
    reason?: string;
  };
};

export type ClientEventMap = {
  // Order actions from POS
  'pos:order:create': { order: Order; idempotencyKey: string };
  'pos:order:status': { orderId: ID; status: OrderStatus };
  'pos:order:kitchen:status': {
    orderItemId: ID;
    status: KitchenStatus;
  };
  'pos:payment:record': { payment: Payment; idempotencyKey: string };
  'pos:order:hold': { orderId: ID; reason?: string };
  'pos:order:unhold': { orderId: ID };
  'pos:order:void': { orderId: ID; reason: string; pin?: string };
  'pos:order:refund': {
    orderId: ID;
    amount: number;
    reason: string;
    pin?: string;
  };

  // Kitchen actions
  'kitchen:order:status': { kitchenOrderId: ID; status: KitchenStatus };

  // Device presence
  'device:presence': {
    deviceId: ID;
    branchId: ID;
    type: DeviceType;
    status: ConnectionStatus;
  };

  // Shift
  'shift:open': { employeeId: ID; deviceId: ID; openingCash: number };
  'shift:close': { shiftId: ID; actualCash: number; notes?: string };

  // Approval response (manager enters PIN)
  'approval:response': {
    requestId: string;
    approved: boolean;
    managerPin: string;
  };

  // Customer display refresh
  'customer:display:order:active': { order: Order };
  'customer:display:promo': { contentId: ID };
};

export type SocketRoom =
  | `branch:${ID}`
  | `restaurant:${ID}`
  | `device:${ID}`
  | `table:${ID}`
  | `employee:${ID}`
  | `kitchen:${ID}`;

// ============================================================================
// PAYMENT PROVIDER ABSTRACTION
// ============================================================================

export interface PaymentProviderConfig {
  provider: 'paystack' | 'flutterwave';
  publicKey: string;
  secretKey: string;
  webhookSecret: string;
  currency: Currency;
  environment: 'test' | 'live';
}

export interface InitializePaymentRequest {
  amount: number;
  currency: Currency;
  email?: string;
  phone?: string;
  fullName?: string;
  reference: string; // idempotency key, our order/payment id
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface InitializePaymentResponse {
  success: boolean;
  authorizationUrl?: string;
  reference: string;
  providerTransactionId?: string;
  accessCode?: string;
  checkoutHtml?: string; // for some providers
  error?: string;
}

export interface VerifyPaymentResponse {
  success: boolean;
  amount: number;
  currency: Currency;
  providerTransactionId: string;
  reference: string;
  status: PaymentStatus;
  paidAt?: Timestamp;
  authorizationCode?: string;
  cardLast4?: string;
  cardBrand?: string;
  customerEmail?: string;
  customerName?: string;
  error?: string;
}

export interface RefundRequest {
  providerTransactionId: string;
  amount: number;
  reason?: string;
}

export interface RefundResponse {
  success: boolean;
  refundReference?: string;
  amount: number;
  refundedAt?: Timestamp;
  status?: string;
  error?: string;
}

export interface WebhookEventPayload {
  provider: string;
  eventType: 'charge.success' | 'charge.failed' | 'refund.processed' | string;
  rawPayload: Record<string, unknown>;
}

export interface PaymentProvider {
  name: string;
  initializePayment(
    request: InitializePaymentRequest
  ): Promise<InitializePaymentResponse>;
  verifyPayment(reference: string): Promise<VerifyPaymentResponse>;
  refundPayment(request: RefundRequest): Promise<RefundResponse>;
  validateWebhookSignature(signature: string, payload: string): boolean;
  parseWebhookEvent(payload: string): WebhookEventPayload;
}
