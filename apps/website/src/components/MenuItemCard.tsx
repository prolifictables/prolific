'use client';

import { cn } from '@prolific/utils';
import { useMemo, useState } from 'react';
import { Badge } from './ui/Badge';
import { IconButton } from './ui/Button';

export interface MenuItemData {
  id: string;
  categoryId: string;
  name: string;
  description?: string;
  priceCents: number;
  imageUrl?: string;
  hasModifiers: boolean;
  currency?: string;
  locale?: string;
  /** Optional highlighter tags, derived deterministically if absent */
  tags?: ('bestseller' | 'chefpick' | 'spicy' | 'veggie' | 'new')[];
  /** Optional rating 0–5, derived hash if absent */
  rating?: number;
  /** Highlight string to render if search matched */
  highlight?: string;
}

interface MenuItemCardProps {
  item: MenuItemData;
  onAdd: (item: MenuItemData) => void;
  index?: number;
}

function formatNGN(amountCents: number) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
  }).format(amountCents / 100);
}

// Simple deterministic hash so tags + rating are stable per item
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h;
}

function deriveTags(item: MenuItemData): MenuItemData['tags'] {
  if (item.tags?.length) return item.tags;
  const out: Exclude<NonNullable<MenuItemData['tags']>[number], never>[] = [];
  const h = hash(item.id + item.name);
  const low = h % 100;
  if (low < 22) out.push('bestseller');
  else if (low < 35) out.push('chefpick');
  else if (low < 50) out.push('new');
  const d = (item.description || item.name).toLowerCase();
  if (/pepper|spicy|chilli|chili|shitta|ata/.test(d)) out.push('spicy');
  if (/vegan|veg(etable)?|plant|tofu|beans|okoro|okra|sauce leaf/.test(d) || /rice &|stew$/.test(d)) {
    if ((h >> 4) % 3 === 0) out.push('veggie');
  }
  return out;
}

function deriveRating(item: MenuItemData): number {
  if (typeof item.rating === 'number') return item.rating;
  const h = hash(item.id + item.name);
  return 4.2 + ((h % 9) / 10); // 4.2 – 5.0
}

/** Lightweight highlighting that wraps matched text in <mark> safely */
function highlightName(name: string, q?: string) {
  if (!q) return name;
  const idx = name.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return name;
  return (
    <>
      {name.slice(0, idx)}
      <mark className="bg-amber-500/20 text-amber-300 rounded px-0.5 -mx-0.5 ring-1 ring-amber-400/30">
        {name.slice(idx, idx + q.length)}
      </mark>
      {name.slice(idx + q.length)}
    </>
  );
}

export function MenuItemCard({ item, onAdd, index = 0 }: MenuItemCardProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const tags: NonNullable<MenuItemData['tags']> = useMemo(() => deriveTags(item) || [], [item]);
  const rating = useMemo(() => deriveRating(item), [item]);

  const imgUrl =
    !imgFailed && !item.imageUrl
      ? `https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=${encodeURIComponent(
          'A high-quality professional photo of ' +
            item.name +
            ', gourmet restaurant cuisine, plated, dramatic moody lighting, neon accents, dark cinematic background, ultra sharp'
        )}&image_size=square_hd`
      : item.imageUrl || '';

  // Staggered entry animation index (capped to avoid huge delays)
  const stagger = index < 12 ? index % 4 : 3;
  const animClass = [
    'animate-fade-in-up',
    '',
    'animate-fade-in-up-200',
    'animate-fade-in-up-300',
    'animate-fade-in-up-400',
  ][stagger];

  return (
    <article
      className={cn(
        'ripple-target group relative rounded-3xl overflow-hidden bg-gradient-card shadow-lg border border-white/6',
        'transition-all duration-300 ease-out-expo hover:shadow-2xl hover:-translate-y-1 hover:border-amber-400/20 active:translate-y-0',
        animClass
      )}
    >
      {/* Image block (4:3 aspect) */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-gradient-neon/10">
        {!imgFailed && imgUrl ? (
          <img
            src={imgUrl}
            alt={item.name}
            onError={() => setImgFailed(true)}
            loading="lazy"
            className={cn(
              'w-full h-full object-cover transition-transform duration-500 ease-out-expo',
              'group-hover:scale-110'
            )}
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/25 via-surface-panel/80 to-pink-500/20 flex items-center justify-center">
            <div className="absolute inset-0 bg-cyber-grid opacity-[0.15]" />
            <span className="text-5xl opacity-85 drop-shadow-lg relative">🍲</span>
          </div>
        )}

        {/* Cyber grid overlay + gradient fade */}
        <div className="pointer-events-none absolute inset-0 bg-cyber-grid opacity-[0.18]" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-surface-panel/95 via-transparent to-transparent" />

        {/* Top tags row */}
        {(tags.length > 0 || item.hasModifiers) && (
          <div className="absolute top-2.5 left-2.5 right-2.5 flex items-start justify-between gap-1.5">
            <div className="flex flex-wrap gap-1.5">
              {tags.slice(0, 2).map((t) =>
                t === 'bestseller' ? (
                  <Badge key={t} variant="neon-pink" size="sm" dot>
                    Bestseller
                  </Badge>
                ) : t === 'chefpick' ? (
                  <Badge key={t} variant="neon" size="sm" dot>
                    Chef&apos;s Pick
                  </Badge>
                ) : t === 'new' ? (
                  <Badge key={t} variant="neon-cyan" size="sm" dot>
                    New
                  </Badge>
                ) : t === 'spicy' ? (
                  <Badge key={t} variant="neon-pink" size="sm" dot>
                    🌶 Spicy
                  </Badge>
                ) : t === 'veggie' ? (
                  <Badge key={t} variant="neon-lime" size="sm" dot>
                    🌿 Veg
                  </Badge>
                ) : null
              )}
            </div>
            {item.hasModifiers && (
              <Badge variant="neon" size="sm" dot>
                + Options
              </Badge>
            )}
          </div>
        )}

        {/* Shimmer overlay on hover */}
        <div className="pointer-events-none absolute inset-0 bg-shimmer opacity-0 group-hover:opacity-25 transition-opacity duration-500" />

        {/* Rating pill bottom-right of image */}
        <div className="absolute bottom-2.5 right-2.5 inline-flex items-center gap-1 rounded-full glass-dark backdrop-blur px-2.5 py-1 text-[11px] font-semibold text-white ring-1 ring-white/15 shadow-[0_4px_16px_rgba(0,0,0,0.6)]">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="text-gradient-neon -mt-[1px]"
            style={{ color: '#F59E0B' }}
          >
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          <span className="text-ink-soft">★</span>
          <span className="text-white">{rating.toFixed(1)}</span>
        </div>
      </div>

      {/* Rule divider */}
      <div className="rule" />

      {/* Body */}
      <div className="relative p-4 pb-14">
        <div className="flex items-start justify-between gap-2">
          <h3 className="ripple-target font-semibold text-[15px] text-white leading-tight tracking-tight">
            {highlightName(item.name, item.highlight)}
          </h3>
        </div>
        {item.description && (
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted line-clamp-2">
            {item.description}
          </p>
        )}
        <p className="mt-2 font-bold headline text-[18px] tracking-tight text-gradient-neon">
          {formatNGN(item.priceCents)}
        </p>
      </div>

      {/* Add button (floating FAB style) */}
      <IconButton
        variant="neon"
        size="md"
        onClick={() => onAdd(item)}
        aria-label={`Add ${item.name} to cart`}
        className="absolute bottom-3 right-3 shadow-glow-restaurant ring-2 ring-white/10 z-10"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </IconButton>
    </article>
  );
}
