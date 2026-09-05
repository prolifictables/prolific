// ============================================================================
// BASE TYPES & ENUMS
// ============================================================================
export var Role;
(function (Role) {
    Role["SUPER_ADMIN"] = "SUPER_ADMIN";
    Role["ADMIN"] = "ADMIN";
    Role["MANAGER"] = "MANAGER";
    Role["SUPERVISOR"] = "SUPERVISOR";
    Role["CASHIER"] = "CASHIER";
    Role["KITCHEN"] = "KITCHEN";
    Role["WAITER"] = "WAITER";
    Role["ACCOUNTANT"] = "ACCOUNTANT";
})(Role || (Role = {}));
export var ConnectionStatus;
(function (ConnectionStatus) {
    ConnectionStatus["ONLINE"] = "ONLINE";
    ConnectionStatus["OFFLINE"] = "OFFLINE";
    ConnectionStatus["SYNCHRONIZING"] = "SYNCHRONIZING";
    ConnectionStatus["SYNC_ERROR"] = "SYNC_ERROR";
})(ConnectionStatus || (ConnectionStatus = {}));
// ============================================================================
// MENU & PRODUCTS
// ============================================================================
export var MenuItemStatus;
(function (MenuItemStatus) {
    MenuItemStatus["AVAILABLE"] = "AVAILABLE";
    MenuItemStatus["OUT_OF_STOCK"] = "OUT_OF_STOCK";
    MenuItemStatus["DISABLED"] = "DISABLED";
    MenuItemStatus["SCHEDULED"] = "SCHEDULED";
})(MenuItemStatus || (MenuItemStatus = {}));
export var OrderType;
(function (OrderType) {
    OrderType["DINE_IN"] = "DINE_IN";
    OrderType["TAKEAWAY"] = "TAKEAWAY";
    OrderType["PICKUP"] = "PICKUP";
    OrderType["DELIVERY"] = "DELIVERY";
    OrderType["QR_ORDER"] = "QR_ORDER";
    OrderType["ONLINE"] = "ONLINE";
})(OrderType || (OrderType = {}));
export var TableSessionStatus;
(function (TableSessionStatus) {
    TableSessionStatus["OPEN"] = "OPEN";
    TableSessionStatus["AWAITING_PAYMENT"] = "AWAITING_PAYMENT";
    TableSessionStatus["PARTIALLY_PAID"] = "PARTIALLY_PAID";
    TableSessionStatus["PAID"] = "PAID";
    TableSessionStatus["CLOSED"] = "CLOSED";
})(TableSessionStatus || (TableSessionStatus = {}));
// ============================================================================
// ORDERS
// ============================================================================
export var OrderStatus;
(function (OrderStatus) {
    OrderStatus["PENDING"] = "PENDING";
    OrderStatus["AWAITING_PAYMENT"] = "AWAITING_PAYMENT";
    OrderStatus["RECEIVED"] = "RECEIVED";
    OrderStatus["ACCEPTED"] = "ACCEPTED";
    OrderStatus["PREPARING"] = "PREPARING";
    OrderStatus["READY"] = "READY";
    OrderStatus["SERVED"] = "SERVED";
    OrderStatus["COMPLETED"] = "COMPLETED";
    OrderStatus["CANCELLED"] = "CANCELLED";
    OrderStatus["REFUNDED"] = "REFUNDED";
    OrderStatus["VOIDED"] = "VOIDED";
    OrderStatus["ON_HOLD"] = "ON_HOLD";
})(OrderStatus || (OrderStatus = {}));
// ============================================================================
// PAYMENTS
// ============================================================================
export var PaymentStatus;
(function (PaymentStatus) {
    PaymentStatus["UNPAID"] = "UNPAID";
    PaymentStatus["PENDING"] = "PENDING";
    PaymentStatus["PARTIALLY_PAID"] = "PARTIALLY_PAID";
    PaymentStatus["PAID"] = "PAID";
    PaymentStatus["FAILED"] = "FAILED";
    PaymentStatus["REFUNDED"] = "REFUNDED";
    PaymentStatus["PARTIALLY_REFUNDED"] = "PARTIALLY_REFUNDED";
})(PaymentStatus || (PaymentStatus = {}));
export var PaymentMethod;
(function (PaymentMethod) {
    PaymentMethod["CASH"] = "CASH";
    PaymentMethod["CARD_POS"] = "CARD_POS";
    PaymentMethod["BANK_TRANSFER"] = "BANK_TRANSFER";
    PaymentMethod["PAYSTACK"] = "PAYSTACK";
    PaymentMethod["FLUTTERWAVE"] = "FLUTTERWAVE";
    PaymentMethod["WALLET"] = "WALLET";
    PaymentMethod["LOYALTY_POINTS"] = "LOYALTY_POINTS";
    PaymentMethod["VOUCHER"] = "VOUCHER";
})(PaymentMethod || (PaymentMethod = {}));
export var PaymentVerificationType;
(function (PaymentVerificationType) {
    PaymentVerificationType["LOCAL"] = "LOCAL";
    PaymentVerificationType["PROVIDER"] = "PROVIDER";
    PaymentVerificationType["SPLIT"] = "SPLIT";
})(PaymentVerificationType || (PaymentVerificationType = {}));
// ============================================================================
// KITCHEN
// ============================================================================
export var KitchenStatus;
(function (KitchenStatus) {
    KitchenStatus["NEW"] = "NEW";
    KitchenStatus["PREPARING"] = "PREPARING";
    KitchenStatus["READY"] = "READY";
    KitchenStatus["COMPLETED"] = "COMPLETED";
    KitchenStatus["CANCELLED"] = "CANCELLED";
})(KitchenStatus || (KitchenStatus = {}));
// ============================================================================
// INVENTORY
// ============================================================================
export var InventoryTransactionType;
(function (InventoryTransactionType) {
    InventoryTransactionType["PURCHASE"] = "PURCHASE";
    InventoryTransactionType["WASTAGE"] = "WASTAGE";
    InventoryTransactionType["ADJUSTMENT"] = "ADJUSTMENT";
    InventoryTransactionType["PRODUCTION"] = "PRODUCTION";
    InventoryTransactionType["SALE_DEDUCTION"] = "SALE_DEDUCTION";
    InventoryTransactionType["TRANSFER_IN"] = "TRANSFER_IN";
    InventoryTransactionType["TRANSFER_OUT"] = "TRANSFER_OUT";
})(InventoryTransactionType || (InventoryTransactionType = {}));
export var Unit;
(function (Unit) {
    Unit["PIECE"] = "PIECE";
    Unit["KG"] = "KG";
    Unit["G"] = "G";
    Unit["L"] = "L";
    Unit["ML"] = "ML";
    Unit["BOX"] = "BOX";
    Unit["PACK"] = "PACK";
    Unit["BOTTLE"] = "BOTTLE";
    Unit["CAN"] = "CAN";
})(Unit || (Unit = {}));
export var PurchaseOrderStatus;
(function (PurchaseOrderStatus) {
    PurchaseOrderStatus["DRAFT"] = "DRAFT";
    PurchaseOrderStatus["SENT"] = "SENT";
    PurchaseOrderStatus["PARTIALLY_RECEIVED"] = "PARTIALLY_RECEIVED";
    PurchaseOrderStatus["RECEIVED"] = "RECEIVED";
    PurchaseOrderStatus["CANCELLED"] = "CANCELLED";
})(PurchaseOrderStatus || (PurchaseOrderStatus = {}));
// ============================================================================
// SHIFTS & CASH MANAGEMENT
// ============================================================================
export var ShiftStatus;
(function (ShiftStatus) {
    ShiftStatus["OPEN"] = "OPEN";
    ShiftStatus["CLOSED"] = "CLOSED";
    ShiftStatus["MISMATCH"] = "MISMATCH";
})(ShiftStatus || (ShiftStatus = {}));
// ============================================================================
// DEVICES & SYNC
// ============================================================================
export var DeviceType;
(function (DeviceType) {
    DeviceType["POS_TERMINAL"] = "POS_TERMINAL";
    DeviceType["KITCHEN_DISPLAY"] = "KITCHEN_DISPLAY";
    DeviceType["CUSTOMER_DISPLAY"] = "CUSTOMER_DISPLAY";
    DeviceType["MOBILE_ORDERING"] = "MOBILE_ORDERING";
})(DeviceType || (DeviceType = {}));
export var SyncRecordStatus;
(function (SyncRecordStatus) {
    SyncRecordStatus["PENDING"] = "PENDING";
    SyncRecordStatus["IN_PROGRESS"] = "IN_PROGRESS";
    SyncRecordStatus["COMPLETED"] = "COMPLETED";
    SyncRecordStatus["FAILED"] = "FAILED";
    SyncRecordStatus["CONFLICT"] = "CONFLICT";
    SyncRecordStatus["SKIPPED"] = "SKIPPED";
})(SyncRecordStatus || (SyncRecordStatus = {}));
export var SyncDirection;
(function (SyncDirection) {
    SyncDirection["LOCAL_TO_CLOUD"] = "LOCAL_TO_CLOUD";
    SyncDirection["CLOUD_TO_LOCAL"] = "CLOUD_TO_LOCAL";
})(SyncDirection || (SyncDirection = {}));
export var SyncEntityType;
(function (SyncEntityType) {
    SyncEntityType["ORDER"] = "ORDER";
    SyncEntityType["ORDER_ITEM"] = "ORDER_ITEM";
    SyncEntityType["PAYMENT"] = "PAYMENT";
    SyncEntityType["SHIFT"] = "SHIFT";
    SyncEntityType["KITCHEN_ORDER"] = "KITCHEN_ORDER";
    SyncEntityType["CASH_ADJUSTMENT"] = "CASH_ADJUSTMENT";
    SyncEntityType["TABLE_SESSION"] = "TABLE_SESSION";
    SyncEntityType["MENU_ITEM"] = "MENU_ITEM";
    SyncEntityType["INVENTORY_TRANSACTION"] = "INVENTORY_TRANSACTION";
    SyncEntityType["AUDIT_LOG"] = "AUDIT_LOG";
})(SyncEntityType || (SyncEntityType = {}));
// ============================================================================
// AUDIT
// ============================================================================
export var AuditAction;
(function (AuditAction) {
    AuditAction["CREATE"] = "CREATE";
    AuditAction["UPDATE"] = "UPDATE";
    AuditAction["DELETE"] = "DELETE";
    AuditAction["REFUND"] = "REFUND";
    AuditAction["VOID"] = "VOID";
    AuditAction["DISCOUNT"] = "DISCOUNT";
    AuditAction["APPROVE"] = "APPROVE";
    AuditAction["LOGIN"] = "LOGIN";
    AuditAction["LOGOUT"] = "LOGOUT";
    AuditAction["OPEN_SHIFT"] = "OPEN_SHIFT";
    AuditAction["CLOSE_SHIFT"] = "CLOSE_SHIFT";
    AuditAction["PRICE_CHANGE"] = "PRICE_CHANGE";
    AuditAction["STOCK_ADJUST"] = "STOCK_ADJUST";
    AuditAction["CASH_PAYIN"] = "CASH_PAYIN";
    AuditAction["CASH_PAYOUT"] = "CASH_PAYOUT";
})(AuditAction || (AuditAction = {}));
export var Permission;
(function (Permission) {
    // Dashboard / reporting
    Permission["VIEW_DASHBOARD"] = "VIEW_DASHBOARD";
    Permission["VIEW_REPORTS"] = "VIEW_REPORTS";
    Permission["VIEW_FINANCIALS"] = "VIEW_FINANCIALS";
    // Menu
    Permission["MENU_VIEW"] = "MENU_VIEW";
    Permission["MENU_CREATE"] = "MENU_CREATE";
    Permission["MENU_EDIT"] = "MENU_EDIT";
    Permission["MENU_DELETE"] = "MENU_DELETE";
    Permission["MENU_CHANGE_PRICE"] = "MENU_CHANGE_PRICE";
    Permission["MENU_MARK_OOS"] = "MENU_MARK_OOS";
    // Orders
    Permission["ORDER_VIEW"] = "ORDER_VIEW";
    Permission["ORDER_CREATE"] = "ORDER_CREATE";
    Permission["ORDER_EDIT"] = "ORDER_EDIT";
    Permission["ORDER_CANCEL"] = "ORDER_CANCEL";
    Permission["ORDER_HOLD"] = "ORDER_HOLD";
    Permission["ORDER_VOID"] = "ORDER_VOID";
    Permission["ORDER_REFUND"] = "ORDER_REFUND";
    Permission["ORDER_DELETE"] = "ORDER_DELETE";
    Permission["ORDER_DISCOUNT"] = "ORDER_DISCOUNT";
    Permission["ORDER_DISCOUNT_LARGE"] = "ORDER_DISCOUNT_LARGE";
    Permission["ORDER_COMPLETE"] = "ORDER_COMPLETE";
    Permission["ORDER_ACCEPT_ONLINE"] = "ORDER_ACCEPT_ONLINE";
    // Payments
    Permission["PAYMENT_ACCEPT"] = "PAYMENT_ACCEPT";
    Permission["PAYMENT_REFUND"] = "PAYMENT_REFUND";
    Permission["PAYMENT_RECORD_CASH"] = "PAYMENT_RECORD_CASH";
    Permission["PAYMENT_RECORD_CARD"] = "PAYMENT_RECORD_CARD";
    // Kitchen
    Permission["KITCHEN_VIEW"] = "KITCHEN_VIEW";
    Permission["KITCHEN_UPDATE_STATUS"] = "KITCHEN_UPDATE_STATUS";
    // Tables
    Permission["TABLE_VIEW"] = "TABLE_VIEW";
    Permission["TABLE_SESSION_OPEN"] = "TABLE_SESSION_OPEN";
    Permission["TABLE_SESSION_CLOSE"] = "TABLE_SESSION_CLOSE";
    Permission["TABLE_SESSION_SPLIT"] = "TABLE_SESSION_SPLIT";
    Permission["TABLE_SESSION_COMBINE"] = "TABLE_SESSION_COMBINE";
    // Inventory
    Permission["INVENTORY_VIEW"] = "INVENTORY_VIEW";
    Permission["INVENTORY_CREATE"] = "INVENTORY_CREATE";
    Permission["INVENTORY_EDIT"] = "INVENTORY_EDIT";
    Permission["INVENTORY_ADJUST"] = "INVENTORY_ADJUST";
    Permission["INVENTORY_PURCHASE"] = "INVENTORY_PURCHASE";
    Permission["INVENTORY_WASTAGE"] = "INVENTORY_WASTAGE";
    // Shifts / cash
    Permission["SHIFT_OPEN"] = "SHIFT_OPEN";
    Permission["SHIFT_CLOSE"] = "SHIFT_CLOSE";
    Permission["SHIFT_VIEW_ALL"] = "SHIFT_VIEW_ALL";
    Permission["CASH_PAYIN"] = "CASH_PAYIN";
    Permission["CASH_PAYOUT"] = "CASH_PAYOUT";
    // Employees / users
    Permission["EMPLOYEE_VIEW"] = "EMPLOYEE_VIEW";
    Permission["EMPLOYEE_CREATE"] = "EMPLOYEE_CREATE";
    Permission["EMPLOYEE_EDIT"] = "EMPLOYEE_EDIT";
    Permission["EMPLOYEE_DELETE"] = "EMPLOYEE_DELETE";
    Permission["ROLE_ASSIGN"] = "ROLE_ASSIGN";
    // Restaurant / branch config
    Permission["SETTINGS_VIEW"] = "SETTINGS_VIEW";
    Permission["SETTINGS_EDIT"] = "SETTINGS_EDIT";
    Permission["BRANCH_MANAGE"] = "BRANCH_MANAGE";
    // Customer
    Permission["CUSTOMER_VIEW"] = "CUSTOMER_VIEW";
    Permission["CUSTOMER_CREATE"] = "CUSTOMER_CREATE";
    Permission["CUSTOMER_EDIT"] = "CUSTOMER_EDIT";
    // Audit
    Permission["AUDIT_VIEW"] = "AUDIT_VIEW";
    // Approval overwrites (manager PIN)
    Permission["APPROVE_REFUND"] = "APPROVE_REFUND";
    Permission["APPROVE_VOID"] = "APPROVE_VOID";
    Permission["APPROVE_DISCOUNT"] = "APPROVE_DISCOUNT";
    Permission["APPROVE_PRICE_CHANGE"] = "APPROVE_PRICE_CHANGE";
    Permission["APPROVE_CASH_ADJUST"] = "APPROVE_CASH_ADJUST";
})(Permission || (Permission = {}));
//# sourceMappingURL=index.js.map