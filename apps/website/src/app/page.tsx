'use client';

import { useMemo, useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Button, IconButton } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Input } from '../components/ui/Input';
import { Card } from '../components/ui/Card';
import { EmptySearch } from '../components/ui/EmptyState';
import { useCart } from '../lib/store';
import { apiGet } from '../lib/api';

const ModifierSheet = dynamic(() => import('../components/ModifierSheet').then(m => m.ModifierSheet), { ssr: false });
const CartSheet = dynamic(() => import('../components/CartSheet').then(m => m.CartSheet), { ssr: false });
const CheckoutSheet = dynamic(() => import('../components/CheckoutSheet').then(m => m.CheckoutSheet), { ssr: false });

// ---------- Domain types ----------
interface Category {
  id: string;
  name: string;
  icon: string;
  blurb: string;
  count?: number;
}
interface MenuItemData {
  id: string;
  name: string;
  description: string;
  price: number;
  categoryId: string;
  imageUrl?: string;
  status?: string;
  tags?: string[];
  dietary?: string[];
  hasModifiers?: boolean;
  modifierIds?: string[];
  spiceLevel?: number;
  rating?: number;
  ratingCount?: number;
  prepTimeMin?: number;
  calories?: number;
}

const RESTAURANT_NAME =
  (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_RESTAURANT_NAME : undefined) ||
  'Prolific Tables';

const ALL_CATEGORY: Category = {
  id: 'all',
  name: 'All',
  icon: '✨',
  blurb: 'Everything we serve — chef curated',
};

const FALLBACK_BRANCH_ID = '6a814d299717fc01eabb6000';

// ---------- FNV-ish deterministic hash so tags / images stay stable across renders ----------
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ---------- Helpers ----------
const NGN = (n: number) => '₦' + (n / 100).toLocaleString('en-NG');
const NGN_RAW = (n: number) => '₦' + n.toLocaleString('en-NG');

function deriveTags(item: MenuItemData): string[] {
  const base = item.tags ?? [];
  if (base.length > 0) return base;
  const h = hashStr(item.id + item.name);
  const palette: string[] = [];
  if (h % 7 === 0) palette.push('New');
  if (h % 11 === 0) palette.push("Chef's Pick");
  if (h % 13 === 0) palette.push('Bestseller');
  if (h % 17 === 0) palette.push('Spicy');
  if (h % 19 === 0) palette.push('Veggie');
  return palette;
}
function deriveRating(item: MenuItemData): number {
  if (item.rating) return item.rating;
  const h = hashStr(item.id + 'rt');
  return 4.2 + ((h % 80) / 100);
}

function starBadgeFor(tags: string[]): { variant: any; label: string } | null {
  if (tags.includes('Bestseller')) return { variant: 'neon-pink', label: 'Bestseller' };
  if (tags.includes("Chef's Pick")) return { variant: 'neon', label: "Chef's Pick" };
  if (tags.includes('New')) return { variant: 'neon-cyan', label: 'New' };
  return null;
}

// ============================================================================
//                                Main Page
// ============================================================================

export default function HomePage() {
  const [activeCategoryId, setActiveCategoryId] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutNotice, setCheckoutNotice] = useState<string | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [modifierCtx, setModifierCtx] = useState<null | {
    item: MenuItemData;
    modifiers: { id: string; name: string; required: boolean; multiSelect: boolean; minSelections: number; maxSelections: number; options: { id: string; name: string; priceDeltaCents: number; isDefault?: boolean }[] }[];
  }>(null);

  // API-driven menu state — Admin portal single source of truth
  const [apiCategories, setApiCategories] = useState<Category[] | null>(null);
  const [apiMenuItems, setApiMenuItems] = useState<MenuItemData[] | null>(null);
  const [menuSourceLabel, setMenuSourceLabel] = useState<string>('Connecting…');
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
  const [defaultTax, setDefaultTax] = useState<{ rate?: number; name?: string } | null>(null);
  const [modifierDefs, setModifierDefs] = useState<any[] | null>(null);

  const setNotice = (message: string) => {
    setCheckoutNotice(message);
    setTimeout(() => setCheckoutNotice(null), 2400);
  };

  const isOutOfStock = (item: MenuItemData) =>
    String(item.status || '').toUpperCase() === 'OUT_OF_STOCK';

  // On mount: resolve default branch and fetch menu from public API
  useEffect(() => {
    let cancelled = false;
    let interval: any = null;
    let branchIdForPolling: string | null = null;

    const fetchAndApply = async (branchId: string) => {
      // Fetch menu envelope from Admin-controlled Nest API
      const env: any = await apiGet<any>(`/public/menu?branchId=${encodeURIComponent(branchId)}`);

      // Map categories → keep "All" synthetic first entry, append real API categories
      const catIcons = ['🔥', '🍚', '🍲', '🍗', '🥟', '🥤', '🍰', '⭐', '🥗', '🍱'];
      const cats: Category[] = [
        ALL_CATEGORY,
        ...(Array.isArray(env.categories) ? env.categories : []).map((c: any, i: number) => ({
          id: String(c.id ?? c._id),
          name: String(c.name || 'Uncategorized'),
          icon: catIcons[i % catIcons.length] || '🍽️',
          blurb: String(c.description || ''),
        })),
      ];

      // Map items — divide priceCents by 100 to match local NGN_RAW integer-naira convention
      const items: MenuItemData[] = (Array.isArray(env.items) ? env.items : []).map((it: any) => {
        const priceCents = Number(it.priceCents ?? it.price ?? 0);
        const modifierIds = Array.isArray(it.modifierIds) ? it.modifierIds.map((m: any) => String(m)) : [];
        return {
          id: String(it.id ?? it._id),
          categoryId: String(it.categoryId ?? ''),
          name: String(it.name || 'Untitled'),
          description: String(it.description || ''),
          price: Math.round(priceCents / 100), // 850000 → 8500
          imageUrl: it.imageUrl || undefined,
          status: it.status || 'AVAILABLE',
          hasModifiers: modifierIds.length > 0,
          modifierIds,
          tags: Array.isArray(it.tags) ? it.tags : [],
          rating: typeof it.rating === 'number' ? it.rating : undefined,
          ratingCount: typeof it.ratingCount === 'number' ? it.ratingCount : undefined,
          prepTimeMin: typeof it.prepTimeMin === 'number' ? it.prepTimeMin : undefined,
          calories: typeof it.calories === 'number' ? it.calories : undefined,
        };
      });

      if (cancelled) return;
      setApiCategories(cats);
      setApiMenuItems(items);
      setActiveBranchId(branchId);
      setDefaultTax(env?.defaultTax ? { rate: env.defaultTax.rate, name: env.defaultTax.name } : null);
      setModifierDefs(Array.isArray(env?.modifiers) ? env.modifiers : []);
      const branchName = env.branch?.name ? String(env.branch.name) : 'Live Menu';
      setMenuSourceLabel('📡 ' + branchName);
    };

    (async () => {
      try {
        setMenuError(null);
        // Allow env override of branch id (useful for multi-location deploys)
        const envBranch =
          (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_DEFAULT_BRANCH_ID : undefined) ||
          null;
        let branchId: string | null = envBranch;

        // Resolve default branch from public branches endpoint if no override
        if (!branchId) {
          const branches = await apiGet<any[]>('/public/branches').catch(() => []);
          if (Array.isArray(branches) && branches.length > 0) {
            const def = branches.find((b: any) => b && b.isDefault) || branches[0];
            branchId = def?.id || null;
          }
        }
        if (!branchId) branchId = FALLBACK_BRANCH_ID;
        branchIdForPolling = branchId;
        await fetchAndApply(branchId);
        interval = setInterval(() => {
          if (cancelled || !branchIdForPolling) return;
          fetchAndApply(branchIdForPolling).catch(() => {});
        }, 15000);
      } catch (err) {
        if (cancelled) return;
        setApiCategories([ALL_CATEGORY]);
        setApiMenuItems([]);
        setMenuSourceLabel('⚠️ Menu unavailable');
        setMenuError(
          err instanceof Error
            ? err.message
            : 'Unable to load menu from server. Check API URL and branch configuration.'
        );
      }
    })();
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, []);

  // Debounced search term to avoid re-rendering every keystroke
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 180);
    return () => clearTimeout(t);
  }, [search]);

  // Use the shared zustand cart store (consistent with QR flow)
  const cartItems = useCart((s) => s.items);
  const addItemToCart = useCart((s) => s.addItem);
  const cartCount = cartItems.reduce((t, l) => t + l.quantity, 0);
  const cartTotalCents = cartItems.reduce(
    (t, l) => t + l.perUnitTotalCents * l.quantity,
    0
  );

  const ACTIVE_CATEGORIES = apiCategories ?? [ALL_CATEGORY];
  const ACTIVE_MENU_ITEMS = apiMenuItems ?? [];

  function addItemSimple(item: MenuItemData, qtyOverride = 1) {
    if (isOutOfStock(item)) {
      setNotice(`"${item.name}" is currently out of stock.`);
      return;
    }
    addItemToCart({
      menuItemId: item.id,
      name: item.name,
      priceCents: item.price * 100,
      perUnitTotalCents: item.price * 100,
      quantity: qtyOverride,
      imageUrl: item.imageUrl,
      selectedModifierOptions: [],
    });
  }

  // Filter menu based on category + search
  const filteredMenuItems = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return ACTIVE_MENU_ITEMS.filter(it => {
      const catOk = activeCategoryId === 'all' || it.categoryId === activeCategoryId;
      if (!catOk) return false;
      if (!q) return true;
      return (
        it.name.toLowerCase().includes(q) ||
        it.description.toLowerCase().includes(q) ||
        (it.tags ?? []).some(t => t.toLowerCase().includes(q))
      );
    });
  }, [ACTIVE_MENU_ITEMS, activeCategoryId, debouncedSearch]);

  // Attach item counts to categories
  const categoriesWithCounts = useMemo(() => ACTIVE_CATEGORIES.map(c => ({
    ...c,
    count: c.id === 'all' ? ACTIVE_MENU_ITEMS.length : ACTIVE_MENU_ITEMS.filter(m => m.categoryId === c.id).length,
  })), [ACTIVE_CATEGORIES, ACTIVE_MENU_ITEMS]);

  // Helper to build modifier groups spec compatible with ModifierSheet UI
  const buildModifierGroups = (item: MenuItemData) => {
    const groups: NonNullable<typeof modifierCtx>['modifiers'] = [];
    const byId = new Map<string, any>(
      (modifierDefs || []).map((m: any) => [String(m.id ?? m._id), m])
    );
    const ids = Array.isArray(item.modifierIds) ? item.modifierIds : [];
    for (const modId of ids) {
      const mod = byId.get(String(modId));
      if (!mod) continue;
      groups.push({
        id: String(mod.id ?? mod._id),
        name: String(mod.name || ''),
        required: Boolean(mod.required),
        multiSelect: Boolean(mod.multiSelect),
        minSelections: Number(mod.minSelections ?? 0),
        maxSelections: Number(mod.maxSelections ?? 1),
        options: (Array.isArray(mod.options) ? mod.options : []).map((o: any) => ({
          id: String(o.id),
          name: String(o.name || ''),
          priceDeltaCents: Number(o.priceDeltaCents ?? o.priceDelta ?? 0),
          isDefault: Boolean(o.isDefault),
        })),
      });
    }
    return groups;
  };

  const modifiersMap = useMemo(() => {
    const out: Record<string, { id: string; name: string; options: Record<string, string> }> = {};
    (modifierDefs || []).forEach((m: any) => {
      const id = String(m.id ?? m._id);
      const options: Record<string, string> = {};
      (Array.isArray(m.options) ? m.options : []).forEach((o: any) => {
        options[String(o.id)] = String(o.name || '');
      });
      out[id] = { id, name: String(m.name || ''), options };
    });
    return out;
  }, [modifierDefs]);

  // Scroll to the menu when a category is clicked
  const heroImg = useMemo(() => {
    return `https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=${encodeURIComponent(
      'Cinematic hero banner of a sleek upscale dark restaurant at night, neon gold and amber glow accents, smoke and steam rising from a jollof rice platter with grilled chicken and plantain, premium food photography, futuristic cyberpunk ambience, depth of field bokeh'
    )}&image_size=landscape_16_9`;
  }, []);

  const promoImg1 = useMemo(() => `https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=${encodeURIComponent('Smoky party jollof rice platter with grilled chicken, fried plantain, coleslaw, cinematic dark mood, neon amber rim lighting, premium food photography')}&image_size=landscape_16_9`, []);
  const promoImg2 = useMemo(() => `https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=${encodeURIComponent('Tender beef suya skewers dusted in yaji spice, onions and tomatoes, dark moody background, neon cyan rim lighting, premium food photography')}&image_size=landscape_16_9`, []);

  return (
    <div className="min-h-screen w-full text-white relative">
      {/* Ambient fixed gradient blobs (body background but stronger on this page) */}
      <div aria-hidden className="fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-cyber-grid opacity-[0.15] animate-grid-scroll mask-fade-b" />
        <div className="absolute -top-24 left-[10%] w-[32rem] h-[32rem] rounded-full blob bg-amber-600/20 blur-[120px]" />
        <div className="absolute top-40 right-[8%] w-[28rem] h-[28rem] rounded-full blob bg-pink-500/15 blur-[120px]" />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[40rem] h-[32rem] rounded-full blob bg-cyan-500/12 blur-[120px]" />
      </div>

      {/* -------------------- Top Navigation (sticky) -------------------- */}
      <header className="sticky top-0 z-40 w-full border-b border-white/6 bg-[#050506]/80 backdrop-blur-xl supports-[backdrop-filter]:bg-[#050506]/60">
        <div className="section py-3.5 flex items-center gap-3 sm:gap-6">
          {/* Brand */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative w-11 h-11 rounded-2xl bg-gradient-neon p-[1px] shadow-glow-restaurant shrink-0 animate-neon-pulse">
              <div className="w-full h-full rounded-[14px] bg-surface-sunken flex items-center justify-center text-xl">
                🍽️
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.18em] text-gradient-neon font-bold leading-none">
                {RESTAURANT_NAME.toUpperCase()}
              </div>
              <div className="mt-1 text-[13px] text-ink-muted flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse-soft shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
                Open now · Table service
              </div>
            </div>
          </div>

          {/* Search — desktop */}
          <div className="hidden md:block flex-1 max-w-2xl mx-auto w-full">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search dishes, soups, proteins, drinks…"
              leftIcon={
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="11" cy="11" r="7" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              }
              rightSlot={search ? (
                <IconButton size="xs" variant="ghost" title="Clear" onClick={() => setSearch('')}>
                  ✕
                </IconButton>
              ) : undefined}
            />
          </div>

          {/* Quick actions */}
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <button className="hidden sm:inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold border border-white/10 bg-white/[0.03] text-ink hover:bg-white/5 hover:text-white transition">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s-8-4.5-8-12a8 8 0 1116 0c0 7.5-8 12-8 12z" /><circle cx="12" cy="10" r="3" /></svg>
              Port Harcourt · GRA Phase 3
            </button>

            <button
              onClick={() => setCartOpen(true)}
              className={cn(
                'relative flex items-center gap-2 rounded-xl px-3 sm:px-4 py-2 font-semibold transition-all',
                'bg-gradient-neon shadow-glow-restaurant hover:brightness-110 active:brightness-95',
                cartCount > 0 && 'animate-neon-pulse'
              )}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="9" cy="21" r="1.5" /><circle cx="18" cy="21" r="1.5" />
                <path d="M3 3h2l2.4 12.3a2 2 0 002 1.7h8.2a2 2 0 002-1.6L21 8H6" />
              </svg>
              <span className="hidden sm:inline">Cart</span>
              {cartCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-pink-500 text-white text-[10px] font-bold flex items-center justify-center shadow-[0_0_10px_rgba(236,72,153,0.8)] ring-2 ring-surface-sunken">
                  {cartCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Search — mobile row */}
        <div className="md:hidden px-4 pb-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search the menu…"
            leftIcon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            }
            rightSlot={search ? (
              <IconButton size="xs" variant="ghost" title="Clear" onClick={() => setSearch('')}>✕</IconButton>
            ) : undefined}
          />
        </div>
      </header>

      {/* -------------------- Main content layout -------------------- */}
      <div id="main" className="section pt-5 pb-40 grid grid-cols-12 gap-6">
        {/* Sidebar (sticky categories) — lg+ */}
        <aside className="hidden lg:block col-span-3 xl:col-span-2">
          <div className="sticky top-[88px] space-y-5">
            <Card elevation="flat" padded="md" interactive={false} className="overflow-visible">
              <div className="mb-4">
                <h2 className="text-sm font-bold tracking-wide text-gradient-neon uppercase">Categories</h2>
                <p className="text-[11px] text-ink-muted mt-1">Jump to any section</p>
              </div>
              <nav className="flex flex-col gap-1.5">
                {categoriesWithCounts.map((c) => {
                  const active = activeCategoryId === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setActiveCategoryId(c.id)}
                      className={cn(
                        'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all duration-300 ease-out-expo',
                        active
                          ? 'bg-gradient-neon text-white shadow-glow-restaurant'
                          : 'hover:bg-white/5 text-ink-soft hover:text-white'
                      )}
                    >
                      <span className={cn(
                        'w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-lg',
                        active ? 'bg-white/15' : 'bg-white/5 group-hover:bg-white/10'
                      )}>{c.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm truncate">{c.name}</div>
                        <div className={cn('text-[11px]', active ? 'text-white/80' : 'text-ink-muted')}>
                          {c.count} items
                        </div>
                      </div>
                    </button>
                  );
                })}
              </nav>
            </Card>

            {/* Promo card */}
            <Card elevation="neon" padded={false} interactive className="overflow-hidden">
              <div className="relative h-36 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={promoImg2} alt="Suya platter" className="w-full h-full object-cover opacity-90" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#050506] via-[#050506]/60 to-transparent" />
                <div className="absolute inset-0 p-4 flex flex-col justify-end">
                  <Badge variant="neon-lime" size="xs" dot>FREE DELIVERY</Badge>
                  <div className="mt-2 font-extrabold text-white text-lg leading-tight">Friday Suya Night</div>
                  <div className="text-xs text-ink-soft">Order ₦15k+ · 20% off at checkout</div>
                </div>
              </div>
            </Card>
          </div>
        </aside>

        {/* Center content */}
        <section className="col-span-12 lg:col-span-9 xl:col-span-10 min-w-0">
          {/* Hero banner */}
          <Card elevation="neon" padded={false} interactive className="mb-6 overflow-hidden relative">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-0">
              {/* Text */}
              <div className="lg:col-span-7 order-2 lg:order-1 p-6 sm:p-8 flex flex-col justify-center relative">
                <div aria-hidden className="absolute inset-0 lg:hidden bg-gradient-mesh-hero opacity-40" />
                <div className="relative z-10">
                  <Badge variant="neon" dot size="sm" className="mb-4">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(103,232,249,0.9)] animate-pulse-soft" />
                    Table Service · 8 min avg
                  </Badge>
                  <h1 className="headline text-display mb-3">
                    Order from the <span className="text-gradient-neon animate-text-glow">future</span> of dining.
                  </h1>
                  <p className="text-sm sm:text-[15px] text-ink-soft max-w-xl leading-relaxed mb-6">
                    {RESTAURANT_NAME} — bold flavours, lightning-fast service. Pick from heritage soups,
                    signature fire-grilled plates, ice-cold Chapman and everything in between.
                  </p>
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <Button variant="neon" size="lg" onClick={() => document.getElementById('menu-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                      Browse Menu
                    </Button>
            <Button variant="outline" size="lg" onClick={() => setCartOpen(true)}>
                      My Cart {cartCount > 0 && `(${cartCount})`}
                    </Button>
                    <div className="ml-0 sm:ml-2 flex items-center gap-2 rounded-xl px-3 py-2 bg-white/[0.03] border border-white/6">
                      <div className="flex -space-x-2">
                        {['4.9', '4.8', '4.9'].map((r, i) => (
                          <div key={i} className="w-7 h-7 rounded-full ring-2 ring-surface-sunken bg-gradient-neon flex items-center justify-center text-[10px] font-bold text-white">{r[0]}{r[2]}{'★'}</div>
                        ))}
                      </div>
                      <div className="text-[11px] leading-tight">
                        <div className="font-bold">4.8 average</div>
                        <div className="text-ink-muted">12k orders this month</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Image */}
              <div className="lg:col-span-5 order-1 lg:order-2 relative min-h-[220px] sm:min-h-[280px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={heroImg} alt="Signature jollof and grilled chicken platter" className="absolute inset-0 w-full h-full object-cover" />
                <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-surface-panel via-transparent to-transparent lg:from-transparent lg:to-transparent lg:bg-gradient-to-l lg:from-transparent lg:via-transparent lg:to-surface-panel/40" />
                <div aria-hidden className="absolute inset-0 bg-cyber-grid opacity-30 mix-blend-overlay" />

                {/* Floating card 1 */}
                <div className="absolute top-5 left-5 w-[9.5rem] rounded-2xl glass-neon p-3 animate-float-slow shadow-glow-restaurant backdrop-blur-2xl">
                  <div className="text-[10px] tracking-widest uppercase text-amber-200 font-bold">Hot</div>
                  <div className="mt-1 text-sm font-extrabold truncate">Jollof & Chicken</div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="text-base font-black text-gradient-neon">₦8,500</div>
                    <div className="w-8 h-8 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center text-sm">🔥</div>
                  </div>
                </div>

                {/* Floating card 2 */}
                <div className="absolute bottom-5 right-5 w-[10.5rem] rounded-2xl glass-neon p-3 shadow-glow-accent backdrop-blur-2xl animate-float-slow" style={{ animationDelay: '-3.5s' }}>
                  <div className="flex items-center gap-2 text-[11px] text-pink-200 font-bold tracking-widest uppercase">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12V8H6l-2-2H2v12h2l2-2h12v-4h4l2-4h-6" /></svg>
                    Delivering
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] text-ink-muted">ETA</div>
                      <div className="text-base font-black text-white">22 min</div>
                    </div>
                    <div className="h-9 w-9 rounded-full bg-gradient-neon flex items-center justify-center shadow-glow-emerald">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="text-white"><polyline points="5 12 10 17 19 8" /></svg>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* Horizontal promo duo (responsive) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <Card elevation="md" padded={false} interactive className="overflow-hidden group">
              <div className="relative h-40 sm:h-44">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={promoImg1} alt="Jollof party platter" className="w-full h-full object-cover transition-transform duration-700 ease-out-expo group-hover:scale-105" />
                <div aria-hidden className="absolute inset-0 bg-gradient-to-tr from-[#050506] via-[#050506]/40 to-transparent" />
                <div className="absolute inset-0 p-5 flex flex-col justify-between">
                  <Badge variant="neon-pink" size="sm">Limited · 1h left</Badge>
                  <div>
                    <div className="text-xl font-extrabold leading-tight">Jollof Combo · 25% OFF</div>
                    <div className="text-xs text-ink-soft mt-1 max-w-[70%]">Rice, 2 protein options, plantain and drink. Use code <span className="font-mono text-pink-300">JOLLOF25</span></div>
                  </div>
                </div>
              </div>
            </Card>
            <Card elevation="md" padded={false} interactive className="overflow-hidden group relative">
              <div aria-hidden className="absolute inset-0 bg-gradient-neon opacity-70" />
              <div aria-hidden className="absolute inset-0 bg-cyber-dots opacity-30" />
              <div className="relative p-5 h-40 sm:h-44 flex flex-col justify-between text-white">
                <div className="flex items-center justify-between">
                  <Badge variant="glass" size="sm" className="!bg-white/15 !text-white !ring-white/30">Rewards · Earn 5%</Badge>
                  <div className="w-11 h-11 rounded-2xl bg-white/15 border border-white/25 flex items-center justify-center text-xl">💎</div>
                </div>
                <div>
                  <div className="text-xl font-extrabold leading-tight">Unlock Prolific Rewards</div>
                  <div className="text-xs text-white/85 mt-1 max-w-[85%]">Every ₦1000 you spend gets you points — free Chapman, free plates and more.</div>
                </div>
                <Button size="sm" variant="outline" className="mt-1 !bg-white/10 !text-white !border-white/25 self-start w-fit">Sign up free →</Button>
              </div>
            </Card>
          </div>

          {/* Category chips (mobile/tablet) + view toggle */}
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex-1 min-w-0">
              <div className="sr-only md:hidden">Categories</div>
              <div className="lg:hidden flex gap-2 overflow-x-auto scrollbar-hide pb-1 mask-fade-r pr-6 -mr-6">
                {categoriesWithCounts.map(c => {
                  const active = activeCategoryId === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setActiveCategoryId(c.id)}
                      className={cn(
                        'shrink-0 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-all duration-300 border',
                        active
                          ? 'bg-gradient-neon text-white border-transparent shadow-glow-restaurant'
                          : 'bg-white/[0.03] text-ink-soft border-white/10 hover:bg-white/[0.06] hover:text-white'
                      )}
                    >
                      <span className="text-base">{c.icon}</span>
                      <span>{c.name}</span>
                      <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full', active ? 'bg-white/20' : 'bg-white/10 text-ink-muted')}>
                        {c.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* View toggle (grid/list) + count */}
            <div className="hidden sm:flex items-center gap-2 shrink-0">
              <div className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold border',
                menuSourceLabel.startsWith('📡')
                  ? 'bg-emerald-500/10 text-emerald-300 border-emerald-400/25'
                  : menuSourceLabel.startsWith('⚠️')
                    ? 'bg-rose-500/10 text-rose-300 border-rose-400/25'
                    : 'bg-amber-500/10 text-amber-300 border-amber-400/25'
              )}>
                {menuSourceLabel}
              </div>
              <div className="text-[11px] text-ink-muted font-semibold uppercase tracking-widest">
                {filteredMenuItems.length} items
              </div>
              <div className="flex items-center p-1 rounded-xl border border-white/10 bg-white/[0.03]">
                {(['grid', 'list'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setViewMode(m)}
                    className={cn(
                      'w-9 h-9 rounded-lg inline-flex items-center justify-center transition',
                      viewMode === m ? 'bg-gradient-neon text-white shadow-sm' : 'text-ink-muted hover:text-white'
                    )}
                    aria-label={m + ' view'}
                    title={m + ' view'}
                  >
                    {m === 'grid' ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><circle cx="4" cy="6" r="1" fill="currentColor" /><circle cx="4" cy="12" r="1" fill="currentColor" /><circle cx="4" cy="18" r="1" fill="currentColor" /></svg>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Menu Grid */}
          <div id="menu-grid" className="space-y-6">
            {filteredMenuItems.length === 0 ? (
              <div className="pt-2 pb-6 animate-fade-in-up">
                {menuError ? (
                  <Card elevation="flat" padded="lg" interactive={false} className="text-center">
                    <div className="text-sm font-extrabold text-white">Couldn’t load your live menu</div>
                    <div className="mt-2 text-xs text-ink-muted max-w-xl mx-auto">
                      {menuError}
                    </div>
                    <div className="mt-4 flex justify-center">
                      <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                        Retry
                      </Button>
                    </div>
                  </Card>
                ) : debouncedSearch ? (
                  <EmptySearch query={debouncedSearch} onClear={() => setSearch('')} />
                ) : (
                  <Card elevation="flat" padded="lg" interactive={false} className="text-center">
                    <div className="text-sm font-extrabold text-white">No menu items yet</div>
                    <div className="mt-2 text-xs text-ink-muted">
                      Add menu categories and items in the Admin portal, then refresh this page.
                    </div>
                  </Card>
                )}
              </div>
            ) : (
              <>
                {/* Grouped by category when 'All' is active and no search — better UX */}
                {(activeCategoryId === 'all' && !debouncedSearch) ? (
                  ACTIVE_CATEGORIES.filter(c => c.id !== 'all').map(cat => {
                    const items = filteredMenuItems.filter(it => it.categoryId === cat.id);
                    if (items.length === 0) return null;
                    return (
                      <div key={cat.id} className="scroll-mt-28">
                        <div className="flex items-end justify-between mb-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-xl bg-gradient-neon flex items-center justify-center text-lg shadow-glow-restaurant shrink-0">
                              {cat.icon}
                            </div>
                            <div className="min-w-0">
                              <h2 className="text-xl font-extrabold tracking-tight truncate">{cat.name}</h2>
                              <p className="text-xs text-ink-muted truncate">{cat.blurb} · {items.length} dishes</p>
                            </div>
                          </div>
                          <button
                            onClick={() => setActiveCategoryId(cat.id)}
                            className="text-xs font-semibold text-amber-300 hover:text-white neon-underline shrink-0"
                          >
                            View all →
                          </button>
                        </div>
                        <MenuGridOrList
                          items={items}
                          view={viewMode}
                          onAdd={(it) => {
                            if (isOutOfStock(it)) {
                              setNotice(`"${it.name}" is currently out of stock.`);
                              return;
                            }
                            setModifierCtx({ item: it, modifiers: buildModifierGroups(it) });
                          }}
                          onQuickAdd={addItemSimple}
                        />
                      </div>
                    );
                  })
                ) : (
                  <MenuGridOrList
                    items={filteredMenuItems}
                    view={viewMode}
                    onAdd={(it) => {
                      if (isOutOfStock(it)) {
                        setNotice(`"${it.name}" is currently out of stock.`);
                        return;
                      }
                      setModifierCtx({ item: it, modifiers: buildModifierGroups(it) });
                    }}
                    onQuickAdd={addItemSimple}
                  />
                )}
              </>
            )}
          </div>
        </section>
      </div>

      {/* -------------------- Floating Cart Pill -------------------- */}
      {cartCount > 0 && (
        <div className="fixed z-40 left-0 right-0 sm:left-1/2 sm:-translate-x-1/2 bottom-4 sm:bottom-6 px-4 sm:px-0 max-w-lg w-full sm:w-auto pointer-events-none sm:pointer-events-auto">
          <div className={cn(
            'pointer-events-auto rounded-2xl sm:rounded-[1.4rem] glass-neon px-4 py-3 sm:px-5 sm:py-4 shadow-2xl border border-white/15 flex items-center gap-3 sm:gap-4 backdrop-blur-xl',
            'shadow-glow-restaurant'
          )}>
            <div className="relative shrink-0">
              <div className="w-12 h-12 rounded-2xl bg-gradient-neon flex items-center justify-center shadow-glow-accent animate-neon-pulse">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-white"><circle cx="9" cy="21" r="1.5" /><circle cx="18" cy="21" r="1.5" /><path d="M3 3h2l2.4 12.3a2 2 0 002 1.7h8.2a2 2 0 002-1.6L21 8H6" /></svg>
              </div>
              <div className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-pink-500 text-white text-[11px] font-black flex items-center justify-center shadow-[0_0_10px_rgba(236,72,153,0.85)] ring-2 ring-surface-sunken">
                {cartCount}
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] uppercase tracking-[0.14em] text-white/70 font-bold">Your Order</div>
              <div className="text-lg font-black text-gradient-neon tabular-nums">{NGN(cartTotalCents)}</div>
            </div>
            <Button variant="neon" size="lg" onClick={() => setCartOpen(true)}>
              View Cart
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="ml-1"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
            </Button>
          </div>
        </div>
      )}

      {/* -------------------- Sheets -------------------- */}
      <CartSheet
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        onCheckout={() => {
          setCartOpen(false);
          setCheckoutOpen(true);
        }}
        defaultTax={defaultTax}
        modifiersMap={modifiersMap}
      />
      <CheckoutSheet
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        defaultTax={defaultTax}
        mode="DIRECT"
        directBranchId={activeBranchId || undefined}
        onOrderSubmitted={(_order, orderId) => {
          setCheckoutOpen(false);
          if (typeof window !== 'undefined') {
            window.location.assign(`/orders/${orderId}`);
          }
        }}
      />
      {checkoutNotice && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 animate-fade-in-down">
          <div className="glass-neon rounded-2xl px-5 py-3 shadow-glow-restaurant border border-amber-400/30 text-sm font-semibold text-white">
            {checkoutNotice}
          </div>
        </div>
      )}
      {modifierCtx && (
        <ModifierSheet
          open={!!modifierCtx}
          onClose={() => setModifierCtx(null)}
          itemName={modifierCtx.item.name}
          basePriceCents={modifierCtx.item.price * 100}
          modifiers={modifierCtx.modifiers}
          onConfirm={(selections, specialInstructions) => {
            // Build option → price delta map
            const deltaMap = new Map<string, number>();
            modifierCtx.modifiers.forEach((m) => {
              m.options.forEach((o) => deltaMap.set(`${m.id}:${o.id}`, o.priceDeltaCents));
            });
            let totalDelta = 0;
            selections.forEach(({ modifierId, optionId }) => {
              totalDelta += deltaMap.get(`${modifierId}:${optionId}`) ?? 0;
            });
            addItemToCart({
              menuItemId: modifierCtx.item.id,
              name: modifierCtx.item.name,
              priceCents: modifierCtx.item.price * 100,
              perUnitTotalCents: modifierCtx.item.price * 100 + totalDelta,
              quantity: 1,
              imageUrl: modifierCtx.item.imageUrl,
              specialInstructions,
              selectedModifierOptions: selections,
            });
            setModifierCtx(null);
          }}
        />
      )}
    </div>
  );
}

// ============================================================================
//                           Menu Grid / List Renderer
// ============================================================================

function MenuGridOrList({
  items, view, onAdd, onQuickAdd,
}: {
  items: MenuItemData[];
  view: 'grid' | 'list';
  onAdd: (it: MenuItemData) => void;
  onQuickAdd: (it: MenuItemData) => void;
}) {
  return view === 'grid' ? (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4 gap-4 sm:gap-5">
      {items.map((item, i) => (
        <MenuGridCard key={item.id} item={item} index={i} onAdd={onAdd} onQuickAdd={onQuickAdd} />
      ))}
    </div>
  ) : (
    <div className="flex flex-col gap-3">
      {items.map((item, i) => (
        <MenuListCard key={item.id} item={item} index={i} onAdd={onAdd} onQuickAdd={onQuickAdd} />
      ))}
    </div>
  );
}

// -------- Grid card (e-commerce food style) --------
function MenuGridCard({ item, index, onAdd, onQuickAdd }: { item: MenuItemData; index: number; onAdd: (it: MenuItemData) => void; onQuickAdd: (it: MenuItemData) => void }) {
  const [imgFailed, setImgFailed] = useState(false);
  const tags = useMemo(() => deriveTags(item), [item]);
  const rating = useMemo(() => deriveRating(item), [item]);
  const star = starBadgeFor(tags);
  const outOfStock = String(item.status || '').toUpperCase() === 'OUT_OF_STOCK';

  const imgUrl = useMemo(() => {
    if (item.imageUrl && !imgFailed) return item.imageUrl;
    const prompt = encodeURIComponent(`Premium food photography of ${item.name}, ${item.description}, dark moody cinematic lighting, neon gold and amber rim accents, restaurant table, steam, shallow depth of field`);
    return `https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=${prompt}&image_size=square_hd`;
  }, [item, imgFailed]);

  return (
    <Card
      elevation="md"
      padded={false}
      interactive
      className={cn(
        'group overflow-hidden animate-fade-in-up',
        outOfStock && 'opacity-60 grayscale'
      )}
      style={{ animationDelay: `${Math.min(index, 12) * 50}ms` }}
    >
      {/* Media */}
      <div className="relative aspect-[4/3] overflow-hidden bg-surface-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imgUrl}
          alt={item.name}
          loading="lazy"
          onError={() => setImgFailed(true)}
          className="w-full h-full object-cover transition-transform duration-700 ease-out-expo group-hover:scale-[1.06]"
        />
        {/* Grain / grid overlay */}
        <div aria-hidden className="absolute inset-0 bg-cyber-grid opacity-30 mix-blend-overlay pointer-events-none" />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-surface-sunken/80 via-transparent to-transparent" />

        {/* Top tags */}
        <div className="absolute top-3 left-3 right-3 flex items-start justify-between gap-2">
          <div className="flex flex-wrap gap-1.5 max-w-[80%]">
            {outOfStock && <Badge variant="danger" size="xs" dot>Out of stock</Badge>}
            {star && <Badge variant={star.variant} size="xs" dot className="capitalize">{star.label}</Badge>}
            {tags.filter(t => t !== star?.label).slice(0, 1).map(t => (
              <Badge key={t} variant="glass" size="xs" className="!text-white">{t}</Badge>
            ))}
          </div>
          <button
            aria-label="Save to favourites"
            onClick={(e) => { e.stopPropagation(); }}
            className="w-9 h-9 rounded-full bg-white/10 backdrop-blur border border-white/20 text-white/80 hover:text-pink-400 hover:bg-pink-500/20 hover:border-pink-400/40 flex items-center justify-center transition"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.6l-1-1a5.5 5.5 0 00-7.8 7.8l1 1L12 21l7.8-7.8 1-1a5.5 5.5 0 000-7.6z" /></svg>
          </button>
        </div>

        {/* Bottom meta */}
        <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2 text-white/90">
          <div className="flex items-center gap-1.5 text-[11px] font-bold">
            <span
              className={cn(
                'w-1.5 h-1.5 rounded-full',
                outOfStock
                  ? 'bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.9)]'
                  : 'bg-lime-400 shadow-[0_0_8px_rgba(190,242,100,0.9)]'
              )}
            />
            {item.prepTimeMin ?? 15}–{((item.prepTimeMin ?? 15) + 6)} min
          </div>
          <div className="flex items-center gap-1 rounded-full bg-black/35 backdrop-blur px-2 py-1 text-[11px] font-bold border border-white/10">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="#FACC15" stroke="#FACC15" strokeWidth="1" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
            {rating.toFixed(1)}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="p-4 sm:p-5">
        <div className="flex items-start gap-3 min-h-[3.25rem]">
          <h3 className="font-extrabold text-white text-[15.5px] leading-snug line-clamp-2 flex-1">{item.name}</h3>
        </div>
        <p className="mt-1.5 text-xs text-ink-muted leading-relaxed line-clamp-2 min-h-[2.25rem]">
          {item.description}
        </p>

        {/* Divider */}
        <div className="mt-4 rule" />

        {/* Footer row */}
        <div className="mt-3 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.14em] text-ink-muted font-bold">Price</div>
            <div className="text-xl font-black text-gradient-neon tabular-nums">{NGN_RAW(item.price)}</div>
          </div>
          <div className="flex items-center gap-1.5">
            {item.hasModifiers ? (
              <Button size="md" variant="neon" disabled={outOfStock} onClick={() => onAdd(item)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="mr-1"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                Customize
              </Button>
            ) : (
              <Button size="md" variant="neon-cyan" disabled={outOfStock} onClick={() => onQuickAdd(item)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="mr-1"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                Add
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

// -------- List card (compact e-commerce) --------
function MenuListCard({ item, index, onAdd, onQuickAdd }: { item: MenuItemData; index: number; onAdd: (it: MenuItemData) => void; onQuickAdd: (it: MenuItemData) => void }) {
  const [imgFailed, setImgFailed] = useState(false);
  const tags = useMemo(() => deriveTags(item), [item]);
  const rating = useMemo(() => deriveRating(item), [item]);
  const star = starBadgeFor(tags);
  const outOfStock = String(item.status || '').toUpperCase() === 'OUT_OF_STOCK';
  const imgUrl = useMemo(() => {
    if (item.imageUrl && !imgFailed) return item.imageUrl;
    const prompt = encodeURIComponent(`Premium food photography of ${item.name}, ${item.description}, dark moody cinematic lighting, neon gold and amber rim accents, restaurant table, steam, shallow depth of field`);
    return `https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=${prompt}&image_size=square_hd`;
  }, [item, imgFailed]);

  return (
    <Card
      elevation="sm"
      padded={false}
      interactive
      className={cn(
        'group overflow-hidden flex animate-fade-in-up',
        outOfStock && 'opacity-60 grayscale'
      )}
      style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
    >
      <div className="relative w-40 sm:w-48 shrink-0 aspect-square overflow-hidden bg-surface-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imgUrl}
          alt={item.name}
          loading="lazy"
          onError={() => setImgFailed(true)}
          className="w-full h-full object-cover transition-transform duration-700 ease-out-expo group-hover:scale-105"
        />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-surface-panel/80" />
        {star && (
          <div className="absolute top-2.5 left-2.5">
            <Badge variant={star.variant} size="xs" dot className="capitalize">{star.label}</Badge>
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0 p-4 flex flex-col">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-extrabold text-white text-[15.5px] leading-snug line-clamp-1">{item.name}</h3>
            <p className="mt-1 text-xs text-ink-muted leading-relaxed line-clamp-2">{item.description}</p>
          </div>
          <div className="text-right shrink-0">
            <div className="text-xl font-black text-gradient-neon tabular-nums">{NGN_RAW(item.price)}</div>
            <div className="mt-1 text-[11px] text-ink-muted font-medium">Per portion</div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {outOfStock && <Badge variant="danger" size="xs" dot>Out of stock</Badge>}
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/5 border border-white/10 px-2.5 py-1 text-[11px] font-semibold text-ink-soft">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="#FACC15" stroke="#FACC15" strokeWidth="1" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
            {rating.toFixed(1)} <span className="text-ink-muted">({item.ratingCount ?? Math.round(120 + ((index * 37) % 900))})</span>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/5 border border-white/10 px-2.5 py-1 text-[11px] font-semibold text-ink-soft">
            <span
              className={cn(
                'w-1.5 h-1.5 rounded-full',
                outOfStock
                  ? 'bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.9)]'
                  : 'bg-lime-400 shadow-[0_0_8px_rgba(190,242,100,0.9)]'
              )}
            />
            {item.prepTimeMin ?? 15}–{((item.prepTimeMin ?? 15) + 6)} min
          </div>
          {tags.filter(t => t !== star?.label).slice(0, 2).map(t => (
            <Badge key={t} variant="glass" size="xs" className="!text-white">{t}</Badge>
          ))}
        </div>

        <div className="mt-auto pt-3 flex items-center justify-end gap-2">
          <Button size="sm" variant="outline" disabled={outOfStock} onClick={() => onAdd(item)}>View</Button>
          {item.hasModifiers ? (
            <Button size="sm" variant="neon" disabled={outOfStock} onClick={() => onAdd(item)}>Customize</Button>
          ) : (
            <Button size="sm" variant="neon-cyan" disabled={outOfStock} onClick={() => onQuickAdd(item)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="mr-1"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              Add
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

// ---------------- cn helper (local) ----------------
function cn(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(' ');
}
