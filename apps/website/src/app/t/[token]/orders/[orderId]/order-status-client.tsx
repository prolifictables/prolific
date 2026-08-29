'use client';

import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { createClientSocket, disconnectClientSocket, getClientSocket } from '../../../../../lib/client-socket';
import { StatusPillar } from '../../../../../components/StatusPillar';

type LiveStatusState = {
  status: string;
  paymentStatus?: string;
};

const LiveOrderStatusContext = createContext<LiveStatusState | null>(null);

function useLiveOrderStatus(): LiveStatusState {
  const ctx = useContext(LiveOrderStatusContext);
  if (!ctx) {
    throw new Error('useLiveOrderStatus must be used within OrderStatusClient');
  }
  return ctx;
}

export default function OrderStatusClient({
  initialStatus,
  initialPaymentStatus,
  orderId,
  children,
}: {
  initialStatus: string;
  orderId: string;
  children: ReactNode;
  initialPaymentStatus?: string;
}) {
  const [state, setState] = useState<LiveStatusState>(() => ({
    status: initialStatus,
    paymentStatus: initialPaymentStatus,
  }));

  const room = useMemo(() => `order:${orderId}`, [orderId]);

  useEffect(() => {
    let closed = false;
    if (typeof window === 'undefined') return;
    const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

    const applyUpdate = (payload: any) => {
      if (closed) return;
      const updatedId = payload?.orderId || payload?._id || payload?.id;
      if (updatedId && updatedId !== orderId) return;

      setState((prev) => ({
        status: payload?.status ? String(payload.status) : prev.status,
        paymentStatus: payload?.paymentStatus
          ? String(payload.paymentStatus)
          : prev.paymentStatus,
      }));
    };

    const onNewOrder = (payload: any) => {
      const updatedId = payload?.orderId || payload?._id || payload?.id;
      if (!updatedId || updatedId !== orderId) return;
      applyUpdate(payload);
    };

    createClientSocket({
      rooms: [room],
      onOrderStatus: applyUpdate,
      onOrderNew: onNewOrder,
      onOrderCustomer: applyUpdate,
    });

    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/public/orders/${orderId}`, { cache: 'no-store' });
        const json = await res.json().catch(() => null);
        if (!res.ok) return;
        const data = json?.data;
        if (!data) return;
        setState((prev) => ({
          status: data.status ? String(data.status) : prev.status,
          paymentStatus: data.paymentStatus ? String(data.paymentStatus) : prev.paymentStatus,
        }));
      } catch {
      }
    };

    const pollInterval = setInterval(() => {
      if (closed) return;
      void poll();
    }, 4500);
    void poll();

    return () => {
      closed = true;
      clearInterval(pollInterval);
      disconnectClientSocket();
    };
  }, [orderId, room]);

  return (
    <LiveOrderStatusContext.Provider value={state}>
      {children}
    </LiveOrderStatusContext.Provider>
  );
}

export function LiveStatusPillar() {
  const { status, paymentStatus } = useLiveOrderStatus();
  return <StatusPillar status={status} paymentStatus={paymentStatus} />;
}

export function LiveWhenCompleted({ children }: { children: ReactNode }) {
  const { status } = useLiveOrderStatus();
  if (status !== 'COMPLETED' && status !== 'SERVED') return null;
  return <>{children}</>;
}

export function LiveReconnectGuard({ orderId }: { orderId: string }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      const s = getClientSocket();
      if (s && !s.connected) {
        s.connect();
        s.emit('join', `order:${orderId}`);
      }
      setTick((t) => t + 1);
    }, 10000);
    return () => clearInterval(interval);
  }, [orderId]);
  return null;
}
