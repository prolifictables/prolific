'use client';

import { Children, HTMLAttributes, forwardRef, useMemo, useState } from 'react';
import { cn } from '@prolific/utils';

export interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  /** Image URL (if missing, falls back to initials derived from `name`) */
  src?: string;
  /** Full name — used to extract 1-2 char initials when no image */
  name?: string;
  /** Size preset */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  /** Visual tone for placeholder initials background */
  tone?: 'warm' | 'sunset' | 'forest' | 'slate' | 'brand';
  /** Optional status dot (for online / offline / busy etc.) */
  status?: 'online' | 'offline' | 'busy' | 'away';
  /** Alt text for image — defaults to `name` */
  alt?: string;
}

const sizeMap: Record<NonNullable<AvatarProps['size']>, string> = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-12 h-12 text-base',
  xl: 'w-16 h-16 text-lg',
  '2xl': 'w-20 h-20 text-xl',
};

const statusColor: Record<NonNullable<AvatarProps['status']>, string> = {
  online: 'bg-emerald-500 ring-2 ring-white',
  offline: 'bg-slate-400 ring-2 ring-white',
  busy: 'bg-red-500 ring-2 ring-white',
  away: 'bg-amber-500 ring-2 ring-white',
};

const toneMap: Record<NonNullable<AvatarProps['tone']>, string> = {
  warm: 'bg-gradient-warm text-white',
  sunset: 'bg-gradient-sunset text-white',
  forest: 'bg-gradient-forest text-white',
  slate: 'bg-slate-200 text-slate-700',
  brand: 'bg-restaurant-600 text-white',
};

/**
 * Deterministic picker — same `name` always yields the same tone
 * so placeholders feel stable across renders.
 */
function pickTone(name: string): NonNullable<AvatarProps['tone']> {
  const tones: NonNullable<AvatarProps['tone']>[] = ['warm', 'sunset', 'forest', 'slate'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return tones[h % tones.length];
}

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Avatar — image-first with graceful initials + gradient fallback.
 * Provides deterministic tone for initials so the same user always gets the same color.
 */
export const Avatar = forwardRef<HTMLDivElement, AvatarProps>(function Avatar(
  { className, src, name = '', size = 'md', tone, status, alt, ...rest },
  ref
) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src && !failed);
  const finalTone = tone ?? (name ? pickTone(name) : 'warm');
  const initials = useMemo(() => initialsFrom(name), [name]);

  return (
    <div
      ref={ref}
      className={cn(
        'relative inline-flex items-center justify-center rounded-full overflow-hidden font-semibold shadow-sm ring-1 ring-black/5 select-none',
        sizeMap[size],
        !showImage && toneMap[finalTone],
        className
      )}
      {...rest}
    >
      {showImage ? (
        <img
          src={src!}
          alt={alt ?? name}
          onError={() => setFailed(true)}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      ) : (
        <span aria-hidden={!name}>{initials}</span>
      )}

      {status && (
        <span
          className={cn(
            'absolute bottom-0 right-0 block rounded-full',
            statusColor[status],
            // Size the dot proportional to the avatar
            size === 'xs' && 'w-1.5 h-1.5 -translate-y-0.5 -translate-x-0.5',
            (size === 'sm' || size === 'md') && 'w-2.5 h-2.5',
            (size === 'lg' || size === 'xl') && 'w-3 h-3',
            size === '2xl' && 'w-4 h-4'
          )}
          aria-label={`Status: ${status}`}
        />
      )}
    </div>
  );
});

/**
 * AvatarGroup — stacks avatars with overlapping negative margins, used
 * for "people viewing / table guests / order collaborators".
 */
export interface AvatarGroupProps extends HTMLAttributes<HTMLDivElement> {
  /** Avatar elements or data */
  children: React.ReactNode;
  /** Max visible avatars before showing +N count */
  max?: number;
  size?: AvatarProps['size'];
}

export function AvatarGroup({ className, children, max = 4, size = 'md' }: AvatarGroupProps) {
  const items = Children.toArray(children).filter(Boolean);
  const visible = items.slice(0, max);
  const overflow = Math.max(0, items.length - max);

  return (
    <div className={cn('flex items-center -space-x-3', className)}>
      {visible.map((child, i) => (
        <div
          key={i}
          style={{ zIndex: visible.length - i }}
          className="ring-2 ring-white rounded-full"
        >
          {child}
        </div>
      ))}
      {overflow > 0 && (
        <div
          className={cn(
            'relative rounded-full bg-restaurant-50 border-2 border-white text-restaurant-600 font-semibold flex items-center justify-center shadow-sm',
            sizeMap[size]
          )}
          aria-label={`And ${overflow} more`}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}
