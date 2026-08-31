'use client';

import type { MenuCategory } from '@prolific/shared-types';

interface CategoryRailProps {
  categories: MenuCategory[];
  activeCategoryId: string | null;
  onSelect: (categoryId: string) => void;
}

// Safe ID equality: coerce both sides to strings. Server responses or
// localStorage-mirrored docs may contain raw Mongoose ObjectId instances
// in mixed _id / id fields; strict === would otherwise always be false.
const sidEq = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '');

export default function CategoryRail({
  categories,
  activeCategoryId,
  onSelect,
}: CategoryRailProps) {
  const items = categories || [];
  return (
    <div className="flex items-center gap-3 overflow-x-auto pb-2 scroll-smooth">
      <button
        onClick={() => onSelect('')}
        className={`shrink-0 h-14 px-6 rounded-full font-semibold text-base transition-all active:scale-[0.97] ${
          !activeCategoryId
            ? 'bg-emerald-600 text-white ring-2 ring-emerald-400/40 shadow-soft'
            : 'bg-white/5 text-slate-200 ring-1 ring-inset ring-white/10 hover:bg-white/10'
        }`}
      >
        🍽️ All Items
      </button>
      {items.map((c) => {
        const catId = String(c.id ?? (c as any)._id ?? '');
        const active = sidEq(catId, activeCategoryId);
        return (
          <button
            key={catId}
            onClick={() => onSelect(catId)}
            className={`shrink-0 h-14 px-6 rounded-full font-semibold text-base transition-all active:scale-[0.97] flex items-center gap-2 ${
              active
                ? 'bg-emerald-600 text-white ring-2 ring-emerald-400/40 shadow-soft'
                : 'bg-white/5 text-slate-200 ring-1 ring-inset ring-white/10 hover:bg-white/10'
            }`}
          >
            <span className="text-lg">
              {c.name?.toLowerCase().includes('breakfast')
                ? '🥐'
                : c.name?.toLowerCase().includes('lunch')
                ? '🍱'
                : c.name?.toLowerCase().includes('dinner')
                ? '🍽️'
                : c.name?.toLowerCase().includes('drink') ||
                  c.name?.toLowerCase().includes('beverage')
                ? '🥤'
                : c.name?.toLowerCase().includes('dessert')
                ? '🍰'
                : c.name?.toLowerCase().includes('side')
                ? '🍟'
                : c.name?.toLowerCase().includes('burger') ||
                  c.name?.toLowerCase().includes('main')
                ? '🍔'
                : c.imageUrl
                ? '📷'
                : '📂'}
            </span>
            <span>{c.name || 'Untitled'}</span>
          </button>
        );
      })}
    </div>
  );
}
