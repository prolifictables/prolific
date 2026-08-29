'use client';

import { useEffect, useState } from 'react';
import { cn } from '@prolific/utils';
import { Button, IconButton } from './ui/Button';
import { Badge } from './ui/Badge';
import { Textarea } from './ui/Input';

export interface ModifierOption {
  id: string;
  name: string;
  priceDeltaCents: number;
  isDefault?: boolean;
}

export interface MenuModifierGroup {
  id: string;
  name: string;
  required: boolean;
  multiSelect: boolean;
  minSelections: number;
  maxSelections: number;
  options: ModifierOption[];
}

interface ModifierSheetProps {
  open: boolean;
  onClose: () => void;
  itemName: string;
  basePriceCents: number;
  modifiers: MenuModifierGroup[];
  onConfirm: (selections: { modifierId: string; optionId: string }[], specialInstructions?: string) => void;
}

function formatNGN(amountCents: number) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
  }).format(amountCents / 100);
}

export function ModifierSheet({
  open,
  onClose,
  itemName,
  basePriceCents,
  modifiers,
  onConfirm,
}: ModifierSheetProps) {
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [specialInstructions, setSpecialInstructions] = useState('');

  useEffect(() => {
    if (open) {
      const defaults: Record<string, string[]> = {};
      modifiers.forEach((m) => {
        const defaultOpts = m.options.filter((o) => o.isDefault).map((o) => o.id);
        defaults[m.id] = defaultOpts;
        if (m.required && !m.multiSelect && defaultOpts.length === 0 && m.options.length > 0) {
          defaults[m.id] = [m.options[0].id];
        }
      });
      setSelections(defaults);
      setSpecialInstructions('');
    }
  }, [open, modifiers]);

  const toggleOption = (modifierId: string, optionId: string, multiSelect: boolean, maxSelections: number) => {
    setSelections((prev) => {
      const current = prev[modifierId] || [];
      if (multiSelect) {
        if (current.includes(optionId)) {
          return { ...prev, [modifierId]: current.filter((id) => id !== optionId) };
        }
        if (current.length >= maxSelections && maxSelections > 0) {
          return prev;
        }
        return { ...prev, [modifierId]: [...current, optionId] };
      }
      return { ...prev, [modifierId]: [optionId] };
    });
  };

  const calculateTotalDeltas = () => {
    let total = 0;
    modifiers.forEach((m) => {
      const selected = selections[m.id] || [];
      selected.forEach((oid) => {
        const opt = m.options.find((o) => o.id === oid);
        if (opt) total += opt.priceDeltaCents;
      });
    });
    return total;
  };

  const isConfirmDisabled = () => {
    return modifiers.some((m) => {
      const selected = selections[m.id] || [];
      if (m.required) {
        if (m.minSelections > 0 && selected.length < m.minSelections) return true;
        if (m.minSelections === 0 && selected.length === 0) return true;
      }
      if (m.maxSelections > 0 && selected.length > m.maxSelections) return true;
      return false;
    });
  };

  const handleConfirm = () => {
    const flat: { modifierId: string; optionId: string }[] = [];
    Object.entries(selections).forEach(([modifierId, optionIds]) => {
      optionIds.forEach((optionId) => flat.push({ modifierId, optionId }));
    });
    onConfirm(flat, specialInstructions);
  };

  if (!open) return null;

  const unitTotal = basePriceCents + calculateTotalDeltas();

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div
        className="absolute inset-0 bg-black/65 backdrop-blur-md animate-fade-in"
        onClick={onClose}
      />
      <div className="relative w-full max-w-[480px] bg-gradient-to-b from-surface-panel to-surface-elevated border-t border-white/10 shadow-[0_-20px_60px_-15px_rgba(212,175,55,0.35)] rounded-t-[2rem] max-h-[90vh] overflow-hidden flex flex-col animate-slide-up">
        {/* Grabber */}
        <div className="pt-3 pb-1 flex justify-center pointer-events-none">
          <span className="inline-block w-12 h-1.5 rounded-full bg-white/15" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-2 pb-3 gap-4">
          <div className="flex-1 min-w-0">
            <Badge variant="neon" size="sm" className="mb-1.5" dot>
              Customize
            </Badge>
            <h3 className="font-display text-[20px] leading-tight font-bold text-white tracking-tight truncate">
              {itemName}
            </h3>
          </div>
          <IconButton variant="ghost" size="md" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </IconButton>
        </div>

        <div className="hairline mx-5" />

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-7 scrollbar-thin">
          {modifiers.map((mod, gIdx) => {
            const selectedForMod = selections[mod.id] || [];
            const complete =
              !mod.required ||
              (mod.minSelections > 0 && selectedForMod.length >= mod.minSelections) ||
              (mod.minSelections === 0 && selectedForMod.length > 0) ||
              (!mod.required && selectedForMod.length === 0 && mod.minSelections === 0)
                ? true
                : mod.required
                ? false
                : true;
            return (
              <div key={mod.id} className={cn(gIdx > 0 && 'animate-fade-in-up-' + (gIdx <= 4 ? (gIdx * 100) : 400))}>
                <div className="flex items-start justify-between gap-3 mb-2.5">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-[15.5px] text-white tracking-tight">
                        {mod.name}
                      </h4>
                      {mod.required ? (
                        <Badge size="xs" variant="neon-pink">Required</Badge>
                      ) : (
                        <Badge size="xs" variant="soft">Optional</Badge>
                      )}
                    </div>
                    <p className="text-[12px] text-ink-muted mt-1">
                      {mod.multiSelect
                        ? `Choose ${mod.minSelections || 0}–${mod.maxSelections || 'many'} option${
                            (mod.maxSelections || 0) !== 1 ? 's' : ''
                          }`
                        : mod.required
                        ? 'Choose 1'
                        : 'Choose up to 1'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span
                      className={cn(
                        'inline-flex h-7 min-w-[2rem] items-center justify-center rounded-full px-2.5 text-[11px] font-extrabold tabular-nums',
                        complete
                          ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-400/25'
                          : 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-400/25'
                      )}
                    >
                      {selectedForMod.length}
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  {mod.options.map((opt) => {
                    const checked = selectedForMod.includes(opt.id);
                    return (
                      <button
                        key={opt.id}
                        onClick={() => toggleOption(mod.id, opt.id, mod.multiSelect, mod.maxSelections)}
                        className={cn(
                          'ripple-target relative w-full flex items-center gap-3.5 p-3.5 rounded-[1.05rem] border text-left transition-all duration-300 ease-out-expo',
                          checked
                            ? 'border-amber-400/30 bg-gradient-neon shadow-glow-restaurant ring-2 ring-white/10'
                            : 'border-white/6 bg-surface-muted hover:bg-surface-elevated hover:border-white/10'
                        )}
                      >
                        <div
                          className={cn(
                            'w-[26px] h-[26px] shrink-0 flex items-center justify-center transition-all duration-300',
                            mod.multiSelect ? 'rounded-[7px]' : 'rounded-full',
                            checked
                              ? 'bg-white text-amber-700 ring-2 ring-white/40 shadow-glow-restaurant'
                              : 'border-[2.5px] border-white/15 bg-surface-panel'
                          )}
                        >
                          {checked && (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-[14.5px] text-white leading-tight">
                            {opt.name}
                          </p>
                          {opt.priceDeltaCents !== 0 && (
                            <p
                              className={cn(
                                'text-[12px] font-semibold mt-0.5',
                                opt.priceDeltaCents > 0 ? 'text-amber-300' : 'text-emerald-400'
                              )}
                            >
                              {opt.priceDeltaCents > 0 ? '+' : ''}
                              {formatNGN(opt.priceDeltaCents)}
                            </p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Special Instructions */}
          <div>
            <Textarea
              value={specialInstructions}
              onChange={(e) => setSpecialInstructions(e.target.value.slice(0, 200))}
              placeholder="Allergies, no onions, extra spicy, well-done, etc."
              rows={3}
              maxLength={200}
              label="Special Instructions"
            />
            <p className="mt-1.5 text-[11.5px] text-ink-muted px-1 flex items-start gap-1.5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4" />
                <path d="M12 8h.01" />
              </svg>
              Kitchen notes can&apos;t be changed after submission.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-white/10 bg-surface-panel/80 backdrop-blur-xl p-4 pb-6 pt-3 space-y-3">
          <div className="flex items-center justify-between px-1">
            <span className="text-[12px] uppercase tracking-widest font-bold text-ink-muted">
              Per serving
            </span>
            <span className="font-display text-[26px] font-extrabold text-gradient-neon tracking-tight tabular-nums">
              {formatNGN(unitTotal)}
            </span>
          </div>
          <Button
            variant="neon"
            size="xl"
            fullWidth
            disabled={isConfirmDisabled()}
            rightIcon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            }
            onClick={handleConfirm}
          >
            Add to Order
          </Button>
        </div>
      </div>
    </div>
  );
}
