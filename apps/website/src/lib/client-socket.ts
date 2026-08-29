'use client';

import { io, Socket } from 'socket.io-client';

let socketInstance: Socket | null = null;

export function getClientSocket(): Socket | null {
  if (typeof window === 'undefined') return null;
  return socketInstance;
}

export function createClientSocket(opts?: {
  guestToken?: string | null;
  tableId?: string;
  sessionId?: string;
  rooms?: string[];
  onOrderStatus?: (payload: any) => void;
  onOrderNew?: (payload: any) => void;
  onOrderCustomer?: (payload: any) => void;
}): Socket | null {
  if (typeof window === 'undefined') return null;

  const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:4000';

  if (!socketInstance || !socketInstance.connected) {
    socketInstance = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
      auth: {
        token: null,
        guestToken: opts?.guestToken || null,
      },
    });
  }

  const socket = socketInstance;

  socket.off('connect');
  socket.on('connect', () => {
    if (opts?.tableId) {
      socket.emit('join', `table:${opts.tableId}`);
    }
    if (opts?.sessionId) {
      socket.emit('join', `table-session:${opts.sessionId}`);
    }
    (opts?.rooms || []).forEach((room) => {
      if (!room) return;
      socket.emit('join', room);
    });
  });

  if (socket.connected) {
    if (opts?.tableId) {
      socket.emit('join', `table:${opts.tableId}`);
    }
    if (opts?.sessionId) {
      socket.emit('join', `table-session:${opts.sessionId}`);
    }
    (opts?.rooms || []).forEach((room) => {
      if (!room) return;
      socket.emit('join', room);
    });
  }

  if (opts?.onOrderStatus) {
    socket.off('server:order:status');
    socket.on('server:order:status', opts.onOrderStatus);
  }
  if (opts?.onOrderNew) {
    socket.off('server:order:new');
    socket.on('server:order:new', opts.onOrderNew);
  }
  if (opts?.onOrderCustomer) {
    socket.off('server:order:customer');
    socket.on('server:order:customer', opts.onOrderCustomer);
  }

  return socket;
}

export function disconnectClientSocket() {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}
