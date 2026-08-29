'use client';

import { useState } from 'react';
import type { MenuItem } from '@prolific/shared-types';
import { formatCentsToNgn, statusVariant } from '../../lib/ui-helpers';
import ModifierModal from './ModifierModal';

interface MenuItemTileProps {
  item: MenuItem;
  onAdded?: (item: MenuItem, modifiers: { modifierId: string; optionIds: string[] }[]) => void;
}

export default function MenuItemTile({ item, onAdded }: MenuItemTileProps) {
  const [open, setOpen] = useState(false);
  const anyItem = item as any;
  const priceCents =
    typeof item.price === 'number'
      ? item.price
      : typeof anyItem.price_cents === 'number'
        ? anyItem.price_cents
        : 0;
  const isOOS = (item.status || '').toUpperCase() === 'OUT_OF_STOCK' || (item.status || '').toUpperCase() === 'OOS';
  const disabled = isOOS;

  const handleTap = () => {
    if (disabled) return;
    setOpen(true);
  };

  return (
    <>
      <button
        onClick={handleTap}
        disabled={disabled}
        // Tile must grow/shrink with its content (long names wrap to 2 lines,
        // price-and-add row must never clip). Removing the fixed h-44 box and
        // using flex-column + min-h-52 + h-auto ensures every card renders all
        // content completely regardless of the name/description line count.
        className={`w-full min-h-[13rem] h-auto shrink-0 card p-3 text-left transition-all active:scale-[0.98] group flex flex-col ${
          disabled ? 'opacity-60 grayscale cursor-not-allowed' : 'hover:ring-2 hover:ring-emerald-500/40 hover:bg-slate-800/60'
        }`}
      >
        <div className="relative w-full aspect-[16/10] rounded-xl overflow-hidden bg-slate-900/60 mb-2 ring-1 ring-inset ring-white/5 shrink-0">
          {item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt={item.name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-5xl bg-gradient-to-br from-slate-800 to-slate-900">
              <span>🍽️</span>
            </div>
          )}
          <div className="absolute top-2 right-2">
            <span
              className={`chip !py-0.5 !px-2 text-[10px] font-bold uppercase tracking-wider ${
                statusVariant(isOOS ? 'OOS' : 'AVAILABLE').bg
              } ${statusVariant(isOOS ? 'OOS' : 'AVAILABLE').text} ${
                statusVariant(isOOS ? 'OOS' : 'AVAILABLE').ring
              }`}
            >
              {isOOS ? 'OOS' : 'Available'}
            </span>
          </div>
        </div>
        {/* Body: split into text-top + price-cta bottom with flex-1 so CTA
            row is always fully visible, even for 2-line names + descriptions. */}
        <div className="flex flex-col gap-2 min-h-0 flex-1 justify-between">
          <div className="min-h-0">
            <div className="font-semibold text-white text-sm leading-tight line-clamp-2 break-words">
              {item.name || 'Untitled'}
            </div>
            {item.description && (
              <div className="text-[11px] text-slate-400 leading-tight line-clamp-1 mt-1 break-words">
                {item.description}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between pt-1 shrink-0">
            <div className="text-emerald-400 font-bold text-base tabular-nums">
              {formatCentsToNgn(priceCents)}
            </div>
            <div className="h-8 w-8 rounded-lg bg-emerald-600/20 text-emerald-300 flex items-center justify-center ring-1 ring-inset ring-emerald-500/20 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
              <span className="text-lg font-bold leading-none">+</span>
            </div>
          </div>
        </div>
      </button>

      {open && (
        <ModifierModal
          menuItem={item}
          onClose={() => setOpen(false)}
          onConfirm={(modifiers) => {
            if (onAdded) {
              onAdded(item, modifiers);
            }
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
