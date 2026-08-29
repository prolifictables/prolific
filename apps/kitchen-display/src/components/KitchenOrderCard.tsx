'use client';

import React, { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { KitchenStatus, type OrderItem, type OrderType } from '@prolific/shared-types';
import type { KdsKitchenOrder } from '@/lib/store';

interface KitchenOrderCardProps {
  order: KdsKitchenOrder;
  status: KitchenStatus;
  onAction?: (kitchenOrderId: string, nextStatus: KitchenStatus) => void;
}

function getTimeElapsed(createdAt: Date | string): { minutes: number; text: string; isLate: boolean } {
  const created = typeof createdAt === 'string' ? new Date(createdAt) : createdAt;
  const now = new Date();
  const diffMs = now.getTime() - created.getTime();
  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  let text: string;
  if (hours > 0) {
    text = `${hours}h ${mins}m`;
  } else if (minutes === 0) {
    text = 'Just now';
  } else {
    text = `${minutes}m`;
  }

  return {
    minutes,
    text,
    isLate: minutes > 15,
  };
}

function formatOrderType(type: OrderType | string): string {
  switch (type) {
    case 'DINE_IN':
      return 'DINE-IN';
    case 'TAKEAWAY':
      return 'TAKEOUT';
    case 'PICKUP':
      return 'PICKUP';
    case 'DELIVERY':
      return 'DELIVERY';
    case 'QR_ORDER':
      return 'QR ORDER';
    case 'ONLINE':
      return 'ONLINE';
    default:
      return type.toString().replace(/_/g, ' ');
  }
}

function getOrderTypeColor(type: OrderType | string): string {
  switch (type) {
    case 'DINE_IN':
      return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
    case 'TAKEAWAY':
    case 'PICKUP':
      return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
    case 'DELIVERY':
      return 'bg-purple-500/20 text-purple-300 border-purple-500/30';
    case 'QR_ORDER':
      return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
    default:
      return 'bg-slate-500/20 text-slate-300 border-slate-500/30';
  }
}

const KitchenOrderCard: React.FC<KitchenOrderCardProps> = ({
  order,
  status,
  onAction,
}) => {
  const [tick, setTick] = useState(0);
  const [isFlashing, setIsFlashing] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (status === KitchenStatus.NEW) {
      setIsFlashing(true);
      const timer = setTimeout(() => setIsFlashing(false), 600);
      return () => clearTimeout(timer);
    }
  }, [status, order.id]);

  const timeInfo = getTimeElapsed(order.createdAt);
  const isNewLate = status === KitchenStatus.NEW && timeInfo.isLate;
  const isCompleted = status === KitchenStatus.COMPLETED;

  const orderNumber = order.order?.orderNumber || order.id.slice(0, 8).toUpperCase();
  const tableName = order.order?.tableName || null;
  const orderType = order.order?.orderType || 'DINE_IN';
  const items = order.order?.items || [];

  const actionButtonConfig: Record<KitchenStatus, { label: string; next: KitchenStatus; color: string } | null> = {
    [KitchenStatus.NEW]: {
      label: 'Start Preparing',
      next: KitchenStatus.PREPARING,
      color: 'bg-kds-preparing hover:bg-kds-preparing/90 text-white',
    },
    [KitchenStatus.PREPARING]: {
      label: 'Ready',
      next: KitchenStatus.READY,
      color: 'bg-kds-ready hover:bg-kds-ready/90 text-white',
    },
    [KitchenStatus.READY]: {
      label: 'Mark Complete',
      next: KitchenStatus.COMPLETED,
      color: 'bg-kds-completed hover:bg-kds-completed/90 text-white',
    },
    [KitchenStatus.COMPLETED]: null,
    [KitchenStatus.CANCELLED]: null,
  };

  const actionConfig = actionButtonConfig[status];

  return (
    <div
      className={cn(
        'rounded-2xl border bg-kds-card shadow-kds transition-all duration-200',
        'hover:bg-kds-cardHover hover:shadow-kds-lg',
        'min-h-[224px] flex flex-col overflow-hidden',
        isNewLate && 'flash-red',
        isFlashing && 'pulse-beep',
        isCompleted && 'opacity-60',
        'border-kds-border'
      )}
    >
      <div className="px-4 pt-4 pb-3 border-b border-kds-border">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xl font-bold text-kds-textPrimary">
                #{orderNumber}
              </span>
              {tableName && (
                <span className="px-2 py-0.5 rounded-lg text-xs font-semibold bg-kds-accent/20 text-kds-accent border border-kds-accent/30">
                  {tableName}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span
                className={cn(
                  'px-2.5 py-1 rounded-lg text-xs font-semibold border',
                  getOrderTypeColor(orderType)
                )}
              >
                {formatOrderType(orderType)}
              </span>
              {order.priority === 'URGENT' && (
                <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-kds-danger/20 text-kds-danger border border-kds-danger/40 animate-pulse">
                  URGENT
                </span>
              )}
              {order.priority === 'LATE' && (
                <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-kds-danger/20 text-kds-danger border border-kds-danger/40">
                  LATE
                </span>
              )}
            </div>
          </div>
          <div
            className={cn(
              'px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap',
              status === KitchenStatus.NEW && timeInfo.isLate
                ? 'bg-kds-danger text-white animate-pulse'
                : status === KitchenStatus.NEW
                ? 'bg-kds-new/20 text-kds-new border border-kds-new/40'
                : status === KitchenStatus.PREPARING
                ? 'bg-kds-preparing/20 text-kds-preparing border border-kds-preparing/40'
                : status === KitchenStatus.READY
                ? 'bg-kds-ready/20 text-kds-ready border border-kds-ready/40'
                : 'bg-kds-completed/20 text-kds-completed border border-kds-completed/40'
            )}
          >
            {timeInfo.text}
          </div>
        </div>
      </div>

      <div className="flex-1 px-4 py-3 overflow-y-auto scrollbar-thin">
        <ul className="space-y-2.5">
          {items.map((item: OrderItem) => (
            <li key={item.id} className="flex gap-3">
              <span className={cn(
                'flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm',
                'bg-kds-accent/20 text-kds-accent'
              )}>
                {item.quantity}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-kds-textPrimary text-sm leading-snug">
                  {item.name}
                </div>
                {item.selectedModifiers && item.selectedModifiers.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {item.selectedModifiers.map((mod, idx) => (
                      <div key={idx} className="text-xs text-kds-textMuted pl-1">
                        <span className="opacity-70">{mod.name}:</span>{' '}
                        <span>{mod.optionNames.join(', ')}</span>
                      </div>
                    ))}
                  </div>
                )}
                {item.specialInstructions && (
                  <div className="mt-1.5 px-2.5 py-1.5 rounded-lg bg-kds-new/15 border border-kds-new/30">
                    <p className="text-xs font-bold text-kds-new">
                      ⚠ {item.specialInstructions}
                    </p>
                  </div>
                )}
              </div>
            </li>
          ))}
          {items.length === 0 && (
            <li className="text-sm text-kds-textMuted italic py-2">
              No items data
            </li>
          )}
        </ul>
        {order.notes && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-kds-preparing/15 border border-kds-preparing/30">
            <p className="text-xs font-semibold text-kds-preparing">
              📝 {order.notes}
            </p>
          </div>
        )}
      </div>

      {actionConfig && (
        <div className="px-4 pb-4 pt-2">
          <button
            onClick={() => onAction?.(order.id, actionConfig.next)}
            className={cn(
              'w-full min-h-[56px] rounded-xl font-bold text-base',
              'flex items-center justify-center gap-2',
              'transition-all duration-150 active:scale-[0.98]',
              'touch-manipulation select-none',
              actionConfig.color
            )}
          >
            {actionConfig.label}
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
};

export default KitchenOrderCard;
