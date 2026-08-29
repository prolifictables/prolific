export type CashierCartLine = {
  lineId: string;
  menuItem: any;
  quantity: number;
  notes?: string;
  modifiers: { modifierId: string; optionIds: string[] }[];
  perUnitPriceCents: number;
  subtotalCents: number;
};

export type ConnectionPillState = {
  status: 'ONLINE' | 'OFFLINE' | 'SYNCHRONIZING' | 'SYNC_ERROR';
  pendingCount: number;
  failedCount: number;
  lastSuccessfulAt?: number;
};

export type OpenShiftState = {
  shiftId: string | null;
  openedAt: number | null;
  openingCashCents: number | null;
};

export type LoginMode = 'ONLINE' | 'OFFLINE_PIN';
