import { useEffect, useState } from 'react';

// Minimal boot-time Customer Display landing screen. The Electron customer
// window wires to the POS via IPC (preload/customer.ts) so this standalone
// browser build on :5174 shows a friendly "Waiting for the cashier terminal…"
// placeholder instead of a blank white / 404 page. When a real cashier app
// later mounts the CustomerDisplayApp component (apps/pos/src/components/customer/)
// this screen will be replaced by the live order / thank-you flows.
export default function App() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#050506] text-ink-100">
      {/* Neon gold radial background glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            'radial-gradient(1200px 600px at 50% -10%, rgba(255,215,0,0.18), transparent 60%), radial-gradient(900px 500px at 100% 100%, rgba(212,175,55,0.10), transparent 55%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          maskImage: 'radial-gradient(ellipse at center, black 40%, transparent 75%)',
          WebkitMaskImage:
            'radial-gradient(ellipse at center, black 40%, transparent 75%)',
        }}
      />

      <div className="relative z-10 flex flex-col items-center justify-center w-full h-full px-10 text-center">
        <div className="flex items-center gap-4 mb-6">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl font-black text-navy-950 shadow-glow-restaurant"
            style={{
              background:
                'linear-gradient(180deg, #ffd76a 0%, #d4af37 55%, #8a6a15 100%)',
            }}
          >
            P
          </div>
          <div className="text-left">
            <div className="text-4xl font-black tracking-tight">
              <span className="text-gradient-gold">Prolific</span>
              <span className="text-white"> POS</span>
            </div>
            <div className="text-sm uppercase tracking-[0.3em] text-amber-300/80 font-bold">
              Customer Display
            </div>
          </div>
        </div>

        <h1 className="text-5xl md:text-6xl font-black tracking-tight mb-4 animate-text-glow text-amber-200">
          Welcome 👋
        </h1>
        <p className="max-w-xl text-lg md:text-xl text-ink-300 leading-relaxed mb-10">
          Your order will appear here the moment it is entered at the cashier
          terminal. Thank you for dining with us.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-4xl">
          {[
            { k: 'Your cashier', v: '—', hint: 'Watching for a live shift…' },
            { k: 'Current order', v: 'Idle', hint: 'No items yet' },
            { k: 'Time', v: time, hint: date },
          ].map((c) => (
            <div
              key={c.k}
              className="rounded-3xl bg-white/[0.03] ring-1 ring-inset ring-white/10 px-6 py-5 backdrop-blur-sm"
            >
              <div className="text-[10px] uppercase tracking-[0.22em] text-amber-300/80 font-black mb-2">
                {c.k}
              </div>
              <div className="text-2xl md:text-3xl font-black tabular-nums text-white">
                {c.v}
              </div>
              <div className="text-sm text-ink-400 mt-1">{c.hint}</div>
            </div>
          ))}
        </div>

        <div className="mt-14 flex items-center gap-3 text-sm text-ink-400">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_16px_rgba(52,211,153,0.9)]" />
          Service online · waiting for a cashier to ring items through
        </div>
      </div>
    </div>
  );
}
