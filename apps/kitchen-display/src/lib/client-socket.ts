'use client';

import { io, Socket } from 'socket.io-client';
import { KitchenStatus, type KitchenOrder } from '@prolific/shared-types';

let socketInstance: Socket | null = null;

export interface KdsSocketHandlers {
  onKitchenOrderNew?: (kitchenOrder: KitchenOrder) => void;
  onKitchenOrderStatus?: (payload: { kitchenOrderId: string; status: KitchenStatus }) => void;
  onOrderNew?: (order: any) => void;
  onOrderStatus?: (payload: { orderId: string; status: string; timestamp: Date }) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

export function getKdsSocket(): Socket | null {
  if (typeof window === 'undefined') return null;
  return socketInstance;
}

export function connectKdsSocket(opts?: {
  branchId: string;
  token?: string | null;
  deviceId: string;
  station?: string;
  handlers?: KdsSocketHandlers;
}): Socket | null {
  if (typeof window === 'undefined') return null;

  const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:4000';
  const station = opts?.station || 'ALL';

  if (!socketInstance || !socketInstance.connected) {
    socketInstance = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
      auth: {
        token: opts?.token || null,
        deviceId: opts?.deviceId,
        station,
      },
    });
  }

  const socket = socketInstance;
  const handlers = opts?.handlers || {};

  socket.on('connect', () => {
    if (opts?.branchId) {
      socket.emit('join', `branch:${opts.branchId}`);
    }
    socket.emit('join', `kitchen-station:${station}`);
    handlers.onConnect?.();
  });

  socket.on('disconnect', () => {
    handlers.onDisconnect?.();
  });

  if (handlers.onKitchenOrderNew) {
    socket.on('server:kitchen:order:new', handlers.onKitchenOrderNew);
  }
  if (handlers.onKitchenOrderStatus) {
    socket.on('server:kitchen:order:status', handlers.onKitchenOrderStatus);
    socket.on('server:kitchen:status', handlers.onKitchenOrderStatus);
  }
  if (handlers.onOrderNew) {
    socket.on('server:order:new', handlers.onOrderNew);
  }
  if (handlers.onOrderStatus) {
    socket.on('server:order:status:changed', handlers.onOrderStatus);
    socket.on('server:order:status', handlers.onOrderStatus);
  }

  return socket;
}

export function disconnectKdsSocket() {
  if (socketInstance) {
    socketInstance.removeAllListeners();
    socketInstance.disconnect();
    socketInstance = null;
  }
}

export function emitKitchenStatus(
  socket: Socket | null,
  kitchenOrderId: string,
  status: KitchenStatus
) {
  if (!socket || !socket.connected) return;
  socket.emit('client:kitchen:status', { kitchenOrderId, status });
  socket.emit('kitchen:order:status', { kitchenOrderId, status });
}
