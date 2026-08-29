'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useKdsStore, type KdsKitchenOrder } from '@/lib/store';
import { connectKdsSocket, disconnectKdsSocket, emitKitchenStatus, getKdsSocket } from '@/lib/client-socket';
import { apiGet, apiPatch } from '@/lib/api';
import { KitchenStatus, type KitchenOrder, type Order } from '@prolific/shared-types';
import KdsHeader from '@/components/KdsHeader';
import KitchenColumn from '@/components/KitchenColumn';

interface KdsClientProps {
  branchId: string;
  kdsToken: string | null;
}

const STATUSES: { status: KitchenStatus; title: string; color: 'new' | 'preparing' | 'ready' | 'completed' }[] = [
  { status: KitchenStatus.NEW, title: 'NEW', color: 'new' },
  { status: KitchenStatus.PREPARING, title: 'PREPARING', color: 'preparing' },
  { status: KitchenStatus.READY, title: 'READY', color: 'ready' },
  { status: KitchenStatus.COMPLETED, title: 'COMPLETED', color: 'completed' },
];

const COMPLETED_AUTO_HIDE_MS = 60 * 60 * 1000;

export default function KdsClient({ branchId: initialBranchId, kdsToken }: KdsClientProps) {
  const {
    kitchenOrders,
    station,
    deviceId,
    setBranchId,
    setStation,
    addKitchenOrder,
    updateKitchenOrder,
    updateKitchenOrderStatus,
    clearCompleted,
    setKitchenOrders,
    getOrdersByStatus,
  } = useKdsStore();

  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchedBranchRef = useRef<string>('');

  const effectiveBranchId = useKdsStore((s) => s.branchId) || initialBranchId;

  useEffect(() => {
    if (effectiveBranchId && effectiveBranchId !== fetchedBranchRef.current) {
      setBranchId(effectiveBranchId);
      void fetchInitialOrders(effectiveBranchId);
    }
  }, [effectiveBranchId]);

  const fetchInitialOrders = useCallback(
    async (bId: string) => {
      if (!bId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        fetchedBranchRef.current = bId;
        const params = new URLSearchParams({
          statuses: 'NEW,PREPARING,READY,COMPLETED',
          branchId: bId,
        });
        let ordersList: Order[] = [];
        let kitchenOrdersList: KitchenOrder[] = [];
        try {
          ordersList = await apiGet<Order[]>(`/orders?${params.toString()}`, {
            token: kdsToken || undefined,
          });
        } catch (_e) {
          ordersList = [];
        }
        try {
          kitchenOrdersList = await apiGet<KitchenOrder[]>(
            `/kitchenOrders?${params.toString()}`,
            { token: kdsToken || undefined }
          );
        } catch (_e) {
          kitchenOrdersList = [];
        }
        const orderById = new Map<string, Order>();
        ordersList.forEach((o) => orderById.set(o.id, o));
        let merged: KdsKitchenOrder[];
        if (kitchenOrdersList.length > 0) {
          merged = kitchenOrdersList.map((ko) => ({
            ...ko,
            order: orderById.get(ko.orderId),
          }));
        } else {
          merged = ordersList
            .filter((o) => o.items && o.items.length > 0)
            .map((o, idx) => ({
              id: `ko-${o.id}-${idx}`,
              restaurantId: o.restaurantId,
              branchId: o.branchId,
              orderId: o.id,
              orderItemIds: o.items.map((i) => i.id),
              stationId: undefined,
              status: inferStatusFromOrder(o.status) as KitchenStatus,
              priority: 'NORMAL',
              notes: o.notes,
              assignedCookId: undefined,
              startedAt: o.startedPreparingAt,
              readyAt: o.readyAt,
              completedAt: o.completedAt,
              createdAt: o.createdAt,
              updatedAt: o.updatedAt,
              order: o,
            }));
        }
        const now = Date.now();
        merged = merged.filter((ko) => {
          if (ko.status === 'COMPLETED' && ko.completedAt) {
            return now - new Date(ko.completedAt).getTime() < COMPLETED_AUTO_HIDE_MS;
          }
          return true;
        });
        setKitchenOrders(merged);
      } catch (e: any) {
        console.error('Failed to fetch initial orders:', e);
        setError(e?.message || 'Failed to load orders');
        setKitchenOrders([]);
      } finally {
        setLoading(false);
      }
    },
    [kdsToken, setKitchenOrders]
  );

  useEffect(() => {
    if (!effectiveBranchId) return;
    const socket = connectKdsSocket({
      branchId: effectiveBranchId,
      token: kdsToken,
      deviceId,
      station,
      handlers: {
        onConnect: () => setConnected(true),
        onDisconnect: () => setConnected(false),
        onKitchenOrderNew: (ko: KitchenOrder) => {
          void (async () => {
            try {
              const order = ko.orderId
                ? await apiGet<Order>(`/orders/${ko.orderId}`, { token: kdsToken || undefined }).catch(
                    () => undefined
                  )
                : undefined;
              addKitchenOrder({ ...ko, order });
              playBeep();
            } catch {
              addKitchenOrder(ko);
              playBeep();
            }
          })();
        },
        onKitchenOrderStatus: (payload: { kitchenOrderId: string; status: KitchenStatus }) => {
          updateKitchenOrderStatus(payload.kitchenOrderId, payload.status);
        },
        onOrderNew: (order: Order) => {
          const koId = `ko-${order.id}-auto`;
          const ko: KdsKitchenOrder = {
            id: koId,
            restaurantId: order.restaurantId,
            branchId: order.branchId,
            orderId: order.id,
            orderItemIds: order.items?.map((i) => i.id) || [],
            stationId: undefined,
            status: KitchenStatus.NEW,
            priority: 'NORMAL',
            notes: order.notes,
            createdAt: order.createdAt,
            updatedAt: order.updatedAt,
            order,
          };
          addKitchenOrder(ko);
          playBeep();
        },
      },
    });
    return () => {
      if (socket) {
        socket.off('connect');
        socket.off('disconnect');
      }
    };
  }, [effectiveBranchId, station, deviceId, kdsToken, addKitchenOrder, updateKitchenOrderStatus]);

  useEffect(() => {
    return () => {
      disconnectKdsSocket();
    };
  }, []);

  const handleAction = useCallback(
    async (kitchenOrderId: string, nextStatus: KitchenStatus) => {
      const order = kitchenOrders.find((o) => o.id === kitchenOrderId);
      if (!order) return;
      updateKitchenOrderStatus(kitchenOrderId, nextStatus);
      try {
        const socket = getKdsSocket();
        emitKitchenStatus(socket, kitchenOrderId, nextStatus);
        try {
          await apiPatch(
            `/kitchenOrders/${kitchenOrderId}/status`,
            { status: nextStatus },
            { token: kdsToken || undefined }
          );
        } catch (_apiErr) {
          // Ignore API errors; socket may handle it
        }
        const now = new Date();
        const updates: Partial<KdsKitchenOrder> = {};
        if (nextStatus === KitchenStatus.PREPARING) updates.startedAt = now;
        if (nextStatus === KitchenStatus.READY) updates.readyAt = now;
        if (nextStatus === KitchenStatus.COMPLETED) updates.completedAt = now;
        if (Object.keys(updates).length > 0) {
          updateKitchenOrder(kitchenOrderId, updates);
        }
      } catch (e: any) {
        console.error('Failed to update kitchen status:', e);
      }
    },
    [kitchenOrders, kdsToken, updateKitchenOrder, updateKitchenOrderStatus]
  );

  const handleClearCompleted = useCallback(() => {
    clearCompleted();
  }, [clearCompleted]);

  const handleBumpOrders = useCallback(async () => {
    const readyOrders = getOrdersByStatus(KitchenStatus.READY);
    for (const ko of readyOrders) {
      handleAction(ko.id, KitchenStatus.COMPLETED);
      await new Promise((r) => setTimeout(r, 50));
    }
  }, [getOrdersByStatus, handleAction]);

  const counts = useMemo<Record<KitchenStatus, number>>(() => {
    return {
      [KitchenStatus.NEW]: getOrdersByStatus(KitchenStatus.NEW).length,
      [KitchenStatus.PREPARING]: getOrdersByStatus(KitchenStatus.PREPARING).length,
      [KitchenStatus.READY]: getOrdersByStatus(KitchenStatus.READY).length,
      [KitchenStatus.COMPLETED]: getOrdersByStatus(KitchenStatus.COMPLETED).length,
      [KitchenStatus.CANCELLED]: 0,
    };
  }, [getOrdersByStatus]);

  if (!effectiveBranchId) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-kds-card border border-kds-border rounded-3xl p-8 shadow-kds-lg">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-kds-accent to-kds-accentHover flex items-center justify-center mb-5">
              <svg className="w-9 h-9 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-kds-textPrimary mb-2">
              Kitchen Display System
            </h1>
            <p className="text-kds-textMuted mb-6">
              To get started, append a <code className="px-2 py-0.5 bg-kds-bg rounded text-kds-accent">?branchId=YOUR_BRANCH_ID</code> query parameter to the URL.
            </p>
            <div className="text-sm text-kds-textMuted bg-kds-bg/50 rounded-xl p-4 border border-kds-border">
              <p className="font-semibold text-kds-textPrimary mb-1">Example URL:</p>
              <code className="block text-xs break-all">
                http://localhost:3003/?branchId=branch-abc123
              </code>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-kds-bg">
      <KdsHeader
        branchId={effectiveBranchId}
        onBranchChange={(newId) => {
          setBranchId(newId);
          fetchedBranchRef.current = '';
        }}
        station={station}
        onStationChange={setStation}
        counts={counts}
        onClearCompleted={handleClearCompleted}
        onBumpOrders={handleBumpOrders}
        connected={connected}
      />

      {error && (
        <div className="bg-kds-danger/10 border-b border-kds-danger/30 px-6 py-3">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-kds-danger flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="text-kds-danger text-sm font-medium">{error}</span>
            <button
              onClick={() => void fetchInitialOrders(effectiveBranchId)}
              className="ml-auto px-3 py-1.5 rounded-lg text-xs font-semibold bg-kds-danger/20 text-kds-danger border border-kds-danger/40 hover:bg-kds-danger/30 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-4 border-kds-accent/30 border-t-kds-accent rounded-full animate-spin" />
            <p className="text-kds-textMuted text-sm">Loading orders...</p>
          </div>
        </div>
      ) : (
        <main className="flex-1 p-4 lg:p-6 min-h-0">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 lg:gap-5 h-full">
            {STATUSES.map(({ status, title, color }) => (
              <KitchenColumn
                key={status}
                status={status}
                title={title}
                color={color}
                orders={getOrdersByStatus(status)}
                onAction={handleAction}
              />
            ))}
          </div>
        </main>
      )}
    </div>
  );
}

function inferStatusFromOrder(orderStatus: string): KitchenStatus {
  switch (orderStatus) {
    case 'RECEIVED':
    case 'ACCEPTED':
      return KitchenStatus.NEW;
    case 'PREPARING':
      return KitchenStatus.PREPARING;
    case 'READY':
    case 'SERVED':
      return KitchenStatus.READY;
    case 'COMPLETED':
      return KitchenStatus.COMPLETED;
    case 'CANCELLED':
    case 'VOIDED':
    case 'REFUNDED':
      return KitchenStatus.CANCELLED;
    default:
      return KitchenStatus.NEW;
  }
}

function playBeep() {
  try {
    if (typeof window === 'undefined') return;
    const AudioCtx =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (_e) {
    // noop
  }
}
