'use client';

import { cn } from '@prolific/utils';
import { Badge } from './ui/Badge';

export interface Category {
  id: string;
  name: string;
  imageUrl?: string;
}

interface CategoryChipsProps {
  categories: Category[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
}

// Deterministic tiny emoji picker so each category has a consistent icon
function iconFor(name: string, fallback = '🍽️'): string {
  const n = name.toLowerCase();
  if (/rice|grain|jollof|fries|plantain|yam|pasta|spag/.test(n)) return '🍚';
  if (/soup|stew|sauce|okra|egusi|pepper/.test(n)) return '🍲';
  if (/protein|meat|chicken|beef|fish|goat|shrimp|pork|turkey/.test(n)) return '🍗';
  if (/drink|beverage|juice|smoothie|cocktail|water|soda|zobo|kunu/.test(n)) return '🥤';
  if (/dessert|sweet|cake|pudding|ice cream|chin chin|donut/.test(n)) return '🍰';
  if (/small|chop|appetizer|starter|snack|suya|shawarma/.test(n)) return '🥟';
  if (/signature|chef|special|combo|platter/.test(n)) return '🍱';
  if (/grill|bbq|barbecue|roast/.test(n)) return '🍖';
  if (/salad/.test(n)) return '🥗';
  if (/bread|pastry|pie|croissant|puff/.test(n)) return '🥐';
  return fallback;
}

export function CategoryChips({ categories, activeId, onSelect }: CategoryChipsProps) {
  return (
    <div className="sticky top-[64px] z-20 -mx-4 px-4 py-3 bg-gradient-to-b from-black/5 via-black/30 to-transparent backdrop-blur-md -mt-4 mb-2 pointer-events-none">
      <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-thin scroll-snap-x pointer-events-auto">
        <button
          onClick={() => onSelect(null)}
          className={cn(
            'group ripple-target flex-shrink-0 scroll-snap-start inline-flex items-center gap-1.5 rounded-full px-4 h-11 text-[13px] font-semibold transition-all duration-300 ease-out-expo',
            activeId === null
              ? 'bg-gradient-warm text-white shadow-glow-restaurant ring-2 ring-white/10 scale-[1.02]'
              : 'bg-white/90 backdrop-blur text-ink-700 border border-ink-50 hover:bg-white shadow-sm hover:shadow-md hover:-translate-y-0.5'
          )}
        >
          <span
            className={cn(
              'inline-flex w-6 h-6 items-center justify-center rounded-full text-xs transition-all',
              activeId === null ? 'bg-white/20' : 'bg-restaurant-50'
            )}
          >
            ✨
          </span>
          All
          {activeId === null && (
            <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-white animate-pulse-soft" />
          )}
        </button>
        {categories.map((c) => {
          const active = activeId === c.id;
          return (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              className={cn(
                'group ripple-target flex-shrink-0 scroll-snap-start inline-flex items-center gap-1.5 rounded-full px-4 h-11 text-[13px] font-semibold transition-all duration-300 ease-out-expo',
                active
                  ? 'bg-gradient-accent text-white shadow-glow-accent ring-2 ring-white/10 scale-[1.02]'
                  : 'bg-white/90 backdrop-blur text-ink-700 border border-ink-50 hover:bg-white shadow-sm hover:shadow-md hover:-translate-y-0.5'
              )}
            >
              <span
                className={cn(
                  'inline-flex w-6 h-6 items-center justify-center rounded-full text-xs transition-all',
                  active ? 'bg-white/20' : 'bg-restaurant-50'
                )}
              >
                {iconFor(c.name)}
              </span>
              <span className="truncate max-w-[160px]">{c.name}</span>
              {active && (
                <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-white animate-pulse-soft" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
