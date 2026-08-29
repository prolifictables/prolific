'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@prolific/utils';
import { useCart, useSession } from '../../../lib/store';
import { apiGet } from '../../../lib/api';
import { createClientSocket, disconnectClientSocket } from '../../../lib/client-socket';
import { CategoryChips } from '../../../components/CategoryChips';
import { MenuItemCard, MenuItemData } from '../../../components/MenuItemCard';
import {
  ModifierSheet,
  MenuModifierGroup,
} from '../../../components/ModifierSheet';
import { CartBar } from '../../../components/CartBar';
import { CartSheet } from '../../../components/CartSheet';
import { CheckoutSheet } from '../../../components/CheckoutSheet';
import {
  Button,
  IconButton,
} from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Skeleton, SkeletonMenuCard } from '../../../components/ui/Skeleton';
import { EmptyState, EmptySearch } from '../../../components/ui/EmptyState';
import { Alert } from '../../../components/ui/Alert';
import { Badge } from '../../../components/ui/Badge';

export default function SessionClientShell({
  token,
  initialResolvedQr,
}: {
  token: string;
  initialResolvedQr: any;
}) {
  const router = useRouter();
  const initFromToken = useSession((s) => s.initFromToken);
  const invalidateSession = useSession((s) => s.invalidateSession);
  const {
    session,
    loading: sessionLoading,
    error: sessionError,
    branch,
    restaurant,
    table,
    guestToken,
  } = useSession();

  const [initError, setInitError] = useState<string | null>(null);
  const [menu, setMenu] = useState<any>(null);
  const [menuLoading, setMenuLoading] = useState(true);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [step, setStep] = useState<'welcome' | 'menu'>('welcome');
  const [joinMode, setJoinMode] = useState<'start' | 'join'>('start');
  const [joinDisplayName, setJoinDisplayName] = useState('');
  const [joinPhone, setJoinPhone] = useState('');
  const [joinEmail, setJoinEmail] = useState('');

  const [modifierSheetItem, setModifierSheetItem] = useState<{
    item: MenuItemData;
    modifiers: MenuModifierGroup[];
  } | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 150);
    return () => clearTimeout(t);
  }, [search]);

  // Init session
  useEffect(() => {
    initFromToken(token, initialResolvedQr).catch((e) => {
      setInitError(e?.message || 'Failed to initialize session');
    });
    return () => {
      invalidateSession();
    };
  }, [token]);

  // Load menu
  useEffect(() => {
    if (!branch?.id) return;
    let cancelled = false;
    setMenuLoading(true);
    apiGet<any>(`/public/menu?branchId=${branch.id}`)
      .then((m) => {
        if (!cancelled) setMenu(m);
      })
      .catch(() => {
        if (!cancelled) setMenu({ categories: [], items: [], modifiers: [] });
      })
      .finally(() => {
        if (!cancelled) setMenuLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [branch?.id]);

  // Socket
  useEffect(() => {
    if (!table?.id || !session?.id) return;
    const sock = createClientSocket({
      guestToken,
      tableId: table.id,
      sessionId: session.id,
    });
    return () => {
      disconnectClientSocket();
    };
  }, [table?.id, session?.id, guestToken]);

  const modifiersByItemId = useMemo(() => {
    const map: Record<string, MenuModifierGroup[]> = {};
    if (!menu) return map;
    const allMods: MenuModifierGroup[] = (menu.modifiers || []).map((m: any) => ({
      ...m,
      options: (m.options || []).map((o: any) => ({
        ...o,
        priceDeltaCents: o.priceDeltaCents ?? 0,
      })),
    }));
    const modsById = new Map(allMods.map((m) => [m.id, m]));
    (menu.items || []).forEach((it: any) => {
      const arr: MenuModifierGroup[] = [];
      (it.modifierIds || []).forEach((mid: string) => {
        const m = modsById.get(mid);
        if (m) arr.push(m);
      });
      map[it.id] = arr;
    });
    return map;
  }, [menu]);

  const modifiersFlatMap = useMemo(() => {
    const map: Record<string, { id: string; name: string; options: Record<string, string> }> = {};
    if (!menu) return map;
    (menu.modifiers || []).forEach((m: any) => {
      const opts: Record<string, string> = {};
      (m.options || []).forEach((o: any) => {
        opts[o.id] = o.name;
      });
      map[m.id] = { id: m.id, name: m.name, options: opts };
    });
    return map;
  }, [menu]);

  const filteredMenuItems = useMemo<MenuItemData[]>(() => {
    if (!menu) return [];
    const q = debouncedSearch.trim().toLowerCase();
    const items: MenuItemData[] = (menu.items || []).map((it: any) => ({
      id: it.id,
      categoryId: it.categoryId,
      name: it.name,
      description: it.description,
      priceCents: it.priceCents,
      imageUrl: it.imageUrl,
      hasModifiers: (it.modifierIds || []).length > 0,
      currency: menu.restaurant?.currency,
      locale: menu.restaurant?.locale,
      highlight:
        q && (it.name.toLowerCase().includes(q) || (it.description || '').toLowerCase().includes(q))
          ? q
          : undefined,
    }));
    let out = items;
    if (activeCategoryId) {
      out = out.filter((i) => i.categoryId === activeCategoryId);
    }
    if (q) {
      out = out.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          (i.description || '').toLowerCase().includes(q)
      );
    }
    return out.sort((a, b) => (a.id > b.id ? 1 : -1));
  }, [menu, activeCategoryId, debouncedSearch]);

  const addItemToCart = useCart((s) => s.addItem);

  const handleAddItem = (item: MenuItemData) => {
    const mods = modifiersByItemId[item.id] || [];
    if (mods.length > 0) {
      setModifierSheetItem({ item, modifiers: mods });
    } else {
      addItemToCart({
        menuItemId: item.id,
        name: item.name,
        priceCents: item.priceCents,
        quantity: 1,
        imageUrl: item.imageUrl,
        selectedModifierOptions: [],
        perUnitTotalCents: item.priceCents,
      });
    }
  };

  const confirmModifiers = (
    selections: { modifierId: string; optionId: string }[],
    specialInstructions?: string
  ) => {
    if (!modifierSheetItem) return;
    const { item, modifiers } = modifierSheetItem;
    let delta = 0;
    modifiers.forEach((m) => {
      const opts = m.options || [];
      selections
        .filter((s) => s.modifierId === m.id)
        .forEach((s) => {
          const opt = opts.find((o) => o.id === s.optionId);
          if (opt) delta += opt.priceDeltaCents;
        });
    });
    addItemToCart({
      menuItemId: item.id,
      name: item.name,
      priceCents: item.priceCents,
      quantity: 1,
      imageUrl: item.imageUrl,
      specialInstructions,
      selectedModifierOptions: selections,
      perUnitTotalCents: item.priceCents + delta,
    });
    setModifierSheetItem(null);
  };

  const defaultTax = menu?.defaultTax || null;
  const cart = useCart();

  /* -------------------- Session loading skeleton -------------------- */
  if (sessionLoading || (!session && !sessionError && !initError)) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-24 px-6">
        <div className="relative">
          <div className="absolute -inset-6 rounded-full bg-amber-500/25 blur-2xl animate-pulse-soft" />
          <div className="absolute -inset-4 rounded-full bg-pink-500/15 blur-xl animate-pulse-soft" />
          <div className="relative w-16 h-16 rounded-[1.4rem] bg-gradient-neon shadow-glow-restaurant flex items-center justify-center text-white text-3xl animate-float ring-1 ring-white/20">
            🍽️
          </div>
        </div>
        <Skeleton variant="text" className="mt-8 w-48 h-5" />
        <Skeleton variant="text" className="mt-3 w-72 h-4 opacity-70" />
        <p className="mt-3 text-sm text-ink-muted animate-pulse-soft">
          Preparing your table…
        </p>
      </div>
    );
  }

  if (sessionError || initError) {
    return (
      <div className="flex-1 px-5 py-12 animate-fade-in">
        <Alert tone="danger" size="md" title="Session error" onClose={() => window.location.reload()}>
          {(sessionError || initError) as string}
        </Alert>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <Button variant="soft" fullWidth onClick={() => window.history.back()}>
            Go back
          </Button>
          <Button variant="neon" fullWidth onClick={() => window.location.reload()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <main className="flex-1 px-4 pt-4 pb-28">
        {step === 'welcome' ? (
          <div className="space-y-5 animate-fade-in-up">
            {/* Welcome hero card */}
            <div className="relative overflow-hidden rounded-[2rem] p-6 text-center shadow-glow-restaurant ring-1 ring-white/15 border border-white/10 bg-gradient-card">
              <div className="absolute inset-0 bg-cyber-grid opacity-[0.12]" />
              <div className="absolute inset-0 grain opacity-20 mix-blend-overlay" />
              <div className="absolute -top-10 -right-10 blob w-40 h-40 bg-amber-500/30 blur-2xl" />
              <div className="absolute -bottom-12 -left-10 blob w-48 h-48 bg-pink-500/25 blur-2xl" />
              <div className="absolute top-20 left-1/2 -translate-x-1/2 blob w-32 h-32 bg-cyan-500/15 blur-2xl" />

              <div className="relative">
                <div className="w-20 h-20 mx-auto rounded-3xl bg-gradient-neon/20 backdrop-blur-md ring-1 ring-white/20 shadow-2xl flex items-center justify-center mb-5 animate-float border border-white/10">
                  <span className="text-4xl">👋</span>
                </div>

                <Badge variant="neon" size="sm" dot className="mb-4">
                  Welcome to
                </Badge>
                <h1 className="font-display text-[28px] leading-[1.1] font-bold text-white tracking-tight">
                  Table <span className="text-gradient-neon">{table?.name || ''}</span>
                </h1>
                <p className="mt-2 text-[13.5px] text-ink-soft">
                  at{' '}
                  <span className="font-semibold text-white">{restaurant?.name}</span>
                </p>

                <div className="mt-7 grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setJoinMode('join')}
                    className={cn(
                      'ripple-target h-14 rounded-2xl text-[13.5px] font-bold transition-all duration-300 ease-out-expo flex items-center justify-center gap-2',
                      joinMode === 'join'
                        ? 'bg-gradient-neon text-white shadow-glow-restaurant ring-2 ring-white/15 scale-[1.02]'
                        : 'bg-surface-muted/80 backdrop-blur text-white ring-1 ring-white/10 hover:bg-surface-elevated hover:border-white/15 border border-white/5'
                    )}
                  >
                    <span className="text-xl">👥</span>
                    Join Order
                  </button>
                  <button
                    onClick={() => setJoinMode('start')}
                    className={cn(
                      'ripple-target h-14 rounded-2xl text-[13.5px] font-bold transition-all duration-300 ease-out-expo flex items-center justify-center gap-2',
                      joinMode === 'start'
                        ? 'bg-gradient-neon text-white shadow-glow-restaurant ring-2 ring-white/15 scale-[1.02]'
                        : 'bg-surface-muted/80 backdrop-blur text-white ring-1 ring-white/10 hover:bg-surface-elevated hover:border-white/15 border border-white/5'
                    )}
                  >
                    <span className="text-xl">🍴</span>
                    Start Ordering
                  </button>
                </div>
              </div>
            </div>

            {joinMode === 'start' ? (
              <div className="space-y-3 animate-fade-in-up-200">
                {/* Quick perks */}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { i: '⚡', t: 'Fast service' },
                    { i: '🛡️', t: 'Secure pay' },
                    { i: '💚', t: 'Made fresh' },
                  ].map((p) => (
                    <div
                      key={p.t}
                      className="rounded-2xl bg-surface-muted border border-white/6 p-3 text-center"
                    >
                      <div className="text-2xl">{p.i}</div>
                      <div className="mt-1 text-[11px] font-semibold text-ink-soft">{p.t}</div>
                    </div>
                  ))}
                </div>
                <Button
                  variant="neon"
                  size="xl"
                  fullWidth
                  rightIcon={
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12" />
                      <polyline points="12 5 19 12 12 19" />
                    </svg>
                  }
                  onClick={() => setStep('menu')}
                >
                  Start a New Order
                </Button>
              </div>
            ) : (
              <div className="rounded-[1.5rem] bg-gradient-card border border-white/6 p-5 space-y-4 animate-fade-in-up-200 overflow-hidden relative">
                <div className="absolute -top-16 -right-10 blob w-40 h-40 bg-amber-500/20 blur-3xl" />
                <div className="absolute -bottom-10 -left-8 blob w-36 h-36 bg-pink-500/15 blur-3xl" />
                <div className="relative">
                  <div>
                    <h3 className="font-bold text-white text-[15.5px] leading-tight">
                      Join an existing order
                    </h3>
                    <p className="mt-1 text-[12.5px] text-ink-muted leading-relaxed">
                      Add your items to a shared bill at this table. Your name will appear next to your dishes.
                    </p>
                  </div>
                  <div className="space-y-3">
                    <Input
                      label="Your name (for the waiter)"
                      placeholder="e.g., Tunde"
                      value={joinDisplayName}
                      onChange={(e) => setJoinDisplayName(e.target.value)}
                      required
                    />
                    <Input
                      label="Phone (optional)"
                      placeholder="080..."
                      value={joinPhone}
                      onChange={(e) => setJoinPhone(e.target.value)}
                    />
                    <Input
                      label="Email (optional)"
                      type="email"
                      placeholder="you@example.com"
                      value={joinEmail}
                      onChange={(e) => setJoinEmail(e.target.value)}
                    />
                  </div>
                  <Button
                    variant="neon"
                    size="lg"
                    fullWidth
                    onClick={async () => {
                      try {
                        await fetch(
                          `${(process as any).env?.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1'}/public/table-sessions/join`,
                          {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              qrToken: token,
                              displayName: joinDisplayName || undefined,
                              phone: joinPhone || undefined,
                              email: joinEmail || undefined,
                            }),
                          }
                        );
                      } finally {
                        setStep('menu');
                      }
                    }}
                  >
                    Join Table &amp; View Menu
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3 animate-fade-in">
            {/* Search bar */}
            <div className="relative">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search the menu (e.g., jollof, suya, zobo)"
                leftIcon={
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-ink-muted"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                }
                rightSlot={
                  search ? (
                    <IconButton variant="ghost" size="sm" onClick={() => setSearch('')} aria-label="Clear search">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </IconButton>
                  ) : null
                }
                className="!rounded-[1.1rem]"
              />
            </div>

            {/* Category chips (sticky) */}
            <CategoryChips
              categories={(menu?.categories || []).map((c: any) => ({
                id: c.id,
                name: c.name,
              }))}
              activeId={activeCategoryId}
              onSelect={setActiveCategoryId}
            />

            {/* Category result summary */}
            {!menuLoading && filteredMenuItems.length > 0 && (
              <div className="flex items-center justify-between px-1 pt-1 pb-1 animate-fade-in">
                <p className="text-[12px] font-semibold text-ink-muted uppercase tracking-wider">
                  {filteredMenuItems.length} {filteredMenuItems.length === 1 ? 'dish' : 'dishes'}
                  {activeCategoryId
                    ? ` · ${(menu?.categories || []).find((c: any) => c.id === activeCategoryId)?.name || ''}`
                    : ''}
                  {debouncedSearch ? ` matching “${debouncedSearch}”` : ''}
                </p>
              </div>
            )}

            {/* Menu content */}
            {menuLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 pb-10">
                {Array.from({ length: 6 }).map((_, i) => (
                  <SkeletonMenuCard key={i} />
                ))}
              </div>
            ) : filteredMenuItems.length === 0 ? (
              <div className="pt-4 pb-12 animate-fade-in-up">
                {debouncedSearch ? (
                  <EmptySearch query={debouncedSearch} onClear={() => setSearch('')} />
                ) : (
                  <EmptyState
                    icon={
                      <div className="w-16 h-16 rounded-3xl bg-surface-panel shadow-glow-restaurant border border-amber-400/30 flex items-center justify-center ring-1 ring-white/10">
                        <span className="text-3xl">🍽️</span>
                      </div>
                    }
                    title="Nothing here yet"
                    description={
                      activeCategoryId
                        ? 'This category will be filled with deliciousness soon.'
                        : 'No menu items are available right now.'
                    }
                    action={
                      activeCategoryId
                        ? { label: 'View all dishes', onClick: () => setActiveCategoryId(null), props: { variant: 'neon' as const, size: 'sm' as const } }
                        : undefined
                    }
                  />
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-6">
                {filteredMenuItems.map((item, i) => (
                  <MenuItemCard key={item.id} item={item} onAdd={handleAddItem} index={i} />
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      <CartBar
        onClick={() => setCartOpen(true)}
        taxRatePercent={defaultTax?.rate ?? 0}
      />

      <ModifierSheet
        open={!!modifierSheetItem}
        onClose={() => setModifierSheetItem(null)}
        itemName={modifierSheetItem?.item.name || ''}
        basePriceCents={modifierSheetItem?.item.priceCents || 0}
        modifiers={modifierSheetItem?.modifiers || []}
        onConfirm={confirmModifiers}
      />

      <CartSheet
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        onCheckout={() => {
          setCartOpen(false);
          setCheckoutOpen(true);
        }}
        defaultTax={defaultTax}
        modifiersMap={modifiersFlatMap}
      />

      <CheckoutSheet
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        defaultTax={defaultTax}
        onOrderSubmitted={(order, orderId) => {
          setCheckoutOpen(false);
          if (orderId) {
            router.push(`/t/${token}/orders/${orderId}`);
          }
        }}
      />
    </>
  );
}
