'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { MenuCategory, MenuItem } from '@prolific/shared-types';
import CategoryRail from './CategoryRail';
import MenuItemTile from './MenuItemTile';
import {
  fetchPublicMenu,
  resolveDefaultBranchId,
  listPublicBranches,
} from '@/lib/remote-menu';
import { applyRemoteMenuSnapshot, readOfflineMenuSnapshotMirror } from '@/lib/mock-electron-shim';

interface MenuGridProps {
  /**
   * The authenticated employee's branch ID — this is the CANONICAL branch for
   * menu fetching. If not provided (dev-only fallback), MenuGrid resolves the
   * default public branch, but production always passes this prop so admin
   * uploads made against the logged-in cashier's branch are reflected instantly.
   */
  branchId?: string | null;
  onItemAdded: (
    item: MenuItem,
    modifiers: { modifierId: string; optionIds: string[] }[]
  ) => void;
}

export default function MenuGrid({ branchId, onItemAdded }: MenuGridProps) {
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [allItems, setAllItems] = useState<MenuItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [sourceLabel, setSourceLabel] = useState<string>('connecting…');
  const debounceRef = useRef<number | null>(null);

  const refresh = async () => {
    try {
      // Resolve branch: prefer the caller-supplied branch (logged-in cashier's
      // branch) over any default-public-branch guess. This ensures admin menu
      // uploads made under the employee's branch are shown immediately.
      let resolvedBranchId: string | null = branchId || null;
      if (!resolvedBranchId) {
        resolvedBranchId = await resolveDefaultBranchId();
      }
      if (resolvedBranchId) {
        const { categories: apiCats, items: apiItems, modifiers: apiMods } =
          await fetchPublicMenu(resolvedBranchId);
        // Write BOTH cache layers so every POS consumer (ModifierModal,
        // CartPanel, search, etc.) immediately sees admin-uploaded changes:
        //  (a) mock-electron-shim in-memory snapshot (browser mode)
        //  (b) Electron SQLite persistence (desktop mode via IPC)
        applyRemoteMenuSnapshot({
          categories: apiCats,
          items: apiItems,
          modifiers: apiMods,
        });
        try {
          await window.electronAPI?.db?.menu?.applySnapshot?.({
            categories: apiCats,
            items: apiItems,
            modifiers: apiMods,
          });
        } catch {}
        setCategories(
          apiCats.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)),
        );
        setAllItems(apiItems);
        try {
          const list = await listPublicBranches();
          const current = list.find((b) => b.id === resolvedBranchId);
          setSourceLabel(current ? `📡 ${current.name}` : '📡 Live Menu');
        } catch {
          setSourceLabel('📡 Live Menu');
        }
        return;
      }
    } catch (err: any) {
      console.warn('[menu] remote menu unavailable, using local source', err?.message || err);
    }

    // Local fallback: Electron IPC on desktop or the in-memory mock shim in
    // pure browser preview mode. Only reached when the server is truly down.
    // Also reads the localStorage offline mirror (populated on every
    // successful live fetch) so page refresh + full network loss still
    // renders the admin-uploaded menu we last saw online, NEVER the SEEDED
    // demo hardcoded data on production hostnames.
    try {
      let cats: MenuCategory[] = [];
      let items: MenuItem[] = [];
      const [catsRes, itemsRes]: any[] = await Promise.all([
        window.electronAPI?.db?.menuCategories?.listAll?.() || [],
        window.electronAPI?.db?.menuItems?.list?.() || [],
      ]);
      cats = Array.isArray(catsRes)
        ? catsRes
        : ((catsRes as any)?.data as MenuCategory[]) || [];
      items = Array.isArray(itemsRes)
        ? itemsRes
        : ((itemsRes as any)?.data as MenuItem[]) || [];

      // If electronAPI returned nothing (pure browser mode and the in-memory
      // snapshot hasn't warmed up yet, e.g. IIFE couldn't guess branchId),
      // also try the direct localStorage offline mirror of the last
      // successful live fetch for the provided branchId.
      if (cats.length === 0 && items.length === 0) {
        const mirror = readOfflineMenuSnapshotMirror(branchId || null);
        if (mirror) {
          cats = Array.isArray(mirror.categories) ? (mirror.categories as MenuCategory[]) : [];
          items = Array.isArray(mirror.items) ? (mirror.items as MenuItem[]) : [];
        }
      }

      setCategories(cats.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)));
      setAllItems(items);
      setSourceLabel('💾 Offline Menu');
    } catch (e) {
      console.warn('[menu] local refresh failed', e);
      setSourceLabel('⚠️ Unavailable');
    }
  };

  // Fetch every 8 seconds (faster than before) so admin menu uploads show
  // within one interactive cycle. Also re-fetch when the caller changes the
  // branchId prop (switching branches or login context changes).
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000);
    const onFocus = () => {
      void refresh();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [branchId]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearching(false);
      return;
    }
    setSearching(true);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      try {
        const res: any =
          (await window.electronAPI?.db?.menuItems?.search?.(searchQuery.trim())) || [];
        const list = Array.isArray(res) ? res : (res?.data as MenuItem[]) || [];
        setAllItems((prev) => {
          const existingIds = new Set(prev.map((p) => p.id));
          const extras = (list as MenuItem[]).filter((m) => !existingIds.has(m.id));
          return [...prev, ...extras];
        });
      } catch (e) {
        console.warn('[menu] search failed', e);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [searchQuery]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let items = allItems;
    if (activeCategoryId) {
      items = items.filter((i) => i.categoryId === activeCategoryId);
    }
    if (q) {
      items = items.filter(
        (i) =>
          (i.name || '').toLowerCase().includes(q) ||
          (i.description || '').toLowerCase().includes(q)
      );
    }
    return items.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  }, [allItems, activeCategoryId, searchQuery]);

  const countsByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    for (const it of allItems) {
      if (!it.categoryId) continue;
      map[it.categoryId] = (map[it.categoryId] || 0) + 1;
    }
    return map;
  }, [allItems]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="p-6 pb-4 border-b border-white/5 bg-slate-900/30">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="flex-1 flex items-center gap-3 min-w-0">
            <div className="relative flex-1 max-w-xl min-w-0">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl text-slate-500">
                🔍
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search meals, ingredients, SKU…"
                className="input pl-12 pr-14 min-h-14 text-base"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 btn-ghost !min-h-9 !px-3 text-sm"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Source-of-truth indicator: shows "📡 <branch name>" when admin
                data is live, "💾 Offline Menu" when server is unreachable. */}
            <span
              className={
                'hidden sm:inline-flex items-center gap-2 rounded-2xl px-3.5 py-2 text-[11px] font-bold uppercase tracking-[0.16em] ring-1 ring-inset select-none ' +
                (sourceLabel.startsWith('📡')
                  ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-400/30'
                  : sourceLabel.startsWith('💾')
                    ? 'bg-sky-500/10 text-sky-300 ring-sky-400/30'
                    : 'bg-amber-500/10 text-amber-300 ring-amber-400/30')
              }
              title={
                sourceLabel.startsWith('📡')
                  ? 'Menu source: Admin-controlled Nest server (live)'
                  : sourceLabel.startsWith('💾')
                    ? 'Menu source: Local demo seed (server not reachable)'
                    : 'Menu source: unknown'
              }
            >
              {sourceLabel}
            </span>
            <button
              onClick={() => {
                console.log('[menu] manual refresh');
                refresh();
              }}
              className="btn-secondary !min-h-14 !px-4"
              title="Refresh menu"
            >
              🔄
            </button>
          </div>
        </div>

        <CategoryRail
          categories={categories}
          activeCategoryId={activeCategoryId}
          onSelect={(cid) => setActiveCategoryId(cid || null)}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-6 min-h-0">
        {searching ? (
          <div className="text-center py-20 text-slate-400">Searching menu…</div>
        ) : filteredItems.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-6xl mb-4">🍽️</div>
            <h3 className="text-lg font-bold text-white mb-1">No items found</h3>
            <p className="text-slate-400 text-sm max-w-md mx-auto">
              {searchQuery
                ? `No matches for “${searchQuery}”.`
                : activeCategoryId
                  ? `No items in this category yet.`
                  : `No menu items have been added yet.`}
            </p>
            <p className="text-slate-500 mt-3 text-sm max-w-md mx-auto">
              {searchQuery
                ? `Try a different search term, or use the Admin panel to enable menu items.`
                : activeCategoryId
                  ? `Switch to the All Items tab, or use the search bar above to find something in another category.`
                  : `Use the Admin panel to create categories and add menu items — once your Admin menu has active categories and items, they'll appear here both online and offline after the next sync.`}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filteredItems.map((item) => (
              <MenuItemTile key={item.id} item={item} onAdded={onItemAdded} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
