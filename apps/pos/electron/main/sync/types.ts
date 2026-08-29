export type ConnectionStatus =
  | 'ONLINE'
  | 'OFFLINE'
  | 'SYNCHRONIZING'
  | 'SYNC_ERROR';

export type SyncEntityType =
  | 'MENU_CATEGORY'
  | 'MENU_ITEM'
  | 'MENU_MODIFIER'
  | 'TAX'
  | 'DISCOUNT'
  | 'TABLE'
  | 'CUSTOMER'
  | 'ORDER'
  | 'ORDER_ITEM'
  | 'ORDER_ITEM_MODIFIER_OPTION'
  | 'PAYMENT'
  | 'SHIFT'
  | 'CASH_ADJUSTMENT'
  | 'KITCHEN_ORDER'
  | 'KITCHEN_ORDER_ITEM'
  | 'INVENTORY_ITEM'
  | 'INVENTORY_TRANSACTION'
  | 'RECIPE'
  | 'RECIPE_INGREDIENT'
  | 'SETTING'
  | 'EMPLOYEE'
  | 'QR_CODE';

export type SyncOperation = 'CREATE' | 'UPDATE' | 'DELETE' | 'UPSERT';

export type SyncQueueCommandStatus =
  | 'QUEUED'
  | 'PROCESSING'
  | 'RETRYING'
  | 'FAILED'
  | 'DONE';

export type SyncConflictResolution = 'LOCAL_WINS' | 'SERVER_WINS' | 'MANUAL';

export interface SyncCommand {
  opId: string;
  entityType: SyncEntityType;
  operation: SyncOperation;
  entityId: string;
  payload: any;
  idempotencyKey: string;
  localEntityVersion: number;
}

export interface SyncCommandResult {
  opId: string;
  status: 'SUCCESS' | 'CONFLICT' | 'FAILED' | 'IDEMPOTENT_HIT';
  serverEntityVersion?: number;
  conflictResolution?: SyncConflictResolution;
  errorMessage?: string;
  responseSnapshot?: any;
}

export interface SyncBatchResult {
  results: SyncCommandResult[];
}

export interface PullParams {
  entityTypes: SyncEntityType[];
  cursor?: string;
  limit?: number;
  branchId: string;
}

export interface PullResponse {
  data: Array<{
    __op: SyncOperation;
    __entityType: SyncEntityType;
    id: string;
    [key: string]: any;
  }>;
  meta: {
    cursor?: string;
    hasMore: boolean;
  };
}
