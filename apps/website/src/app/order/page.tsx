import { notFound } from 'next/navigation';
import Link from 'next/link';
import SessionClientShell from '../t/[token]/client-shell';
import { apiGet, withFallbackNull } from '../../lib/api';

// ---------------------------------------------------------------------------
// Server-side QR-resolve wrapper: same logic as /t/[token]/page.tsx but the
// identifier comes from the ?table= query param (customer requirement #2).
// Under the hood this calls the exact same publicService.resolveQr validation
// path that /public/qr/:token uses, so server-side validation of TABLE_ID is
// always enforced (customer requirement #8).
// ---------------------------------------------------------------------------
async function resolveTableByQueryParam(tableIdentifier: string): Promise<any> {
  const data = await withFallbackNull(
    apiGet<any>(`/public/table-resolve?table=${encodeURIComponent(tableIdentifier)}`)
  );
  if (data === null || data === undefined) return null;
  return data;
}

interface OrderPageProps {
  searchParams: { table?: string };
}

export default async function OrderByTablePage({ searchParams }: OrderPageProps) {
  const tableIdentifier = String(searchParams?.table || '').trim();

  if (!tableIdentifier) {
    return (
      <div className="min-h-screen w-full flex justify-center items-start bg-[#050506] py-0 sm:py-6 relative">
        <div aria-hidden className="fixed inset-0 -z-10 pointer-events-none">
          <div className="absolute -top-24 left-[10%] w-[32rem] h-[32rem] rounded-full blob bg-amber-500/15 blur-[120px]" />
          <div className="absolute top-40 right-[8%] w-[28rem] h-[28rem] rounded-full blob bg-pink-500/12 blur-[120px]" />
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[40rem] h-[32rem] rounded-full blob bg-cyan-500/10 blur-[120px]" />
          <div className="absolute inset-0 bg-cyber-grid opacity-[0.12]" />
        </div>
        <div className="w-full max-w-[480px] mx-auto min-h-screen sm:min-h-[calc(100vh-3rem)] sm:shadow-2xl sm:shadow-amber-500/25 sm:rounded-[2.5rem] sm:overflow-hidden relative border sm:border-white/10 bg-surface-sunken flex flex-col items-center justify-center px-6 py-16">
          <div className="relative w-28 h-28 mb-6">
            <div className="absolute inset-0 rounded-full bg-rose-500/20" />
            <div className="absolute inset-2 rounded-full bg-rose-500/30 flex items-center justify-center ring-1 ring-rose-400/30">
              <span className="text-4xl">🔗</span>
            </div>
          </div>
          <div className="text-center max-w-sm">
            <h1 className="text-2xl headline text-white mb-2">Missing table</h1>
            <p className="text-sm text-ink-muted mb-8 leading-relaxed">
              This URL is missing a table identifier. Scan a QR code sticker on your table, or add
              <code className="mx-1 px-2 py-0.5 rounded bg-white/10 text-amber-300">?table=T1</code>
              to the URL.
            </p>
            <Link
              href="/"
              className="block w-full rounded-2xl bg-gradient-neon text-white py-3.5 font-semibold shadow-glow-restaurant hover:brightness-110 transition"
            >
              Back to Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const resolved = await resolveTableByQueryParam(tableIdentifier);

  if (!resolved) {
    return (
      <div className="min-h-screen w-full flex justify-center items-start bg-[#050506] py-0 sm:py-6 relative">
        <div aria-hidden className="fixed inset-0 -z-10 pointer-events-none">
          <div className="absolute -top-24 left-[10%] w-[32rem] h-[32rem] rounded-full blob bg-amber-500/15 blur-[120px]" />
          <div className="absolute top-40 right-[8%] w-[28rem] h-[28rem] rounded-full blob bg-pink-500/12 blur-[120px]" />
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[40rem] h-[32rem] rounded-full blob bg-cyan-500/10 blur-[120px]" />
          <div className="absolute inset-0 bg-cyber-grid opacity-[0.12]" />
        </div>
        <div className="w-full max-w-[480px] mx-auto min-h-screen sm:min-h-[calc(100vh-3rem)] sm:shadow-2xl sm:shadow-amber-500/25 sm:rounded-[2.5rem] sm:overflow-hidden relative border sm:border-white/10 bg-surface-sunken flex flex-col items-center justify-center px-6 py-16">
          <div className="relative w-28 h-28 mb-6">
            <div className="absolute inset-0 animate-ping rounded-full bg-amber-500/20" />
            <div className="absolute inset-0 animate-spin rounded-full border-[3px] border-amber-300/15 border-t-amber-400" />
            <div className="absolute inset-2 rounded-full bg-gradient-neon/20 flex items-center justify-center ring-1 ring-amber-400/30">
              <span className="text-4xl">🍽️</span>
            </div>
          </div>
          <div className="text-center max-w-sm animate-pulse">
            <h1 className="text-2xl headline text-white mb-2">
              Loading your table…
            </h1>
            <p className="text-sm text-ink-muted mb-8 leading-relaxed">
              Pulling up the menu for this table — one moment…
            </p>
            <div className="space-y-3">
              <Link
                href="/"
                className="block w-full rounded-2xl bg-gradient-neon text-white py-3.5 font-semibold shadow-glow-restaurant hover:brightness-110 transition"
              >
                Back to Home
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const restaurant = resolved?.restaurant;
  const table = resolved?.table;
  const branch = resolved?.branch;

  return (
    <div className="min-h-screen w-full flex justify-center items-start bg-[#050506] py-0 sm:py-6 relative">
      <div aria-hidden className="fixed inset-0 -z-10 pointer-events-none">
        <div className="absolute -top-24 left-[10%] w-[32rem] h-[32rem] rounded-full blob bg-amber-500/15 blur-[120px]" />
        <div className="absolute top-40 right-[8%] w-[28rem] h-[28rem] rounded-full blob bg-pink-500/12 blur-[120px]" />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[40rem] h-[32rem] rounded-full blob bg-cyan-500/10 blur-[120px]" />
        <div className="absolute inset-0 bg-cyber-grid opacity-[0.12]" />
      </div>
      <div className="w-full max-w-[480px] mx-auto min-h-screen sm:min-h-[calc(100vh-3rem)] sm:shadow-2xl sm:shadow-amber-500/25 sm:rounded-[2.5rem] sm:overflow-hidden relative border sm:border-white/10 bg-surface-sunken">
        <div className="min-h-screen bg-surface-sunken flex flex-col pb-28">
          <header className="sticky top-0 z-30 glass-dark">
            <div className="px-4 py-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-neon/20 border border-white/10 flex items-center justify-center flex-shrink-0 shadow-sm">
                <span className="text-xl">🍽️</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-gradient-neon leading-none font-bold tracking-widest opacity-90">
                  {branch?.name || ''}
                </p>
                <h1 className="text-sm font-bold text-white truncate leading-tight mt-0.5">
                  {restaurant?.name || 'Restaurant'}
                </h1>
              </div>
              <Link
                href="/"
                className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition border border-white/10"
                aria-label="Home"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9.5L12 3l9 6.5V21a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1V9.5z" />
                </svg>
              </Link>
            </div>
            <div className="px-4 pb-3">
              <div className="rounded-2xl glass-neon backdrop-blur px-4 py-3 flex items-center justify-between text-white border border-white/10 shadow-glow-restaurant">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-gradient-neon opacity-90 font-semibold">
                    {table?.zone || 'Your Table'}
                  </p>
                  <p className="font-bold text-lg leading-tight">
                    ORDERING FROM TABLE {table?.name || '—'}
                    {table?.capacity ? (
                      <span className="ml-2 text-xs font-normal text-ink-soft opacity-90">
                        · {table.capacity} seats
                      </span>
                    ) : null}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/15 backdrop-blur px-3 py-1.5 text-xs font-medium ring-1 ring-emerald-400/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-soft shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                  Ready to order
                </div>
              </div>
            </div>
            <nav className="px-4 pb-3 flex gap-2">
              {['Menu', 'Orders', 'Status'].map((t, i) => (
                <button
                  key={t}
                  className={
                    'flex-1 py-2 text-sm rounded-xl font-semibold transition-all duration-300 ' +
                    (i === 0
                      ? 'bg-gradient-neon text-white shadow-glow-restaurant ring-1 ring-white/10'
                      : 'bg-white/5 text-white/70 hover:bg-white/10 border border-white/10')
                  }
                >
                  {t}
                </button>
              ))}
            </nav>
          </header>

          {/*
            Re-use the exact same SessionClientShell component that /t/[token]
            uses. The component expects a token and re-validates via
            initFromToken on hydration — because resolveTableByIdentifier and
            resolveQr share the same service path, the token (TABLE_ID passed
            here) resolves correctly on every layer.
          */}
          <SessionClientShell token={tableIdentifier} initialResolvedQr={resolved} />
        </div>
      </div>
    </div>
  );
}
