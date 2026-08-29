'use client';

import { io, Socket } from 'socket.io-client';

let socketInstance: Socket | null = null;

export interface AdminSocketHandlers {
  onOrderNew?: (order: any) => void;
  onOrderStatus?: (payload: { orderId: string; status: string; timestamp: Date }) => void;
  onOrderUpdated?: (order: any) => void;
  onOrderVoided?: (payload: { orderId: string; reason: string }) => void;
  onOrderRefunded?: (payload: { orderId: string; amount: number; reason?: string }) => void;
  onMenuItemStatus?: (payload: { menuItemId: string; status: string; branchId: string }) => void;
  onSyncStatus?: (payload: any) => void;
}

export function getAdminSocket(): Socket | null {
  if (typeof window === 'undefined') return null;
  return socketInstance;
}

export function createAdminSocket(opts?: {
  branchId?: string;
  accessToken?: string;
  handlers?: AdminSocketHandlers;
}): Socket | null {
  if (typeof window === 'undefined') return null;

  const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:4000';

  if (!socketInstance || !socketInstance.connected) {
    socketInstance = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
      auth: {
        token: opts?.accessToken || null,
      },
    });
  }

  const socket = socketInstance;
  const handlers = opts?.handlers || {};

  socket.on('connect', () => {
    if (opts?.branchId) {
      socket.emit('join', `branch:${opts.branchId}`);
    }
  });

  if (handlers.onOrderNew) {
    socket.on('server:order:new', handlers.onOrderNew);
  }
  if (handlers.onOrderStatus) {
    socket.on('server:order:status:changed', handlers.onOrderStatus);
  }
  if (handlers.onOrderUpdated) {
    socket.on('server:order:updated', handlers.onOrderUpdated);
  }
  if (handlers.onOrderVoided) {
    socket.on('server:order:voided', handlers.onOrderVoided);
  }
  if (handlers.onOrderRefunded) {
    socket.on('server:order:refunded', handlers.onOrderRefunded);
  }
  if (handlers.onMenuItemStatus) {
    socket.on('server:menu:item:status:changed', handlers.onMenuItemStatus);
  }
  if (handlers.onSyncStatus) {
    socket.on('server:sync:status', handlers.onSyncStatus);
  }

  return socket;
}

export function disconnectAdminSocket() {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}
