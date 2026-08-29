'use client';

import { useEffect, useState } from 'react';
import type { MenuItem, MenuModifier } from '@prolific/shared-types';
import { formatCentsToNgn } from '../../lib/ui-helpers';

interface ModifierModalProps {
  menuItem: MenuItem;
  onClose: () => void;
  onConfirm: (modifiers: { modifierId: string; optionIds: string[] }[]) => void;
}

export default function ModifierModal({ menuItem, onClose, onConfirm }: ModifierModalProps) {
  const [modifiers, setModifiers] = useState<MenuModifier[]>([]);
  const [loading, setLoading] = useState(true);
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const anyItem = menuItem as any;
  const basePriceCents =
    typeof menuItem.price === 'number'
      ? menuItem.price
      : typeof anyItem.price_cents === 'number'
        ? anyItem.price_cents
        : 0;

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        if (window.electronAPI?.db?.menuModifiers?.listForItemId && menuItem.id) {
          const res = await window.electronAPI.db.menuModifiers.listForItemId(menuItem.id);
          if (alive) {
            const list: any[] = Array.isArray(res) ? res : ((res as any)?.data as any[]) || [];
            setModifiers(list as MenuModifier[]);
            const defaults: Record<string, string[]> = {};
            for (const m of list) {
              const defs = (m.options || []).filter((o: any) => o.isDefault).map((o: any) => o.id);
              if (defs.length === 0 && !m.multiSelect && (m.maxSelections ?? 1) === 1 && m.options?.[0]) {
                defaults[m.id] = [m.options[0].id];
              } else {
                defaults[m.id] = defs;
              }
            }
            setSelections(defaults);
          }
        } else if (anyItem.modifiers && Array.isArray(anyItem.modifiers)) {
          if (alive) {
            setModifiers(anyItem.modifiers as MenuModifier[]);
            const defaults: Record<string, string[]> = {};
            for (const m of anyItem.modifiers as any[]) {
              const defs = (m.options || []).filter((o: any) => o.isDefault).map((o: any) => o.id);
              defaults[m.id || m.modifierId] = defs;
            }
            setSelections(defaults);
          }
        } else {
          setModifiers([]);
        }
      } catch (e) {
        console.warn('[modifier] load failed', e);
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [menuItem.id, anyItem.modifiers, anyItem.modifierIds]);

  const toggleOption = (modifierId: string, optionId: string, multiSelect: boolean, maxSelect = 1) => {
    setSelections((prev) => {
      const current = prev[modifierId] ? [...prev[modifierId]] : [];
      if (multiSelect) {
        if (current.includes(optionId)) {
          return { ...prev, [modifierId]: current.filter((id) => id !== optionId) };
        }
        if (maxSelect && current.length >= maxSelect) return prev;
        return { ...prev, [modifierId]: [...current, optionId] };
      }
      return { ...prev, [modifierId]: [optionId] };
    });
  };

  const validate = (): boolean => {
    for (const m of modifiers) {
      const selected = selections[m.id] || [];
      if (m.required) {
        const min = m.minSelections ?? (m.multiSelect ? 1 : 1);
        if (selected.length < min) return false;
      }
    }
    return true;
  };

  const handleConfirm = () => {
    if (!validate()) return;
    const result = modifiers.map((m) => ({
      modifierId: m.id,
      optionIds: selections[m.id] || [],
    }));
    onConfirm(result);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm animate-slide-up">
      <div className="w-full sm:max-w-xl bg-slate-900 border border-amber-400/20 sm:rounded-3xl rounded-t-3xl shadow-glow-restaurant max-h-[92vh] flex flex-col neon-border">
        <div className="p-6 border-b border-white/5 flex items-start justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0">
            <div className="h-16 w-16 rounded-2xl bg-gradient-neon flex items-center justify-center text-3xl shrink-0 ring-2 ring-amber-400/30 shadow-glow-restaurant animate-neon-pulse">
              🍽️
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-white leading-tight">{menuItem.name}</h2>
              {menuItem.description && (
                <p className="text-sm text-slate-400 mt-1 line-clamp-2">{menuItem.description}</p>
              )}
              <div className="mt-2 text-gradient-neon font-black text-lg animate-text-glow">
                {formatCentsToNgn(basePriceCents)}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="btn-ghost !min-h-10 !w-10 !px-0 text-xl shrink-0"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {loading ? (
            <div className="text-center py-12 text-slate-400">Loading modifiers…</div>
          ) : modifiers.length === 0 ? (
            <div className="text-center py-10">
              <div className="text-5xl mb-3">✨</div>
              <div className="text-white font-semibold">No customizations</div>
              <p className="text-slate-400 text-sm mt-1">Tap Confirm to add to order.</p>
            </div>
          ) : (
            modifiers.map((m) => {
              const selected = selections[m.id] || [];
              const max = m.maxSelections ?? (m.multiSelect ? (m.options?.length || 99) : 1);
              const min = m.minSelections ?? (m.required ? 1 : 0);
              const singleSelect = !m.multiSelect;
              return (
                <div key={m.id} className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-white">{m.name}</h3>
                        {m.required ? (
                          <span className="chip !py-0.5 !px-2 bg-rose-500/15 text-rose-300 ring-rose-500/20 ring-1 ring-inset text-[10px] font-bold uppercase">
                            Required
                          </span>
                        ) : (
                          <span className="chip !py-0.5 !px-2 bg-slate-500/10 text-slate-400 ring-slate-500/20 ring-1 ring-inset text-[10px] font-bold uppercase">
                            Optional
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        {singleSelect
                          ? `Choose 1${m.required ? '' : ' — or skip'}`
                          : `Choose ${min}–${max} option${max !== 1 ? 's' : ''}`}
                        {selected.length > 0 && (
                          <span className="ml-2 text-amber-300">
                            · {selected.length} selected
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(m.options || []).map((opt: any) => {
                      const isChecked = selected.includes(opt.id);
                      const deltaCents =
                        typeof opt.priceDelta === 'number'
                          ? opt.priceDelta
                          : typeof opt.price_delta_cents === 'number'
                            ? opt.price_delta_cents
                            : 0;
                      return (
                        <button
                          key={opt.id}
                          onClick={() => toggleOption(m.id, opt.id, m.multiSelect, max)}
                          className={`min-h-14 rounded-2xl p-3 text-left flex items-center justify-between gap-3 transition-all active:scale-[0.98] ring-1 ring-inset ${
                            isChecked
                              ? 'bg-amber-500/15 ring-amber-400/40 text-white shadow-glow-restaurant'
                              : 'bg-white/5 ring-white/10 hover:bg-white/10 text-slate-200'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div
                              className={`h-6 w-6 shrink-0 flex items-center justify-center ring-1 ring-inset ${
                                singleSelect ? 'rounded-full' : 'rounded-md'
                              } ${
                                isChecked
                                  ? 'bg-gradient-neon ring-amber-400/50 text-black'
                                  : 'bg-slate-900/50 ring-white/15'
                              }`}
                            >
                              {isChecked && (
                                <span className="text-xs font-bold">
                                  {singleSelect ? '•' : '✓'}
                                </span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium truncate">{opt.name}</div>
                            </div>
                          </div>
                          {deltaCents !== 0 && (
                            <div
                              className={`chip !py-0.5 !px-2 text-xs font-bold ${
                                deltaCents > 0
                                  ? 'bg-amber-500/10 text-amber-300 ring-amber-500/20 ring-1 ring-inset'
                                  : 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/20 ring-1 ring-inset'
                              }`}
                            >
                              {deltaCents > 0 ? '+' : ''}
                              {formatCentsToNgn(deltaCents)}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="p-6 border-t border-white/5 flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1">
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!validate()}
            className="btn-success flex-[2] text-lg disabled:opacity-50 disabled:cursor-not-allowed min-h-14"
          >
            Confirm · {formatCentsToNgn(basePriceCents)}
          </button>
        </div>
      </div>
    </div>
  );
}
