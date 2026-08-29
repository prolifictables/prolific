'use client';

import React, { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import type { KitchenStatus } from '@prolific/shared-types';

interface KdsHeaderProps {
  branchId: string;
  onBranchChange?: (branchId: string) => void;
  station: string;
  onStationChange?: (station: string) => void;
  counts: Record<KitchenStatus, number>;
  onClearCompleted?: () => void;
  onBumpOrders?: () => void;
  connected: boolean;
}

const stations = [
  { id: 'ALL', label: 'All Stations' },
  { id: 'GRILL', label: 'Grill' },
  { id: 'FRYER', label: 'Fryer' },
  { id: 'PASTRY', label: 'Pastry' },
  { id: 'COLD', label: 'Cold Bar' },
  { id: 'EXPEDITE', label: 'Expedite' },
];

const KdsHeader: React.FC<KdsHeaderProps> = ({
  branchId,
  onBranchChange,
  station,
  onStationChange,
  counts,
  onClearCompleted,
  onBumpOrders,
  connected,
}) => {
  const [now, setNow] = useState(new Date());
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showBranchInput, setShowBranchInput] = useState(false);
  const [tempBranch, setTempBranch] = useState(branchId);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (d: Date) => {
    return d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };

  const formatDate = (d: Date) => {
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  };

  const totalOrders = counts.NEW + counts.PREPARING + counts.READY + counts.COMPLETED;

  return (
    <header className="bg-kds-card border-b border-kds-border px-6 py-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-kds-accent to-kds-accentHover flex items-center justify-center shadow-lg">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-kds-textPrimary leading-tight">
                PROLIFIC KDS
              </h1>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'w-2 h-2 rounded-full',
                    connected ? 'bg-kds-ready animate-pulse' : 'bg-kds-danger'
                  )}
                />
                <span className={cn(
                  'text-xs font-medium',
                  connected ? 'text-kds-ready' : 'text-kds-danger'
                )}>
                  {connected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
            </div>
          </div>

          <div className="h-10 w-px bg-kds-border mx-2" />

          <div className="flex flex-col">
            <div className="text-3xl font-bold text-kds-textPrimary tabular-nums tracking-tight">
              {formatTime(now)}
            </div>
            <div className="text-sm text-kds-textMuted">
              {formatDate(now)}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 px-3 py-2 rounded-xl bg-kds-bg/50 border border-kds-border">
            <CountBadge label="NEW" count={counts.NEW} color="bg-kds-new" />
            <CountBadge label="PREP" count={counts.PREPARING} color="bg-kds-preparing" />
            <CountBadge label="READY" count={counts.READY} color="bg-kds-ready" />
            <CountBadge label="DONE" count={counts.COMPLETED} color="bg-kds-completed" />
            <div className="h-6 w-px bg-kds-border mx-1" />
            <div className="px-2">
              <span className="text-xs text-kds-textMuted">Total</span>
              <span className="ml-2 font-bold text-kds-textPrimary">{totalOrders}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setSoundEnabled((s) => !s)}
              className={cn(
                'h-10 px-3 rounded-xl border flex items-center gap-2 text-sm font-medium transition-all',
                soundEnabled
                  ? 'bg-kds-accent/15 border-kds-accent/40 text-kds-accent hover:bg-kds-accent/25'
                  : 'bg-kds-card border-kds-border text-kds-textMuted hover:bg-kds-cardHover'
              )}
              title={soundEnabled ? 'Sound on' : 'Sound off'}
            >
              {soundEnabled ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                </svg>
              )}
            </button>

            <select
              value={station}
              onChange={(e) => onStationChange?.(e.target.value)}
              className="h-10 px-3 rounded-xl bg-kds-card border border-kds-border text-kds-textPrimary text-sm font-medium focus:outline-none focus:border-kds-accent cursor-pointer"
            >
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>

            {showBranchInput ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={tempBranch}
                  onChange={(e) => setTempBranch(e.target.value)}
                  placeholder="Branch ID"
                  className="h-10 px-3 w-40 rounded-xl bg-kds-bg border border-kds-border text-kds-textPrimary text-sm focus:outline-none focus:border-kds-accent"
                />
                <button
                  onClick={() => {
                    onBranchChange?.(tempBranch);
                    setShowBranchInput(false);
                  }}
                  className="h-10 px-3 rounded-xl bg-kds-accent hover:bg-kds-accentHover text-white text-sm font-medium transition-colors"
                >
                  Set
                </button>
                <button
                  onClick={() => {
                    setTempBranch(branchId);
                    setShowBranchInput(false);
                  }}
                  className="h-10 px-3 rounded-xl bg-kds-card hover:bg-kds-cardHover border border-kds-border text-kds-textMuted text-sm font-medium transition-colors"
                >
                  X
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowBranchInput(true)}
                className="h-10 px-4 rounded-xl bg-kds-card border border-kds-border text-kds-textPrimary text-sm font-medium hover:bg-kds-cardHover transition-colors flex items-center gap-2 max-w-[200px]"
                title="Change branch"
              >
                <svg className="w-4 h-4 text-kds-textMuted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="truncate">
                  {branchId ? `Branch: ${branchId.slice(0, 12)}${branchId.length > 12 ? '...' : ''}` : 'Set Branch'}
                </span>
              </button>
            )}

            <button
              onClick={onBumpOrders}
              className="h-10 px-4 rounded-xl bg-kds-preparing/15 border border-kds-preparing/40 text-kds-preparing text-sm font-semibold hover:bg-kds-preparing/25 transition-colors flex items-center gap-2"
              title="Bump all READY → COMPLETED"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
              Bump
            </button>

            <button
              onClick={onClearCompleted}
              className="h-10 px-4 rounded-xl bg-kds-completed/15 border border-kds-completed/40 text-kds-completed text-sm font-semibold hover:bg-kds-completed/25 transition-colors flex items-center gap-2"
              title="Clear all completed orders"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Clear
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};

function CountBadge({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: string;
}) {
  return (
    <div className="flex flex-col items-center px-2 py-1 min-w-[56px]">
      <span className="text-[10px] font-bold uppercase tracking-wider text-kds-textMuted">
        {label}
      </span>
      <span
        className={cn(
          'mt-0.5 min-w-[28px] h-7 px-2 rounded-lg flex items-center justify-center text-sm font-bold text-white',
          color
        )}
      >
        {count}
      </span>
    </div>
  );
}

export default KdsHeader;
