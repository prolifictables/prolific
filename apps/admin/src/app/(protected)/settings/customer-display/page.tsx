'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { apiGet, apiPatch } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// Defaults (matches POS hardcoded PROMOS / SPECIALS arrays in CustomerIdleScreen.
// These are used when the branch has never saved customer-display settings yet.
// ---------------------------------------------------------------------------

const GRADIENT_PRESETS: { label: string; value: string; swatch: string }[] = [
  { label: 'Sunset (Amber → Rose)', value: 'from-amber-500 via-orange-500 to-rose-500', swatch: 'from-amber-500 via-orange-500 to-rose-500' },
  { label: 'Spicy (Orange → Red → Amber)', value: 'from-orange-600 via-red-600 to-amber-700', swatch: 'from-orange-600 via-red-600 to-amber-700' },
  { label: 'Mint (Emerald → Teal → Cyan)', value: 'from-emerald-500 via-teal-500 to-cyan-600', swatch: 'from-emerald-500 via-teal-500 to-cyan-600' },
  { label: 'Ocean (Sky → Blue → Indigo)', value: 'from-sky-500 via-blue-500 to-indigo-600', swatch: 'from-sky-500 via-blue-500 to-indigo-600' },
  { label: 'Berry (Fuchsia → Pink → Rose)', value: 'from-fuchsia-500 via-pink-500 to-rose-500', swatch: 'from-fuchsia-500 via-pink-500 to-rose-500' },
  { label: 'Royal (Violet → Purple → Plum)', value: 'from-violet-500 via-purple-500 to-fuchsia-600', swatch: 'from-violet-500 via-purple-500 to-fuchsia-600' },
  { label: 'Forest (Lime → Green → Emerald)', value: 'from-lime-500 via-green-500 to-emerald-600', swatch: 'from-lime-500 via-green-500 to-emerald-600' },
  { label: 'Midnight (Slate → Navy → Black)', value: 'from-slate-700 via-navy-800 to-navy-900', swatch: 'from-slate-700 via-navy-800 to-navy-900' },
];

const DEFAULT_PROMOS: Array<{ emoji: string; title: string; subtitle: string; bg: string }> = [
  { emoji: '🍹', title: 'Happy Hour 30% OFF', subtitle: 'Every day after 6pm — unwind with us', bg: 'from-amber-500 via-orange-500 to-rose-500' },
  { emoji: '🍛', title: "Chef's Special", subtitle: 'Jollof + Zobo Combo — ₦5,900', bg: 'from-orange-600 via-red-600 to-amber-700' },
  { emoji: '🍰', title: 'Free Dessert', subtitle: 'With every ₦20,000+ order today', bg: 'from-emerald-500 via-teal-500 to-cyan-600' },
];

const DEFAULT_SPECIALS: Array<{ emoji: string; name: string; price: number }> = [
  { emoji: '🥩', name: 'Suya Platter (Medium)', price: 8500 },
  { emoji: '🍲', name: 'Fisherman Soup + Eba', price: 6200 },
  { emoji: '🔥', name: 'Asun Rice Combo', price: 4800 },
];

const DEFAULT_BRANDING = {
  tagline: 'Bold Flavours, Warm Welcome',
  wifi: 'Free Wi-Fi: ProlificTables_Guest',
  openingHours: 'Mon–Sun 8am – 11pm',
  branchName: '',
};

// ============================================================================
// Form state shape
// ============================================================================

interface PromoForm {
  promos: typeof DEFAULT_PROMOS;
  specials: typeof DEFAULT_SPECIALS;
  tagline: string;
  wifi: string;
  openingHours: string;
  branchName: string;
}

const DEFAULT_FORM: PromoForm = {
  promos: DEFAULT_PROMOS.map((p) => ({ ...p })),
  specials: DEFAULT_SPECIALS.map((s) => ({ ...s })),
  ...DEFAULT_BRANDING,
};

const EMOJI_SUGGESTIONS: Record<string, string[]> = {
  promos: ['🍹', '🍛', '🍰', '🍔', '🍕', '🥗', '🍜', '🍣', '🍩', '🍦', '🥂', '🎁', '⭐', '🔥', '💯', '🎉'],
  specials: ['🥩', '🍲', '🔥', '🍗', '🐟', '🥘', '🍝', '🍚', '🥙', '🌮', '🍤', '🍱', '🥞', '🧆', '🍢', '🥟'],
};

function formatNaira(whole: number): string {
  return `₦${new Intl.NumberFormat('en-NG', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(whole || 0))}`;
}

export default function CustomerDisplaySettingsPage() {
  const { branch } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeSection, setActiveSection] = useState<'promos' | 'specials' | 'branding'>('promos');
  const [form, setForm] = useState<PromoForm>(DEFAULT_FORM);
  const [previewPromoIdx, setPreviewPromoIdx] = useState(0);

  // Auto-cycle preview carousel
  useEffect(() => {
    const id = setInterval(() => setPreviewPromoIdx((i) => (i + 1) % form.promos.length), 3500);
    return () => clearInterval(id);
  }, [form.promos.length]);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      if (!branch?.id) throw new Error('Select a branch to manage settings');
      const raw: any = await apiGet(`/settings?branchId=${encodeURIComponent(branch.id)}`);
      const saved = raw?.data?.customerDisplay || raw?.customerDisplay || {};
      setForm({
        promos: Array.isArray(saved.promos) && saved.promos.length ? saved.promos : DEFAULT_FORM.promos.map((p) => ({ ...p })),
        specials: Array.isArray(saved.specials) && saved.specials.length ? saved.specials : DEFAULT_FORM.specials.map((s) => ({ ...s })),
        tagline: typeof saved.tagline === 'string' && saved.tagline.trim() ? saved.tagline : DEFAULT_BRANDING.tagline,
        wifi: typeof saved.wifi === 'string' && saved.wifi.trim() ? saved.wifi : DEFAULT_BRANDING.wifi,
        openingHours: typeof saved.openingHours === 'string' && saved.openingHours.trim() ? saved.openingHours : DEFAULT_BRANDING.openingHours,
        branchName: typeof saved.branchName === 'string' ? saved.branchName : DEFAULT_BRANDING.branchName,
      });
    } catch (err: any) {
      toast('Failed to load customer display settings', { description: err.message, variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSettings(); }, [branch?.id]);

  const save = async () => {
    setSaving(true);
    try {
      if (!branch?.id) throw new Error('Select a branch to save settings');
      const customerDisplay = {
        promos: form.promos,
        specials: form.specials,
        tagline: form.tagline,
        wifi: form.wifi,
        openingHours: form.openingHours,
        branchName: form.branchName || undefined,
      };
      // SettingsService.patchBranchSettings performs SHALLOW MERGE so this
      // replaces only the customerDisplay key, preserving other settings untouched.
      await apiPatch(`/settings?branchId=${encodeURIComponent(branch.id)}`, { customerDisplay });
      toast('Customer display saved successfully', { variant: 'success' });
    } catch (err: any) {
      toast(err.message || 'Failed to save', { variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const sections = useMemo(() => ([
    { id: 'promos' as const, label: 'Promo Carousel', icon: '🎞️', hint: `${form.promos.length} slides` },
    { id: 'specials' as const, label: "Today's Specials", icon: '⭐', hint: `${form.specials.length} items` },
    { id: 'branding' as const, label: 'Branding & Text', icon: '🏷️', hint: 'Tagline, Wi-Fi, hours' },
  ]), [form.promos.length, form.specials.length]);

  const SectionHeader = ({ title, description, badge }: { title: string; description?: string; badge?: string }) => (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div>
        <h3 className="text-base font-bold text-slate-900">{title}</h3>
        {description && <p className="text-sm text-slate-500 mt-0.5">{description}</p>}
      </div>
      {badge && <Badge variant="soft">{badge}</Badge>}
    </div>
  );

  const updatePromo = (idx: number, patch: Partial<PromoForm['promos'][number]>) => {
    const next = form.promos.slice();
    next[idx] = { ...next[idx], ...patch };
    setForm({ ...form, promos: next });
  };

  const updateSpecial = (idx: number, patch: Partial<PromoForm['specials'][number]>) => {
    const next = form.specials.slice();
    next[idx] = { ...next[idx], ...patch };
    setForm({ ...form, specials: next });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Badge variant="brand">Customer Display</Badge>
            <span>·</span>
            <span>{branch?.name || 'Global'}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mt-1.5">Customer Display Write-Up</h1>
          <p className="text-sm text-slate-500 mt-1">Edit promo slides, today's specials, and branding text visible on the POS-facing customer screen</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={fetchSettings} disabled={loading}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 mr-1"><path d="M23 4v6h-6M1 20v-6h6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Reload
          </Button>
          <Button loading={saving || loading} onClick={save}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 mr-1"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Save Changes
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr_1fr] gap-4">
        {/* ------------------------------
            Left nav
        ------------------------------ */}
        <aside className="lg:sticky lg:top-4 h-fit order-1">
          <Card className="!p-2 space-y-1">
            {sections.map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                className={cn(
                  'w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center justify-between gap-2.5',
                  activeSection === s.id
                    ? 'bg-brand-50 text-brand-700 shadow-sm'
                    : 'text-slate-600 hover:bg-slate-50'
                )}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <span className="text-base w-5 text-center">{s.icon}</span>
                  <span className="truncate">{s.label}</span>
                </span>
                <span className="text-[11px] text-slate-400 font-medium shrink-0">{s.hint}</span>
              </button>
            ))}
          </Card>
        </aside>

        {/* ------------------------------
            Middle form editor
        ------------------------------ */}
        <div className="space-y-4 min-w-0 order-2 lg:order-2">
          {/* ============================================================
              PROMOS SECTION
          ============================================================ */}
          {activeSection === 'promos' && (
            <div className="space-y-4">
              <Card>
                <CardHeader padded>
                <CardTitle>
                  <SectionHeader
                    title="Promo Carousel Slides"
                    description="Large rotating banners shown on the left 70% of the idle screen. Each slide auto-rotates every 6 seconds."
                    badge={`${form.promos.length} slides`}
                  />
                </CardTitle>
              </CardHeader>
              <div className="px-5 pb-5 space-y-5">
                {form.promos.map((p, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      'rounded-2xl border border-slate-200 bg-white p-4 space-y-3',
                      'hover:border-slate-300 transition-all'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="soft">Slide {idx + 1}</Badge>
                      </div>
                      <div className={cn('h-8 w-20 rounded-lg bg-gradient-to-br shadow-inner ring-1 ring-black/5', p.bg)} />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1.5">Emoji</label>
                        <div className="flex flex-wrap gap-1">
                          {EMOJI_SUGGESTIONS.promos.map((e) => (
                            <button
                              key={e}
                              type="button"
                              onClick={() => updatePromo(idx, { emoji: e })}
                              className={cn(
                                'h-8 w-8 rounded-lg text-lg flex items-center justify-center transition-all border',
                                p.emoji === e
                                  ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-400/40 scale-105'
                                  : 'border-slate-200 hover:bg-slate-50'
                              )}
                            >
                              {e}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-3">
                        <Input
                          label="Headline"
                          value={p.title}
                          maxLength={40}
                          onChange={(e) => updatePromo(idx, { title: e.target.value })}
                          placeholder="Happy Hour 30% OFF"
                        />
                        <Textarea
                          label="Subtitle / description"
                          value={p.subtitle}
                          maxLength={80}
                          rows={2}
                          onChange={(e) => updatePromo(idx, { subtitle: e.target.value })}
                          placeholder="Every day after 6pm — unwind with us"
                        />
                        <Select
                          label="Gradient theme"
                          value={p.bg}
                          onChange={(e) => updatePromo(idx, { bg: e.target.value })}
                          options={GRADIENT_PRESETS.map((g) => ({ value: g.value, label: g.label }))}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
            </div>
          )}

          {/* ============================================================
              SPECIALS SECTION
          ============================================================ */}
          {activeSection === 'specials' && (
            <div className="space-y-4">
              <Card>
                <CardHeader padded>
                <CardTitle>
                  <SectionHeader
                    title="Today's Specials"
                    description="Three curated specials shown on the top-right card of the idle screen. Price is in whole NAIRA."
                    badge={`${form.specials.length} items`}
                  />
                </CardTitle>
              </CardHeader>
              <div className="px-5 pb-5 space-y-4">
                {form.specials.map((s, idx) => (
                  <div
                    key={idx}
                    className="rounded-2xl border border-slate-200 bg-white p-4 hover:border-slate-300 transition-all"
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <Badge variant="soft">Special {idx + 1}</Badge>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Emoji</label>
                          <div className="flex flex-wrap gap-1">
                            {EMOJI_SUGGESTIONS.specials.map((e) => (
                              <button
                                key={e}
                                type="button"
                                onClick={() => updateSpecial(idx, { emoji: e })}
                                className={cn(
                                  'h-8 w-8 rounded-lg text-lg flex items-center justify-center transition-all border',
                                  s.emoji === e
                                    ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-400/40 scale-105'
                                    : 'border-slate-200 hover:bg-slate-50'
                                )}
                              >
                                {e}
                              </button>
                            ))}
                          </div>
                        </div>
                        <Input
                          label="Dish name"
                          value={s.name}
                          maxLength={60}
                          onChange={(e) => updateSpecial(idx, { name: e.target.value })}
                          placeholder="Suya Platter (Medium)"
                        />
                      </div>
                      <div className="w-full sm:w-40">
                        <Input
                          label="Price (₦)"
                          type="number"
                          min={0}
                          step={50}
                          value={String(s.price)}
                          onChange={(e) => {
                            const n = parseInt(e.target.value || '0', 10);
                            updateSpecial(idx, { price: Number.isFinite(n) && n >= 0 ? n : 0 });
                          }}
                          placeholder="8500"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
            </div>
          )}

          {/* ============================================================
              BRANDING SECTION
          ============================================================ */}
          {activeSection === 'branding' && (
            <div className="space-y-4">
              <Card>
                <CardHeader padded>
                  <CardTitle>
                    <SectionHeader
                      title="Branding Text Overrides"
                      description="Optional text lines on the idle screen header, footer, and branch card."
                      badge="4 fields"
                    />
                  </CardTitle>
                </CardHeader>
                <div className="px-5 pb-5 space-y-4">
                  <Input
                    label="Branch display name (branch card heading)"
                    value={form.branchName}
                    onChange={(e) => setForm({ ...form, branchName: e.target.value })}
                    placeholder={branch?.name || 'Port Harcourt'}
                    description={
                      branch?.name
                        ? `Leave blank to use the branch name automatically: ${branch.name}`
                        : 'Leave blank to use the branch name automatically.'
                    }
                  />
                  <Input
                    label="Header tagline (under venue name)"
                    value={form.tagline}
                    maxLength={80}
                    onChange={(e) => setForm({ ...form, tagline: e.target.value })}
                    placeholder="Bold Flavours, Warm Welcome"
                  />
                  <Input
                    label="Opening hours text (branch card subheading)"
                    value={form.openingHours}
                    maxLength={60}
                    onChange={(e) => setForm({ ...form, openingHours: e.target.value })}
                    placeholder="Mon–Sun 8am – 11pm"
                  />
                  <Input
                    label="Wi-Fi SSID text (footer pill)"
                    value={form.wifi}
                    maxLength={60}
                    onChange={(e) => setForm({ ...form, wifi: e.target.value })}
                    placeholder="Free Wi-Fi: ProlificTables_Guest"
                  />
                </div>
              </Card>
            </div>
          )}
        </div>

        {/* ------------------------------
            Right: live mini preview
        ------------------------------ */}
        <div className="min-w-0 order-3 lg:sticky lg:top-4 h-fit">
          <Card>
            <CardHeader padded>
              <CardTitle>
                <SectionHeader
                  title="Live Preview"
                  description="Approximate idle screen (exact 1280×800 on the display device)."
                  badge="Idle"
                />
              </CardTitle>
            </CardHeader>
            <div className="px-4 pb-4">
              <div
                className="relative w-full aspect-[16/10] rounded-2xl overflow-hidden ring-1 ring-black/10 bg-amber-50 text-navy-900 shadow-inner"
                style={{ minHeight: 260 }}
              >
                <div className="absolute inset-0 bg-gradient-to-br from-amber-400/30 via-amber-200/50 to-white" />
                <div className="absolute inset-0 bg-gradient-to-tl from-navy-900/60 via-navy-800/25 to-transparent" />

                <div className="relative z-10 flex flex-col h-full p-3">
                  {/* Header */}
                  <header className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="h-7 w-7 rounded-xl bg-navy-900 flex items-center justify-center shadow">
                        <span className="text-[13px] font-black text-amber-400">P</span>
                      </div>
                      <div className="min-w-0">
                        <h1 className="text-[15px] font-black text-navy-900 leading-tight truncate">
                          {branch?.name || 'Prolific Tables'}
                        </h1>
                        <p className="text-[10px] text-navy-700/80 font-medium truncate">{form.tagline || DEFAULT_BRANDING.tagline}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[18px] font-mono font-bold text-navy-900 tabular-nums leading-none">17:53</div>
                      <div className="text-[9px] text-navy-700/80 font-medium">Fri, Aug 28</div>
                    </div>
                  </header>

                  {/* Body */}
                  <div className="flex-1 flex gap-2 min-h-0">
                    {/* Left promo */}
                    <div className="w-[70%] rounded-xl overflow-hidden relative shadow-md ring-1 ring-white/40">
                      {form.promos.map((promo, i) => (
                        <div
                          key={i}
                          className={cn(
                            'absolute inset-0 transition-all duration-700 ease-in-out flex flex-col items-center justify-center px-3 text-center bg-gradient-to-br',
                            promo.bg
                          )}
                          style={{
                            transform: `translateX(${(i - previewPromoIdx) * 100}%)`,
                            opacity: i === previewPromoIdx ? 1 : 0,
                          }}
                        >
                          <div className="absolute inset-0 bg-black/10" />
                          <div className="relative z-10">
                            <div className="text-[42px] mb-2 drop-shadow">{promo.emoji}</div>
                            <h2 className="text-[28px] leading-[1.05] font-black text-white mb-1 tracking-tight drop-shadow">
                              {promo.title || '—'}
                            </h2>
                            <p className="text-[11px] text-white/90 font-semibold max-w-[90%] mx-auto drop-shadow">
                              {promo.subtitle}
                            </p>
                          </div>
                        </div>
                      ))}
                      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1 z-20">
                        {form.promos.map((_, i) => (
                          <div
                            key={i}
                            className={cn(
                              'h-1 rounded-full transition-all duration-300',
                              i === previewPromoIdx ? 'w-4 bg-white shadow' : 'w-1 bg-white/50'
                            )}
                          />
                        ))}
                      </div>
                    </div>

                    {/* Right column */}
                    <aside className="w-[30%] flex flex-col gap-2 min-h-0">
                      {/* Specials card */}
                      <div className="rounded-xl bg-white/95 backdrop-blur p-2 shadow-md ring-1 ring-white/60">
                        <div className="flex items-center gap-1.5 mb-2">
                          <span className="text-sm">⭐</span>
                          <div>
                            <h3 className="text-[10px] font-black text-navy-900 leading-none">Today's Specials</h3>
                            <p className="text-[8px] text-navy-600/70 font-medium leading-tight mt-0.5">Chef's curated picks</p>
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          {form.specials.map((s, i) => (
                            <div
                              key={i}
                              className="flex items-center justify-between p-1.5 rounded-lg bg-amber-50/80"
                            >
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="text-[13px] shrink-0">{s.emoji}</span>
                                <span className="font-semibold text-navy-900 text-[9px] leading-tight truncate">{s.name}</span>
                              </div>
                              <span className="font-bold text-accent-600 tabular-nums text-[9px] shrink-0 ml-1">
                                {formatNaira(s.price)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Branch card */}
                      <div className="rounded-xl bg-navy-900/95 backdrop-blur p-2 shadow-md text-white flex-1 flex flex-col min-h-0">
                        <div className="flex items-center gap-1.5 mb-2">
                          <div className="h-5 w-5 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0">
                            <span className="text-[11px]">📍</span>
                          </div>
                          <div className="min-w-0">
                            <h3 className="text-[10px] font-black leading-none truncate">
                              {form.branchName || branch?.name || 'Port Harcourt'}
                            </h3>
                            <p className="text-[8px] text-navy-200/70 font-medium leading-tight mt-0.5 truncate">
                              {form.openingHours || DEFAULT_BRANDING.openingHours}
                            </p>
                          </div>
                        </div>
                        <div className="mt-auto flex items-end justify-between gap-1">
                          <div>
                            <p className="text-[7px] uppercase tracking-widest text-navy-300/60 mb-1 font-bold leading-none">Scan</p>
                            <div className="h-10 w-10 rounded-lg bg-white flex items-center justify-center shadow-inner p-1">
                              <div className="grid grid-cols-4 gap-[1px]">
                                {Array.from({ length: 16 }).map((_, i) => (
                                  <div
                                    key={i}
                                    className={cn('w-[5px] h-[5px] rounded-[1px]', i % 3 ? 'bg-navy-900' : 'bg-transparent')}
                                  />
                                ))}
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-[7px] uppercase tracking-widest text-navy-300/60 mb-1 font-bold leading-none">Ready?</p>
                            <div className="text-[14px] font-black text-amber-400 tabular-nums leading-none">#---</div>
                          </div>
                        </div>
                      </div>
                    </aside>
                  </div>

                  {/* Footer */}
                  <footer className="flex items-center justify-between mt-2 pt-2 border-t border-navy-900/10 bg-white/40 backdrop-blur px-2 py-1.5 rounded-lg">
                    <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/30">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="font-bold text-emerald-700 text-[9px] leading-none truncate max-w-[140px]">
                        {form.wifi || DEFAULT_BRANDING.wifi}
                      </span>
                    </div>
                    <div className="text-navy-700/70 font-semibold text-[8px] leading-none">Prolific POS</div>
                  </footer>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
