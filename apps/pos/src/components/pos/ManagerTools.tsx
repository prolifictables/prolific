'use client';

import { useEffect, useMemo, useState } from 'react';
import type { MenuCategory, MenuItem, MenuModifier } from '@prolific/shared-types';
import {
  listAdminCategories,
  createAdminCategory,
  updateAdminCategory,
  deleteAdminCategory,
  listAdminMenuItems,
  createAdminMenuItem,
  updateAdminMenuItem,
  deleteAdminMenuItem,
  listAdminModifiers,
  createAdminModifier,
  updateAdminModifier,
  deleteAdminModifier,
  type AdminCategoryInput,
  type AdminMenuItemInput,
  type AdminModifierInput,
  type AdminModifierOptionInput,
} from '../../lib/remote-menu-admin';
import { formatCentsToNgn } from '../../lib/ui-helpers';

type ManagerSubTab = 'ITEMS' | 'CATEGORIES' | 'MODIFIERS';

const SUB_TABS: { id: ManagerSubTab; label: string; icon: string; desc: string }[] = [
  { id: 'ITEMS', label: 'Items', icon: '🍲', desc: 'Menu dishes & drinks' },
  { id: 'CATEGORIES', label: 'Categories', icon: '🗂️', desc: 'Item groupings' },
  { id: 'MODIFIERS', label: 'Modifiers', icon: '🎚️', desc: 'Add-ons & options' },
];

interface ManagerToolsProps {
  accessToken: string;
  restaurantId?: string;
  branchId?: string;
  employeeRole?: string;
  connectionStatus: 'ONLINE' | 'OFFLINE' | 'CHECKING' | 'WAKING';
  onMenuChanged: () => Promise<void> | void;
}

// Debounced every-word (AND) search matching — user preference from memory:
// case-insensitive, punctuation-tolerant, "Google-like" speed.
function buildSearchScorer(queryRaw: string): (haystack: string) => boolean {
  const normalized = queryRaw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim();
  if (!normalized) return () => true;
  const terms = normalized.split(/\s+/).filter(Boolean);
  return (haystack) => {
    const h = haystack.toLowerCase();
    return terms.every((t) => h.includes(t));
  };
}

const DEBOUNCE_MS = 80;
function useDebounced<T>(value: T, ms = DEBOUNCE_MS): T {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setOut(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return out;
}

export default function ManagerTools(props: ManagerToolsProps) {
  const { accessToken, connectionStatus, onMenuChanged } = props;
  const [subTab, setSubTab] = useState<ManagerSubTab>('ITEMS');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search);

  // ========== Categories state ==========
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [catEditorOpen, setCatEditorOpen] = useState(false);
  const [catEditing, setCatEditing] = useState<MenuCategory | null>(null);
  const [catSaving, setCatSaving] = useState(false);

  // ========== Items state ==========
  const [items, setItems] = useState<MenuItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [itemEditorOpen, setItemEditorOpen] = useState(false);
  const [itemEditing, setItemEditing] = useState<MenuItem | null>(null);
  const [itemSaving, setItemSaving] = useState(false);

  // ========== Modifiers state ==========
  const [modifiers, setModifiers] = useState<MenuModifier[]>([]);
  const [modifiersLoading, setModifiersLoading] = useState(false);
  const [modifiersError, setModifiersError] = useState<string | null>(null);
  const [modEditorOpen, setModEditorOpen] = useState(false);
  const [modEditing, setModEditing] = useState<MenuModifier | null>(null);
  const [modSaving, setModSaving] = useState(false);

  const online = connectionStatus === 'ONLINE';

  // ========== Data loading ==========
  const refreshCategories = async (silent = false) => {
    if (!silent) { setCategoriesLoading(true); setCategoriesError(null); }
    try {
      const res = await listAdminCategories(accessToken);
      setCategories(res);
    } catch (e: any) {
      if (!silent) setCategoriesError(e?.message || 'Failed to load categories');
    } finally {
      if (!silent) setCategoriesLoading(false);
    }
  };

  const refreshItems = async (silent = false) => {
    if (!silent) { setItemsLoading(true); setItemsError(null); }
    try {
      const res = await listAdminMenuItems(accessToken, { limit: 300 });
      setItems(res);
    } catch (e: any) {
      if (!silent) setItemsError(e?.message || 'Failed to load items');
    } finally {
      if (!silent) setItemsLoading(false);
    }
  };

  const refreshModifiers = async (silent = false) => {
    if (!silent) { setModifiersLoading(true); setModifiersError(null); }
    try {
      const res = await listAdminModifiers(accessToken);
      setModifiers(res);
    } catch (e: any) {
      if (!silent) setModifiersError(e?.message || 'Failed to load modifiers');
    } finally {
      if (!silent) setModifiersLoading(false);
    }
  };

  const refreshAll = (silent = false) => {
    refreshCategories(silent);
    refreshItems(silent);
    refreshModifiers(silent);
  };

  // Initial load + periodic 20s soft refresh while tab is open
  useEffect(() => {
    refreshAll();
    const id = window.setInterval(() => refreshAll(true), 20_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const triggerCrossTally = async () => {
    // After a successful save: (1) soft-refresh local lists (2) tell parent
    // to dual-write the public menu snapshot (in-memory + localStorage offline).
    refreshAll(true);
    try {
      await onMenuChanged();
    } catch {}
  };

  // ========== Filtered lists (search) ==========
  const filteredCategories = useMemo(() => {
    const score = buildSearchScorer(debouncedSearch);
    return categories.filter((c) =>
      score(`${c.name} ${c.description ?? ''}`)
    );
  }, [categories, debouncedSearch]);

  const filteredItems = useMemo(() => {
    const score = buildSearchScorer(debouncedSearch);
    const catNameById = new Map(categories.map((c) => [c.id || (c as any)._id, c.name]));
    return items.filter((it) => {
      const cname = catNameById.get(it.categoryId) ?? '';
      return score(`${it.name} ${it.description ?? ''} ${cname}`);
    });
  }, [items, categories, debouncedSearch]);

  const filteredModifiers = useMemo(() => {
    const score = buildSearchScorer(debouncedSearch);
    return modifiers.filter((m) =>
      score(`${m.name} ${m.description ?? ''} ${(m.options ?? []).map((o: any) => o.name).join(' ')}`)
    );
  }, [modifiers, debouncedSearch]);

  // ========== Save handlers ==========
  const handleSaveCategory = async (input: AdminCategoryInput) => {
    setCatSaving(true);
    try {
      if (catEditing) {
        const id = catEditing.id || (catEditing as any)._id;
        await updateAdminCategory(accessToken, id, input);
      } else {
        await createAdminCategory(accessToken, input);
      }
      setCatEditorOpen(false);
      setCatEditing(null);
      await triggerCrossTally();
    } finally {
      setCatSaving(false);
    }
  };

  const handleDeleteCategory = async (cat: MenuCategory) => {
    if (!window.confirm(`Delete category "${cat.name}"? (items inside will not be deleted)`)) return;
    const id = cat.id || (cat as any)._id;
    try {
      await deleteAdminCategory(accessToken, id);
      await triggerCrossTally();
    } catch (e: any) {
      alert(e?.message || 'Delete failed');
    }
  };

  const handleSaveItem = async (input: AdminMenuItemInput) => {
    setItemSaving(true);
    try {
      if (itemEditing) {
        const id = itemEditing.id || (itemEditing as any)._id;
        await updateAdminMenuItem(accessToken, id, input);
      } else {
        await createAdminMenuItem(accessToken, input);
      }
      setItemEditorOpen(false);
      setItemEditing(null);
      await triggerCrossTally();
    } finally {
      setItemSaving(false);
    }
  };

  const handleDeleteItem = async (it: MenuItem) => {
    if (!window.confirm(`Delete item "${it.name}"?`)) return;
    const id = it.id || (it as any)._id;
    try {
      await deleteAdminMenuItem(accessToken, id);
      await triggerCrossTally();
    } catch (e: any) {
      alert(e?.message || 'Delete failed');
    }
  };

  const handleSaveModifier = async (input: AdminModifierInput) => {
    setModSaving(true);
    try {
      if (modEditing) {
        const id = modEditing.id || (modEditing as any)._id;
        await updateAdminModifier(accessToken, id, input);
      } else {
        await createAdminModifier(accessToken, input);
      }
      setModEditorOpen(false);
      setModEditing(null);
      await triggerCrossTally();
    } finally {
      setModSaving(false);
    }
  };

  const handleDeleteModifier = async (m: MenuModifier) => {
    if (!window.confirm(`Delete modifier "${m.name}"?`)) return;
    const id = m.id || (m as any)._id;
    try {
      await deleteAdminModifier(accessToken, id);
      await triggerCrossTally();
    } catch (e: any) {
      alert(e?.message || 'Delete failed');
    }
  };

  // ===================== RENDER =====================
  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 relative">
      {/* Top rail: connection pill, title, search, add button */}
      <header className="shrink-0 px-6 py-4 border-b border-white/5 flex items-center gap-4 relative">
        <div className="absolute inset-0 bg-gradient-to-r from-amber-500/5 via-transparent to-cyan-500/5 pointer-events-none" />
        <div className="relative flex items-center gap-3 min-w-0">
          <div className="text-3xl">🛠️</div>
          <div className="min-w-0">
            <h1 className="text-lg font-black text-white leading-none">Manager Tools</h1>
            <p className="text-[11px] text-ink-300 mt-1">
              Menu editor — edits sync across POS, Admin portal and Website
            </p>
          </div>
        </div>

        {/* Connection status pill — amber = not online (editing blocked) */}
        <div className={`ml-2 shrink-0 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.14em] ring-1 ring-inset ${
          online
            ? 'bg-emerald-500/10 text-emerald-200 ring-emerald-400/30'
            : 'bg-amber-500/15 text-amber-200 ring-amber-400/40 animate-pulse-soft'
        }`}>
          <span className="inline-block w-1.5 h-1.5 rounded-full mr-2 align-middle"
            style={{ background: online ? '#34d399' : '#fbbf24', boxShadow: online ? '0 0 8px rgba(52,211,153,0.6)' : '0 0 8px rgba(251,191,36,0.6)' }}
          />
          {online ? 'Online' : connectionStatus === 'CHECKING' ? 'Checking server…' : connectionStatus === 'WAKING' ? 'Waking server…' : 'Offline'}
        </div>

        <div className="flex-1" />

        {/* Search */}
        <div className="relative shrink-0 w-72">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${subTab.toLowerCase()}…`}
            className="w-full h-10 pl-10 pr-3 rounded-xl bg-slate-800/40 border border-white/10 text-white placeholder-ink-400 focus:outline-none focus:border-amber-400/50 focus:ring-2 focus:ring-amber-400/20 text-sm"
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 text-lg">🔍</span>
        </div>

        {/* Add button — disabled offline */}
        <button
          onClick={() => {
            if (subTab === 'ITEMS') { setItemEditing(null); setItemEditorOpen(true); }
            else if (subTab === 'CATEGORIES') { setCatEditing(null); setCatEditorOpen(true); }
            else { setModEditing(null); setModEditorOpen(true); }
          }}
          disabled={!online}
          className={`shrink-0 h-10 px-4 rounded-xl font-black text-sm transition-all active:scale-[0.97] ring-1 ring-inset flex items-center gap-2 ${
            online
              ? 'bg-gradient-to-b from-amber-500/90 to-amber-600 text-slate-900 ring-amber-400/50 shadow-[0_4px_20px_-8px_rgba(251,191,36,0.55)] hover:brightness-105'
              : 'bg-slate-700/40 text-ink-400 ring-white/10 cursor-not-allowed'
          }`}
          title={online ? `Add new ${subTab.slice(0, -1).toLowerCase()}` : 'Connect to the internet to add entries'}
        >
          <span className="text-base">＋</span>
          New
        </button>
      </header>

      {/* Sub-tabs */}
      <div className="shrink-0 px-6 py-3 border-b border-white/5 flex items-center gap-2">
        {SUB_TABS.map((t) => {
          const active = subTab === t.id;
          const counts = t.id === 'ITEMS' ? items.length : t.id === 'CATEGORIES' ? categories.length : modifiers.length;
          return (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              className={`h-11 px-4 rounded-xl transition-all active:scale-[0.97] flex items-center gap-2.5 font-black text-sm ring-1 ring-inset ${
                active
                  ? 'text-white ring-amber-400/40 shadow-[0_0_24px_-10px_rgba(251,191,36,0.7)]'
                  : 'text-ink-300 hover:text-white ring-white/5 hover:ring-white/15'
              }`}
              style={active ? { background: 'linear-gradient(180deg, rgba(255,215,0,0.16), rgba(205,127,50,0.10))' } : { background: 'rgba(255,255,255,0.02)' }}
              title={t.desc}
            >
              <span className="text-xl">{t.icon}</span>
              <span>{t.label}</span>
              <span className={`ml-1 px-2 py-0.5 rounded-md text-[10px] font-black ${active ? 'bg-amber-400/20 text-amber-100' : 'bg-slate-700/40 text-ink-300'}`}>
                {counts}
              </span>
            </button>
          );
        })}

        <div className="flex-1" />
        {!online && (
          <p className="text-[11px] text-amber-300/80 flex items-center gap-1.5">
            <span>⚠️</span>
            All edits disabled until server connection returns.
          </p>
        )}
      </div>

      {/* Body: list area */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
        {subTab === 'CATEGORIES' && (
          <ListView
            loading={categoriesLoading}
            error={categoriesError}
            empty={filteredCategories.length === 0}
            emptyText={categories.length === 0 ? 'No categories yet. Click "New" to create one.' : 'No categories match your search.'}
            rows={filteredCategories}
            renderRow={(c) => (
              <CategoryRow
                cat={c}
                online={online}
                onEdit={() => { setCatEditing(c); setCatEditorOpen(true); }}
                onDelete={() => handleDeleteCategory(c)}
              />
            )}
            onRetry={() => refreshCategories()}
          />
        )}
        {subTab === 'ITEMS' && (
          <ListView
            loading={itemsLoading}
            error={itemsError}
            empty={filteredItems.length === 0}
            emptyText={items.length === 0 ? 'No items yet. Click "New" to add a dish.' : 'No items match your search.'}
            rows={filteredItems}
            renderRow={(it) => (
              <ItemRow
                item={it}
                categories={categories}
                online={online}
                onEdit={() => { setItemEditing(it); setItemEditorOpen(true); }}
                onDelete={() => handleDeleteItem(it)}
              />
            )}
            onRetry={() => refreshItems()}
          />
        )}
        {subTab === 'MODIFIERS' && (
          <ListView
            loading={modifiersLoading}
            error={modifiersError}
            empty={filteredModifiers.length === 0}
            emptyText={modifiers.length === 0 ? 'No modifiers yet. Click "New" to create options (e.g. spice level).' : 'No modifiers match your search.'}
            rows={filteredModifiers}
            renderRow={(m) => (
              <ModifierRow
                mod={m}
                online={online}
                onEdit={() => { setModEditing(m); setModEditorOpen(true); }}
                onDelete={() => handleDeleteModifier(m)}
              />
            )}
            onRetry={() => refreshModifiers()}
          />
        )}
      </div>

      {/* Editors */}
      {catEditorOpen && (
        <CategoryEditor
          editing={catEditing}
          saving={catSaving}
          onClose={() => { setCatEditorOpen(false); setCatEditing(null); }}
          onSave={handleSaveCategory}
        />
      )}
      {itemEditorOpen && (
        <ItemEditor
          editing={itemEditing}
          categories={categories}
          modifiers={modifiers}
          saving={itemSaving}
          onClose={() => { setItemEditorOpen(false); setItemEditing(null); }}
          onSave={handleSaveItem}
        />
      )}
      {modEditorOpen && (
        <ModifierEditor
          editing={modEditing}
          saving={modSaving}
          onClose={() => { setModEditorOpen(false); setModEditing(null); }}
          onSave={handleSaveModifier}
        />
      )}
    </div>
  );
}

// =================== Generic List Skeleton / Error / Empty wrapper ===================
function ListView<T>({
  loading, error, empty, emptyText, rows, renderRow, onRetry,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  emptyText: string;
  rows: T[];
  renderRow: (row: T) => React.ReactNode;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-20 rounded-2xl bg-slate-800/30 animate-pulse-soft border border-white/5" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-5xl mb-4">⚠️</div>
          <p className="text-rose-300 font-bold mb-2">Couldn't load data</p>
          <p className="text-ink-300 text-sm mb-4 truncate">{error}</p>
          <button onClick={onRetry} className="btn-primary">Retry</button>
        </div>
      </div>
    );
  }
  if (empty) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-5xl mb-4 opacity-60">🗒️</div>
          <p className="text-ink-300 text-sm">{emptyText}</p>
        </div>
      </div>
    );
  }
  return <div className="space-y-3">{rows.map((r, i) => <div key={i}>{renderRow(r)}</div>)}</div>;
}

// =================== Category Row ===================
function CategoryRow({
  cat, online, onEdit, onDelete,
}: { cat: MenuCategory; online: boolean; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="group flex items-center gap-4 p-4 rounded-2xl bg-slate-800/20 border border-white/5 hover:border-amber-400/20 hover:bg-slate-800/35 transition-all">
      <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-600/10 flex items-center justify-center text-2xl shrink-0 ring-1 ring-inset ring-amber-400/20">
        🗂️
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-white font-black text-base truncate">{cat.name}</h3>
          {cat.isActive === false ? (
            <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-slate-600/30 text-ink-300 uppercase tracking-wider">Hidden</span>
          ) : null}
        </div>
        {cat.description && (
          <p className="text-ink-300 text-xs mt-1 line-clamp-2">{cat.description}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0 opacity-90 group-hover:opacity-100">
        <button
          onClick={onEdit}
          disabled={!online}
          className={`h-9 px-3 rounded-xl text-xs font-black flex items-center gap-1.5 ring-1 ring-inset transition-all ${
            online ? 'bg-slate-700/40 hover:bg-amber-500/15 ring-white/10 hover:ring-amber-400/30 text-white' : 'bg-slate-800/40 text-ink-500 ring-white/5 cursor-not-allowed'
          }`}
        >✏️ Edit</button>
        <button
          onClick={onDelete}
          disabled={!online}
          className={`h-9 px-3 rounded-xl text-xs font-black flex items-center gap-1.5 ring-1 ring-inset transition-all ${
            online ? 'bg-rose-500/10 hover:bg-rose-500/20 ring-rose-400/20 hover:ring-rose-400/40 text-rose-200' : 'bg-slate-800/40 text-ink-500 ring-white/5 cursor-not-allowed'
          }`}
        >🗑️ Delete</button>
      </div>
    </div>
  );
}

// =================== Item Row ===================
function ItemRow({
  item, categories, online, onEdit, onDelete,
}: {
  item: MenuItem; categories: MenuCategory[]; online: boolean; onEdit: () => void; onDelete: () => void;
}) {
  const cat = categories.find((c) => (c.id || (c as any)._id) === item.categoryId);
  const statusTint: Record<string, { label: string; cls: string }> = {
    AVAILABLE: { label: 'In Stock', cls: 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/25' },
    OUT_OF_STOCK: { label: 'Out of Stock', cls: 'bg-rose-500/15 text-rose-200 ring-rose-400/25' },
    DISABLED: { label: 'Hidden', cls: 'bg-slate-600/30 text-ink-300 ring-white/10' },
    SCHEDULED: { label: 'Scheduled', cls: 'bg-violet-500/15 text-violet-200 ring-violet-400/25' },
  };
  const s = statusTint[item.status ?? 'AVAILABLE'] ?? statusTint.AVAILABLE;
  return (
    <div className="group flex items-center gap-4 p-4 rounded-2xl bg-slate-800/20 border border-white/5 hover:border-amber-400/20 hover:bg-slate-800/35 transition-all">
      <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-[#CD7F32]/30 to-amber-600/10 flex items-center justify-center text-2xl shrink-0 ring-1 ring-inset ring-[#FFD700]/15 overflow-hidden">
        {item.imageUrl ? (
          <img src={item.imageUrl} alt="" className="w-full h-full object-cover" onError={(e) => { (e.currentTarget as any).style.display = 'none'; }} />
        ) : '🍽️'}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-white font-black text-base truncate">{item.name}</h3>
          <span className={`text-[10px] font-black px-2 py-0.5 rounded-md uppercase tracking-wider ring-1 ring-inset ${s.cls}`}>{s.label}</span>
        </div>
        <div className="flex items-center gap-2 mt-1.5 text-[11px]">
          <span className="text-amber-300/90 font-bold">{formatCentsToNgn(item.price)}</span>
          <span className="text-ink-400">·</span>
          <span className="text-ink-300">{cat?.name || 'Uncategorized'}</span>
          {(item.modifierIds as unknown as string | string[]) && Array.isArray(item.modifierIds) && item.modifierIds.length > 0 && (
            <>
              <span className="text-ink-400">·</span>
              <span className="text-ink-300">{item.modifierIds.length} modifier(s)</span>
            </>
          )}
        </div>
        {item.description && (
          <p className="text-ink-400 text-xs mt-1.5 line-clamp-1">{item.description}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0 opacity-90 group-hover:opacity-100">
        <button
          onClick={onEdit}
          disabled={!online}
          className={`h-9 px-3 rounded-xl text-xs font-black flex items-center gap-1.5 ring-1 ring-inset transition-all ${
            online ? 'bg-slate-700/40 hover:bg-amber-500/15 ring-white/10 hover:ring-amber-400/30 text-white' : 'bg-slate-800/40 text-ink-500 ring-white/5 cursor-not-allowed'
          }`}
        >✏️ Edit</button>
        <button
          onClick={onDelete}
          disabled={!online}
          className={`h-9 px-3 rounded-xl text-xs font-black flex items-center gap-1.5 ring-1 ring-inset transition-all ${
            online ? 'bg-rose-500/10 hover:bg-rose-500/20 ring-rose-400/20 hover:ring-rose-400/40 text-rose-200' : 'bg-slate-800/40 text-ink-500 ring-white/5 cursor-not-allowed'
          }`}
        >🗑️ Delete</button>
      </div>
    </div>
  );
}

// =================== Modifier Row ===================
function ModifierRow({
  mod, online, onEdit, onDelete,
}: { mod: MenuModifier; online: boolean; onEdit: () => void; onDelete: () => void }) {
  const opts = (mod.options as any) ?? [];
  return (
    <div className="group flex items-center gap-4 p-4 rounded-2xl bg-slate-800/20 border border-white/5 hover:border-amber-400/20 hover:bg-slate-800/35 transition-all">
      <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-violet-500/20 to-cyan-600/10 flex items-center justify-center text-2xl shrink-0 ring-1 ring-inset ring-violet-400/20">
        🎚️
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-white font-black text-base truncate">{mod.name}</h3>
          {mod.required && (
            <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-100 uppercase tracking-wider ring-1 ring-inset ring-amber-400/30">Required</span>
          )}
          {mod.multiSelect && (
            <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-cyan-500/15 text-cyan-200 uppercase tracking-wider ring-1 ring-inset ring-cyan-400/25">Multi</span>
          )}
          {!mod.required && !mod.multiSelect && (
            <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-slate-600/30 text-ink-300 uppercase tracking-wider">Optional · Single</span>
          )}
          {typeof mod.minSelections === 'number' && mod.minSelections > 0 && (
            <span className="text-[10px] text-ink-300">min {mod.minSelections}</span>
          )}
          {typeof mod.maxSelections === 'number' && (
            <span className="text-[10px] text-ink-300">max {mod.maxSelections}</span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {opts.slice(0, 6).map((o: any, i: number) => (
            <span key={i} className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-md bg-slate-700/40 text-ink-200 ring-1 ring-inset ring-white/5">
              {o.name}
              {o.priceDelta ? (
                <span className={Number(o.priceDelta) >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
                  {Number(o.priceDelta) >= 0 ? '+' : ''}{formatCentsToNgn(Number(o.priceDelta))}
                </span>
              ) : null}
              {o.isDefault && <span className="text-amber-300">★</span>}
            </span>
          ))}
          {opts.length > 6 && (
            <span className="text-[10px] text-ink-400 self-center">+{opts.length - 6} more</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0 opacity-90 group-hover:opacity-100">
        <button
          onClick={onEdit}
          disabled={!online}
          className={`h-9 px-3 rounded-xl text-xs font-black flex items-center gap-1.5 ring-1 ring-inset transition-all ${
            online ? 'bg-slate-700/40 hover:bg-amber-500/15 ring-white/10 hover:ring-amber-400/30 text-white' : 'bg-slate-800/40 text-ink-500 ring-white/5 cursor-not-allowed'
          }`}
        >✏️ Edit</button>
        <button
          onClick={onDelete}
          disabled={!online}
          className={`h-9 px-3 rounded-xl text-xs font-black flex items-center gap-1.5 ring-1 ring-inset transition-all ${
            online ? 'bg-rose-500/10 hover:bg-rose-500/20 ring-rose-400/20 hover:ring-rose-400/40 text-rose-200' : 'bg-slate-800/40 text-ink-500 ring-white/5 cursor-not-allowed'
          }`}
        >🗑️ Delete</button>
      </div>
    </div>
  );
}

// =================== Drawer shell (all editors share) ===================
function Drawer({
  title, subtitle, onClose, children, footer,
}: {
  title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="absolute inset-0 z-50 flex items-end sm:items-center justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" />
      <div
        className="relative w-full sm:w-[520px] max-w-full h-[90vh] sm:h-[92vh] sm:max-h-[880px] sm:mr-4 sm:rounded-3xl bg-slate-900/98 ring-1 ring-white/10 shadow-2xl flex flex-col overflow-hidden animate-slide-in-up"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shrink-0 px-6 py-5 border-b border-white/5 flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-black text-white leading-tight">{title}</h2>
            {subtitle && <p className="text-xs text-ink-300 mt-1.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="h-9 w-9 rounded-xl flex items-center justify-center text-ink-300 hover:text-white hover:bg-white/5 ring-1 ring-white/5 shrink-0">✕</button>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-5">
          {children}
        </div>
        {footer && (
          <footer className="shrink-0 px-6 py-4 border-t border-white/5 bg-slate-950/40 flex items-center justify-end gap-2">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

type FieldProps = { label: string; hint?: string; children: React.ReactNode; error?: string };
function Field({ label, hint, children, error }: FieldProps) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-[11px] font-black uppercase tracking-[0.16em] text-ink-200">{label}</span>
        {hint && <span className="text-[10px] text-ink-400">{hint}</span>}
      </div>
      {children}
      {error && <p className="mt-1.5 text-[11px] text-rose-300 font-bold">{error}</p>}
    </label>
  );
}

const inputCls = 'w-full h-11 px-3.5 rounded-xl bg-slate-800/50 border border-white/10 text-white placeholder-ink-400 focus:outline-none focus:border-amber-400/50 focus:ring-2 focus:ring-amber-400/20 text-sm';
const textareaCls = 'w-full px-3.5 py-3 rounded-xl bg-slate-800/50 border border-white/10 text-white placeholder-ink-400 focus:outline-none focus:border-amber-400/50 focus:ring-2 focus:ring-amber-400/20 text-sm min-h-[90px] resize-y';
const selectCls = inputCls;

// =================== Category Editor ===================
function CategoryEditor({
  editing, saving, onClose, onSave,
}: {
  editing: MenuCategory | null;
  saving: boolean;
  onClose: () => void;
  onSave: (input: AdminCategoryInput) => Promise<void>;
}) {
  const [name, setName] = useState(editing?.name ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [sortOrder, setSortOrder] = useState<number>(editing?.sortOrder ?? 0);
  const [isActive, setIsActive] = useState<boolean>(editing?.isActive ?? true);
  const [errors, setErrors] = useState<{ name?: string }>({});

  const submit = () => {
    const errs: typeof errors = {};
    if (!name.trim()) errs.name = 'Category name is required';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    onSave({ name: name.trim(), description: description.trim() || undefined, sortOrder: Number(sortOrder) || 0, isActive });
  };

  return (
    <Drawer
      title={editing ? 'Edit Category' : 'New Category'}
      subtitle={editing ? 'Update menu group details.' : 'Create a new menu group (e.g. "Soups", "Drinks").'}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn-secondary" disabled={saving}>Cancel</button>
          <button onClick={submit} className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : (editing ? 'Save Changes' : 'Create Category')}
          </button>
        </>
      }
    >
      <Field label="Name" error={errors.name}>
        <input className={inputCls} placeholder="e.g. Swallows" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Description" hint="Optional - shown on website">
        <textarea className={textareaCls} placeholder="Traditional Nigerian staples…" value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Sort Order" hint="Lower = first">
          <input type="number" className={inputCls} value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />
        </Field>
        <Field label="Visibility" hint="Uncheck = hide on menu">
          <label className="h-11 px-3.5 rounded-xl bg-slate-800/50 border border-white/10 flex items-center gap-2.5 cursor-pointer select-none">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-4 w-4 accent-amber-500" />
            <span className="text-sm text-white font-bold">{isActive ? 'Visible to customers' : 'Hidden'}</span>
          </label>
        </Field>
      </div>
    </Drawer>
  );
}

// =================== Item Editor ===================
function ItemEditor({
  editing, categories, modifiers, saving, onClose, onSave,
}: {
  editing: MenuItem | null;
  categories: MenuCategory[];
  modifiers: MenuModifier[];
  saving: boolean;
  onClose: () => void;
  onSave: (input: AdminMenuItemInput) => Promise<void>;
}) {
  const [categoryId, setCategoryId] = useState<string>(editing?.categoryId ?? categories[0]?.id ?? (categories[0] as any)?._id ?? '');
  const [name, setName] = useState(editing?.name ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [priceNgn, setPriceNgn] = useState<string>(editing ? String((editing.price ?? 0) / 100) : '');
  const [imageUrl, setImageUrl] = useState(editing?.imageUrl ?? '');
  const [status, setStatus] = useState<AdminMenuItemInput['status']>(editing?.status ?? 'AVAILABLE');
  const [sortOrder, setSortOrder] = useState<number>(editing?.sortOrder ?? 0);
  const [selectedMods, setSelectedMods] = useState<Set<string>>(
    new Set((editing?.modifierIds as unknown as string[]) ?? [])
  );
  const [errors, setErrors] = useState<{ name?: string; categoryId?: string; price?: string }>({});

  const submit = () => {
    const errs: typeof errors = {};
    if (!name.trim()) errs.name = 'Item name is required';
    if (!categoryId) errs.categoryId = 'Category is required';
    const priceNum = Number(priceNgn);
    if (!Number.isFinite(priceNum) || priceNum < 0) errs.price = 'Enter a valid price';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    const priceCents = Math.round(priceNum * 100);
    const input: AdminMenuItemInput = {
      categoryId,
      name: name.trim(),
      description: description.trim() || undefined,
      price: priceCents,
      imageUrl: imageUrl.trim() || undefined,
      status,
      sortOrder: Number(sortOrder) || 0,
      modifierIds: Array.from(selectedMods),
    };
    onSave(input);
  };

  return (
    <Drawer
      title={editing ? 'Edit Menu Item' : 'New Menu Item'}
      subtitle={editing ? 'Update dish / drink details.' : 'Add a new dish or drink to the menu.'}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn-secondary" disabled={saving}>Cancel</button>
          <button onClick={submit} className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : (editing ? 'Save Changes' : 'Create Item')}
          </button>
        </>
      }
    >
      <Field label="Category" error={errors.categoryId}>
        <select className={selectCls} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">— Select category —</option>
          {categories.map((c) => {
            const id = c.id || (c as any)._id;
            return <option key={id} value={id}>{c.name}</option>;
          })}
        </select>
      </Field>
      <Field label="Name" error={errors.name}>
        <input className={inputCls} placeholder="e.g. Pounded Yam & Egusi Soup" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Description" hint="Short summary shown on POS & website">
        <textarea className={textareaCls} placeholder="Served with assorted meat & stockfish…" value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Price (₦)" hint="In Naira (whole number)" error={errors.price}>
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400 font-black">₦</span>
            <input type="number" min="0" step="1" className={inputCls + ' pl-8'} placeholder="3500" value={priceNgn} onChange={(e) => setPriceNgn(e.target.value)} />
          </div>
        </Field>
        <Field label="Status">
          <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value as any)}>
            <option value="AVAILABLE">🟢 Available</option>
            <option value="OUT_OF_STOCK">🔴 Out of Stock</option>
            <option value="SCHEDULED">🕐 Scheduled</option>
            <option value="DISABLED">⚪ Hidden</option>
          </select>
        </Field>
      </div>
      <Field label="Image URL" hint="Optional — CDN / HTTPS image link">
        <input className={inputCls} placeholder="https://…/dish.jpg" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
      </Field>
      <Field label="Sort Order" hint="Lower = first within category">
        <input type="number" className={inputCls} value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />
      </Field>
      <Field label="Modifiers" hint={`Attach add-ons (${selectedMods.size} selected)`}>
        <div className="rounded-xl bg-slate-800/30 border border-white/10 p-2 max-h-56 overflow-y-auto space-y-1">
          {modifiers.length === 0 ? (
            <p className="p-3 text-center text-xs text-ink-400">No modifiers yet. Create them first in the Modifiers sub-tab.</p>
          ) : modifiers.map((m) => {
            const id = m.id || (m as any)._id;
            const on = selectedMods.has(id);
            return (
              <label key={id} className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-all ${on ? 'bg-amber-500/10 ring-1 ring-amber-400/30' : 'hover:bg-white/5'}`}>
                <input type="checkbox" checked={on} onChange={() => {
                  const n = new Set(selectedMods);
                  if (n.has(id)) n.delete(id); else n.add(id);
                  setSelectedMods(n);
                }} className="h-4 w-4 accent-amber-500" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-white truncate">{m.name}</div>
                  <div className="text-[10px] text-ink-400">
                    {(m.options as any)?.length ?? 0} options · {m.required ? 'Required' : 'Optional'} · {m.multiSelect ? 'Multi' : 'Single'}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </Field>
    </Drawer>
  );
}

// =================== Modifier Editor ===================
function ModifierEditor({
  editing, saving, onClose, onSave,
}: {
  editing: MenuModifier | null;
  saving: boolean;
  onClose: () => void;
  onSave: (input: AdminModifierInput) => Promise<void>;
}) {
  const existingOpts: any[] = (editing?.options as any) ?? [];
  const [name, setName] = useState(editing?.name ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [required, setRequired] = useState<boolean>(editing?.required ?? false);
  const [multiSelect, setMultiSelect] = useState<boolean>(editing?.multiSelect ?? false);
  const [minSelections, setMinSelections] = useState<number>(editing?.minSelections ?? 0);
  const [maxSelections, setMaxSelections] = useState<number>(editing?.maxSelections ?? 1);
  const [options, setOptions] = useState<AdminModifierOptionInput[]>(
    existingOpts.length > 0
      ? existingOpts.map((o) => ({
          id: o.id ?? o._id,
          name: o.name ?? '',
          priceDelta: Number(o.priceDelta ?? 0),
          isDefault: !!o.isDefault,
        }))
      : [{ name: '', priceDelta: 0, isDefault: false }]
  );
  const [errors, setErrors] = useState<{ name?: string; options?: string }>({});

  const setOpt = (idx: number, patch: Partial<AdminModifierOptionInput>) => {
    setOptions((cur) => cur.map((o, i) => (i === idx ? { ...o, ...patch } : o)));
  };
  const addOpt = () => setOptions((cur) => [...cur, { name: '', priceDelta: 0, isDefault: false }]);
  const removeOpt = (idx: number) => setOptions((cur) => cur.filter((_, i) => i !== idx));

  const submit = () => {
    const errs: typeof errors = {};
    if (!name.trim()) errs.name = 'Modifier name is required';
    const cleanOpts = options.map((o) => ({ ...o, name: o.name.trim() }));
    if (cleanOpts.length === 0) errs.options = 'At least one option is required';
    if (cleanOpts.some((o) => !o.name)) errs.options = 'All options must have a name';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    const input: AdminModifierInput = {
      name: name.trim(),
      description: description.trim() || undefined,
      required,
      multiSelect,
      minSelections: Number(minSelections) || 0,
      maxSelections: Math.max(1, Number(maxSelections) || 1),
      options: cleanOpts,
    };
    onSave(input);
  };

  return (
    <Drawer
      title={editing ? 'Edit Modifier' : 'New Modifier'}
      subtitle={editing ? 'Update modifier options & rules.' : 'Create a modifier (e.g. Spice Level, Protein Add-ons).'}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn-secondary" disabled={saving}>Cancel</button>
          <button onClick={submit} className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : (editing ? 'Save Changes' : 'Create Modifier')}
          </button>
        </>
      }
    >
      <Field label="Name" error={errors.name}>
        <input className={inputCls} placeholder="e.g. Spice Level" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Description" hint="Optional">
        <input className={inputCls} placeholder="How spicy would you like it?" value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Required" hint="Customer must pick at least one">
          <label className="h-11 px-3.5 rounded-xl bg-slate-800/50 border border-white/10 flex items-center gap-2.5 cursor-pointer select-none">
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="h-4 w-4 accent-amber-500" />
            <span className="text-sm text-white font-bold">{required ? 'Required selection' : 'Optional'}</span>
          </label>
        </Field>
        <Field label="Multi-select" hint="Allow picking multiple options">
          <label className="h-11 px-3.5 rounded-xl bg-slate-800/50 border border-white/10 flex items-center gap-2.5 cursor-pointer select-none">
            <input type="checkbox" checked={multiSelect} onChange={(e) => setMultiSelect(e.target.checked)} className="h-4 w-4 accent-amber-500" />
            <span className="text-sm text-white font-bold">{multiSelect ? 'Multiple allowed' : 'Single choice only'}</span>
          </label>
        </Field>
        <Field label="Min Selections" hint="e.g. 1 for required">
          <input type="number" min="0" className={inputCls} value={minSelections} onChange={(e) => setMinSelections(Number(e.target.value))} />
        </Field>
        <Field label="Max Selections" hint="e.g. 3 for multi">
          <input type="number" min="1" className={inputCls} value={maxSelections} onChange={(e) => setMaxSelections(Number(e.target.value))} />
        </Field>
      </div>
      <Field label="Options" hint="Price delta in Naira — positive = extra cost, negative = discount" error={errors.options}>
        <div className="space-y-2">
          {options.map((o, i) => (
            <div key={i} className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-800/30 border border-white/10">
              <label className="flex items-center justify-center w-9 h-9 shrink-0 cursor-pointer" title="Default option">
                <input type="radio" name="mgr-default-opt" checked={!!o.isDefault} onChange={() => {
                  setOptions((cur) => cur.map((x, j) => ({ ...x, isDefault: i === j ? !x.isDefault : false })));
                }} className="h-4 w-4 accent-amber-500" />
              </label>
              <input
                className={inputCls + ' flex-1'}
                placeholder="e.g. Extra Spicy"
                value={o.name}
                onChange={(e) => setOpt(i, { name: e.target.value })}
              />
              <div className="relative w-32 shrink-0">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 font-black text-xs">₦</span>
                <input
                  type="number"
                  className={inputCls + ' pl-7'}
                  placeholder="Price delta"
                  value={Number(o.priceDelta) / 100}
                  onChange={(e) => setOpt(i, { priceDelta: Math.round(Number(e.target.value) * 100) })}
                />
              </div>
              <button
                onClick={() => removeOpt(i)}
                disabled={options.length <= 1}
                className="h-9 w-9 shrink-0 rounded-lg flex items-center justify-center text-rose-300 hover:bg-rose-500/15 disabled:text-ink-500 disabled:hover:bg-transparent"
                title="Remove option"
              >✕</button>
            </div>
          ))}
          <button onClick={addOpt} className="w-full h-10 rounded-xl text-sm font-black text-amber-200 bg-amber-500/10 hover:bg-amber-500/15 ring-1 ring-inset ring-amber-400/25 flex items-center justify-center gap-2">
            <span>＋</span> Add another option
          </button>
        </div>
      </Field>
    </Drawer>
  );
}
