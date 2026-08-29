'use client';

import { useEffect, useState } from 'react';
import type { CustomerBranding, CustomerPromo, CustomerSpecial } from '../../vite-env';

// Baked-in defaults used when the admin has not saved any customer-display
// settings yet (or the branch fetch returned empty). Each admin edit saves
// overrides into Setting.key="branch.settings" → customerDisplay nested object
// which the mock-electron-shim fetches and passes in below as props.
const DEFAULT_PROMOS: CustomerPromo[] = [
  {
    emoji: '🍹',
    title: 'Happy Hour 30% OFF',
    subtitle: 'Every day after 6pm — unwind with us',
    bg: 'from-amber-500 via-orange-500 to-rose-500',
  },
  {
    emoji: '🍛',
    title: "Chef's Special",
    subtitle: 'Jollof + Zobo Combo — ₦5,900',
    bg: 'from-orange-600 via-red-600 to-amber-700',
  },
  {
    emoji: '🍰',
    title: 'Free Dessert',
    subtitle: 'With every ₦20,000+ order today',
    bg: 'from-emerald-500 via-teal-500 to-cyan-600',
  },
];

const DEFAULT_SPECIALS: CustomerSpecial[] = [
  { name: 'Suya Platter (Medium)', price: 8500, emoji: '🥩' },
  { name: 'Fisherman Soup + Eba', price: 6200, emoji: '🍲' },
  { name: 'Asun Rice Combo', price: 4800, emoji: '🔥' },
];

function formatPrice(cents: number): string {
  const amount = Math.round(cents) / 100;
  return `₦${new Intl.NumberFormat('en-NG', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)}`;
}

interface Props {
  branding: CustomerBranding;
  promos?: CustomerPromo[] | null | undefined;
  specials?: CustomerSpecial[] | null | undefined;
}

export default function CustomerIdleScreen({ branding, promos, specials }: Props) {
  // Fallback to defaults if props are missing/empty so the screen is never blank.
  const PROMOS = Array.isArray(promos) && promos.length ? promos : DEFAULT_PROMOS;
  const SPECIALS = Array.isArray(specials) && specials.length ? specials : DEFAULT_SPECIALS;

  const [index, setIndex] = useState(0);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    // Reset carousel index if promos array length changes to avoid OOB.
    setIndex(0);
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % PROMOS.length);
    }, 6000);
    return () => clearInterval(id);
  }, [PROMOS.length]);

  return (
    <div className="absolute inset-0 w-full h-full overflow-hidden bg-amber-50 text-navy-900">
      <div className="absolute inset-0 bg-gradient-to-br from-amber-400/40 via-amber-200/60 to-white" />
      <div className="absolute inset-0 bg-gradient-to-tl from-navy-900/70 via-navy-800/30 to-transparent" />

      <div className="relative z-10 flex flex-col h-full">
        <header className="flex items-center justify-between px-12 py-8">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded-3xl bg-navy-900 flex items-center justify-center shadow-lg">
              <span className="text-3xl font-black text-amber-400">
                {branding.name?.charAt(0) || 'P'}
              </span>
            </div>
            <div>
              <h1 className="text-4xl font-black text-navy-900 tracking-tight drop-shadow-sm">
                {branding.name || 'Prolific Tables'}
              </h1>
              <p className="text-lg text-navy-700/80 font-medium mt-0.5">
                {branding.tagline || 'Bold Flavours, Warm Welcome'}
              </p>
            </div>
          </div>

          <div className="text-right">
            <div className="text-5xl font-mono font-bold text-navy-900 tabular-nums drop-shadow-sm">
              {now.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              })}
            </div>
            <div className="text-lg text-navy-700/80 font-medium mt-1">
              {now.toLocaleDateString([], {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
            </div>
          </div>
        </header>

        <main className="flex-1 flex px-12 pb-6 gap-8 min-h-0">
          <div className="w-[70%] rounded-[2rem] overflow-hidden relative shadow-2xl ring-1 ring-white/40">
            {PROMOS.map((promo, i) => (
              <div
                key={i}
                className={`absolute inset-0 transition-all duration-[1200ms] ease-in-out flex flex-col items-center justify-center px-16 text-center bg-gradient-to-br ${promo.bg}`}
                style={{
                  transform: `translateX(${(i - index) * 100}%)`,
                  opacity: i === index ? 1 : 0,
                }}
              >
                <div className="absolute inset-0 bg-black/10" />
                <div className="relative z-10">
                  <div className="text-9xl mb-8 drop-shadow-lg">
                    {promo.emoji}
                  </div>
                  <h2 className="text-7xl font-black text-white mb-4 tracking-tight drop-shadow-xl">
                    {promo.title}
                  </h2>
                  <p className="text-2xl text-white/90 font-semibold max-w-2xl drop-shadow-lg">
                    {promo.subtitle}
                  </p>
                </div>
              </div>
            ))}

            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-2 z-20">
              {PROMOS.map((_, i) => (
                <div
                  key={i}
                  className={`h-2 rounded-full transition-all duration-500 ${
                    i === index
                      ? 'w-10 bg-white shadow-lg'
                      : 'w-2 bg-white/50'
                  }`}
                />
              ))}
            </div>
          </div>

          <aside className="w-[30%] flex flex-col gap-6 min-h-0">
            <div className="rounded-3xl bg-white/95 backdrop-blur p-7 shadow-xl ring-1 ring-white/60">
              <div className="flex items-center gap-3 mb-5">
                <span className="text-3xl">⭐</span>
                <div>
                  <h3 className="text-xl font-black text-navy-900">
                    Today&apos;s Specials
                  </h3>
                  <p className="text-sm text-navy-600/70 font-medium">
                    Chef&apos;s curated picks
                  </p>
                </div>
              </div>
              <div className="space-y-3">
                {SPECIALS.map((s, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-3 rounded-2xl bg-amber-50/80 hover:bg-amber-100/80 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{s.emoji}</span>
                      <span className="font-semibold text-navy-900 text-base">
                        {s.name}
                      </span>
                    </div>
                    <span className="font-bold text-accent-600 tabular-nums">
                      {formatPrice(s.price * 100)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl bg-navy-900/95 backdrop-blur p-7 shadow-xl text-white flex-1 flex flex-col">
              <div className="flex items-center gap-3 mb-5">
                <div className="h-11 w-11 rounded-2xl bg-amber-500/20 flex items-center justify-center">
                  <span className="text-2xl">📍</span>
                </div>
                <div>
                  <h3 className="text-lg font-black">
                    {branding.branchName || 'Port Harcourt'}
                  </h3>
                  <p className="text-sm text-navy-200/70 font-medium">
                    {branding.openingHours || 'Mon–Sun 8am – 11pm'}
                  </p>
                </div>
              </div>

              <div className="mt-auto flex items-end justify-between">
                <div>
                  <p className="text-xs uppercase tracking-widest text-navy-300/60 mb-2 font-bold">
                    Scan to order
                  </p>
                  <div className="h-24 w-24 rounded-2xl bg-white flex items-center justify-center shadow-inner">
                    <div className="grid grid-cols-4 gap-0.5 p-2">
                      {Array.from({ length: 16 }).map((_, i) => (
                        <div
                          key={i}
                          className={`w-4 h-4 rounded-sm ${
                            Math.random() > 0.4 ? 'bg-navy-900' : 'bg-transparent'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs uppercase tracking-widest text-navy-300/60 mb-2 font-bold">
                    Order ready?
                  </p>
                  <div className="text-4xl font-black text-amber-400 tabular-nums">
                    #---
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </main>

        <footer className="flex items-center justify-between px-12 py-6 border-t border-navy-900/10 bg-white/40 backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/30">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse-soft" />
              <span className="font-bold text-emerald-700 text-sm">
                {branding.wifi || 'Free Wi-Fi: ProlificTables_Guest'}
              </span>
            </div>
          </div>
          <div className="text-navy-700/70 font-semibold text-sm">
            Powering great experiences · Prolific POS
          </div>
        </footer>
      </div>
    </div>
  );
}
