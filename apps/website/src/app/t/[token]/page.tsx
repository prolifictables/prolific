import { notFound } from 'next/navigation';
import Link from 'next/link';
import SessionClientShell from './client-shell';

const API_BASE =
  (process.env.NEXT_PUBLIC_API_URL as string) || 'http://localhost:4000/api/v1';

async function resolveQrServerSide(token: string): Promise<any> {
  try {
    const res = await fetch(`${API_BASE}/public/qr/${token}`, {
      method: 'GET',
      cache: 'no-store',
    });
    const json = await res.json();
    if (!res.ok) return { error: json?.error?.message || `HTTP ${res.status}` };
    return json.data;
  } catch (e: any) {
    return { error: e?.message || 'Network error resolving QR' };
  }
}

interface QrTokenPageProps {
  params: { token: string };
}

export default async function QrTokenPage({ params }: QrTokenPageProps) {
  const token = params.token;
  const resolved = await resolveQrServerSide(token);

  if (resolved?.error) {
    return (
      <div className="min-h-screen w-full flex justify-center items-start bg-[#050506] py-0 sm:py-6 relative">
        <div aria-hidden className="fixed inset-0 -z-10 pointer-events-none">
          <div className="absolute -top-24 left-[10%] w-[32rem] h-[32rem] rounded-full blob bg-amber-500/15 blur-[120px]" />
          <div className="absolute top-40 right-[8%] w-[28rem] h-[28rem] rounded-full blob bg-pink-500/12 blur-[120px]" />
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[40rem] h-[32rem] rounded-full blob bg-cyan-500/10 blur-[120px]" />
          <div className="absolute inset-0 bg-cyber-grid opacity-[0.12]" />
        </div>
        <div className="w-full max-w-[480px] mx-auto min-h-screen sm:min-h-[calc(100vh-3rem)] sm:shadow-2xl sm:shadow-amber-500/25 sm:rounded-[2.5rem] sm:overflow-hidden relative border sm:border-white/10 bg-surface-sunken flex flex-col items-center justify-center px-6 py-16">
          <div className="w-28 h-28 rounded-full bg-gradient-neon/20 flex items-center justify-center mb-6 shadow-glow-restaurant ring-1 ring-amber-400/30 animate-float">
            <div className="w-20 h-20 rounded-full bg-surface-panel flex items-center justify-center ring-1 ring-white/10">
              <span className="text-5xl">🍽️</span>
            </div>
          </div>
          <div className="text-center max-w-sm animate-fade-in-up">
            <h1 className="text-2xl headline text-white mb-2">
              QR code invalid or expired
            </h1>
            <p className="text-sm text-ink-muted mb-8 leading-relaxed">
              This QR token may have been used, disabled, or it doesn&apos;t match any active table.
              Please scan the printed QR on your table again, or ask a staff member for assistance.
            </p>
            <div className="space-y-3">
              <Link
                href="/"
                className="block w-full rounded-2xl bg-gradient-neon text-white py-3.5 font-semibold shadow-glow-restaurant hover:brightness-110 transition"
              >
                Back to Home
              </Link>
              <button
                onClick={() => window.location.reload()}
                className="block w-full rounded-2xl border border-white/10 bg-surface-muted text-white py-3.5 font-semibold hover:bg-white/5 transition shadow-sm"
              >
                Scan Another QR
              </button>
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
                    TABLE {table?.name || '—'}
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

          <SessionClientShell token={token} initialResolvedQr={resolved} />
        </div>
      </div>
    </div>
  );
}
