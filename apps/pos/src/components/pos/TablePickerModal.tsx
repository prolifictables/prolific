'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Table } from '@prolific/shared-types';

interface TablePickerModalProps {
  onClose: () => void;
  onSelect: (tableId: string, tableName: string) => void;
  selectedTableId?: string;
}

export default function TablePickerModal({
  onClose,
  onSelect,
  selectedTableId,
}: TablePickerModalProps) {
  const [tables, setTables] = useState<Table[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeZone, setActiveZone] = useState<string>('ALL');
  const [occupiedMap, setOccupiedMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await window.electronAPI?.db?.tables?.list();
        if (!alive) return;
        const list: Table[] = Array.isArray(res)
          ? res
          : ((res as any)?.data as Table[]) || [];
        setTables(list);

        const occ: Record<string, boolean> = {};
        await Promise.all(
          list.map(async (t) => {
            try {
              const orders = await window.electronAPI?.db?.orders?.listByTableId?.(t.id);
              const arr = Array.isArray(orders) ? orders : (orders as any)?.data || [];
              const openOnes = arr.filter(
                (o: any) =>
                  o.status !== 'COMPLETED' &&
                  o.status !== 'CANCELLED' &&
                  o.status !== 'VOIDED' &&
                  o.status !== 'REFUNDED'
              );
              occ[t.id] = openOnes.length > 0;
            } catch {
              occ[t.id] = false;
            }
          })
        );
        if (alive) setOccupiedMap(occ);
      } catch (e) {
        console.warn('[tables] load failed', e);
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, []);

  const zones = useMemo(() => {
    const set = new Set<string>();
    for (const t of tables) {
      if (t.zone) set.add(t.zone);
      if (t.floor) set.add(t.floor);
    }
    return ['ALL', ...Array.from(set)];
  }, [tables]);

  const filteredTables = useMemo(() => {
    if (activeZone === 'ALL') return tables;
    return tables.filter((t) => t.zone === activeZone || t.floor === activeZone);
  }, [tables, activeZone]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-slide-up">
      <div className="w-full max-w-4xl max-h-[90vh] bg-slate-900 border border-white/10 rounded-3xl shadow-glow flex flex-col">
        <div className="p-6 border-b border-white/5 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-white">Select a table</h2>
            <p className="text-sm text-slate-400 mt-0.5">
              {tables.length} tables ·{' '}
              {Object.values(occupiedMap).filter(Boolean).length} occupied
            </p>
          </div>
          <button
            onClick={onClose}
            className="btn-ghost !min-h-10 !w-10 !px-0 text-xl"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="px-6 pt-4 pb-2 flex gap-2 overflow-x-auto">
          {zones.map((z) => (
            <button
              key={z}
              onClick={() => setActiveZone(z)}
              className={`shrink-0 min-h-10 px-5 rounded-full text-sm font-semibold transition-all active:scale-[0.97] ${
                activeZone === z
                  ? 'bg-indigo-600 text-white shadow-soft'
                  : 'bg-white/5 text-slate-300 ring-1 ring-inset ring-white/10 hover:bg-white/10'
              }`}
            >
              {z === 'ALL' ? '🏢 All zones' : `📍 ${z}`}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="text-center py-16 text-slate-400">Loading tables…</div>
          ) : filteredTables.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-5xl mb-3">🪑</div>
              <div className="text-white font-semibold">No tables in this zone</div>
              <p className="text-slate-400 text-sm mt-1">
                Add tables in the admin back-office.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-4">
              {filteredTables.map((t) => {
                const occupied = !!occupiedMap[t.id];
                const selected = t.id === selectedTableId;
                return (
                  <button
                    key={t.id}
                    onClick={() => onSelect(t.id, t.name)}
                    className={`rounded-2xl p-4 text-left transition-all active:scale-[0.97] ring-1 ring-inset ${
                      selected
                        ? 'bg-emerald-600/20 ring-emerald-500/50 shadow-soft'
                        : occupied
                        ? 'bg-rose-500/10 ring-rose-500/30 hover:bg-rose-500/20'
                        : 'bg-white/5 ring-white/10 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="text-white font-bold text-lg">{t.name}</div>
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${
                          occupied ? 'bg-rose-400' : 'bg-blue-400'
                        } ${!occupied ? 'animate-pulse-soft' : ''}`}
                      />
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span>👥 {t.capacity || 2}</span>
                      <span>·</span>
                      <span
                        className={`font-semibold ${
                          occupied ? 'text-rose-300' : 'text-blue-300'
                        }`}
                      >
                        {occupied ? 'Occupied' : 'Available'}
                      </span>
                    </div>
                    {(t.zone || t.floor) && (
                      <div className="mt-2 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                        {t.zone || t.floor}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-6 border-t border-white/5 flex justify-end">
          <button onClick={onClose} className="btn-secondary">
            Close without table
          </button>
        </div>
      </div>
    </div>
  );
}
