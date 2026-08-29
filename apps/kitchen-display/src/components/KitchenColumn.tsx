'use client';

import React from 'react';
import { cn } from '@/lib/cn';
import type { KitchenStatus } from '@prolific/shared-types';
import type { KdsKitchenOrder } from '@/lib/store';
import KitchenOrderCard from './KitchenOrderCard';

interface KitchenColumnProps {
  status: KitchenStatus;
  title: string;
  color: 'new' | 'preparing' | 'ready' | 'completed';
  orders: KdsKitchenOrder[];
  onAction?: (kitchenOrderId: string, nextStatus: KitchenStatus) => void;
}

const colorMap: Record<KitchenColumnProps['color'], { bg: string; text: string; border: string; badge: string }> = {
  new: {
    bg: 'bg-kds-new/10',
    text: 'text-kds-new',
    border: 'border-kds-new/30',
    badge: 'bg-kds-new',
  },
  preparing: {
    bg: 'bg-kds-preparing/10',
    text: 'text-kds-preparing',
    border: 'border-kds-preparing/30',
    badge: 'bg-kds-preparing',
  },
  ready: {
    bg: 'bg-kds-ready/10',
    text: 'text-kds-ready',
    border: 'border-kds-ready/30',
    badge: 'bg-kds-ready',
  },
  completed: {
    bg: 'bg-kds-completed/10',
    text: 'text-kds-completed',
    border: 'border-kds-completed/30',
    badge: 'bg-kds-completed',
  },
};

const KitchenColumn: React.FC<KitchenColumnProps> = ({
  status,
  title,
  color,
  orders,
  onAction,
}) => {
  const colors = colorMap[color];

  return (
    <div className="flex flex-col h-full min-h-0">
      <div
        className={cn(
          'flex items-center justify-between px-4 py-3 rounded-2xl mb-3 border',
          colors.bg,
          colors.border
        )}
      >
        <div className="flex items-center gap-3">
          <h2 className={cn('text-lg font-bold uppercase tracking-wide', colors.text)}>
            {title}
          </h2>
          <span
            className={cn(
              'min-w-[2rem] h-8 px-2 rounded-full flex items-center justify-center text-sm font-bold text-white',
              colors.badge
            )}
          >
            {orders.length}
          </span>
        </div>
      </div>

      <div
        className={cn(
          'flex-1 overflow-y-auto scrollbar-thin rounded-2xl border p-3 space-y-3 min-h-0',
          'bg-kds-card/30',
          colors.border
        )}
      >
        {orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-kds-textMuted">
            <svg className="w-12 h-12 mb-2 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-sm">No orders</p>
          </div>
        ) : (
          orders.map((order) => (
            <KitchenOrderCard
              key={order.id}
              order={order}
              status={status}
              onAction={onAction}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default KitchenColumn;
