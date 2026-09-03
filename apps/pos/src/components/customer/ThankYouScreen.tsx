'use client';

import { useEffect, useState } from 'react';
import type { CustomerBranding, CustomerOrderPreview } from '../../vite-env';
import { POWERED_BY_LABEL, APP_VERSION } from '../../lib/app-meta';

interface Props {
  branding: CustomerBranding;
  order?: CustomerOrderPreview;
  onAutoNavigate: () => void;
}

export default function ThankYouScreen({ branding, order, onAutoNavigate }: Props) {
  const [fadingOut, setFadingOut] = useState(false);
  const [countdown, setCountdown] = useState(12);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(timer);
          setFadingOut(true);
          setTimeout(onAutoNavigate, 600);
          return 0;
        }
        return c - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [onAutoNavigate]);

  return (
    <div
      className={`absolute inset-0 w-full h-full overflow-hidden bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-700 flex items-center justify-center transition-opacity duration-700 ${
        fadingOut ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(255,255,255,0.15),_transparent_60%)]" />
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {Array.from({ length: 20 }).map((_, i) => (
          <div
            key={i}
            className="absolute text-5xl animate-pulse-soft"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 2}s`,
              opacity: 0.15,
            }}
          >
            {['✨', '🎉', '💫', '⭐', '🌟'][Math.floor(Math.random() * 5)]}
          </div>
        ))}
      </div>

      <div className="relative z-10 w-full max-w-3xl mx-12">
        <div className="bg-white rounded-[3rem] shadow-2xl p-14 text-center animate-slide-up">
          <div className="flex justify-center mb-8">
            <div className="relative">
              <div className="absolute inset-0 bg-emerald-400 rounded-full blur-3xl opacity-40 animate-pulse-soft" />
              <div className="relative h-32 w-32 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-2xl ring-8 ring-emerald-100">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
            </div>
          </div>

          <h1
            className="text-black font-black tracking-tight mb-4"
            style={{ fontSize: '5rem', lineHeight: 1 }}
          >
            Thank You!
          </h1>

          <p className="text-xl text-slate-600 font-semibold mb-10">
            Your order is preparing — listen for your number!
          </p>

          {order && (
            <div className="rounded-3xl bg-slate-50 p-8 mb-10">
              <div className="grid grid-cols-2 gap-6 text-left">
                <div>
                  <div className="text-xs uppercase tracking-widest text-slate-400 font-black mb-1.5">
                    Order Number
                  </div>
                  <div className="text-4xl font-black text-slate-900 tabular-nums">
                    #{order.orderNumber}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-widest text-slate-400 font-black mb-1.5">
                    Items
                  </div>
                  <div className="text-4xl font-black text-amber-600 tabular-nums">
                    {order.lines.reduce((s, l) => s + l.qty, 0)}
                  </div>
                </div>
              </div>

              <div className="h-px bg-slate-200 my-6" />

              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-widest text-slate-400 font-black mb-1">
                    Total Paid
                  </div>
                  <div className="text-3xl font-black text-emerald-600 tabular-nums">
                    ₦{new Intl.NumberFormat('en-NG', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    }).format(Math.round(order.totalCents) / 100)}
                  </div>
                </div>
                <div className="flex items-center gap-3 px-5 py-3 rounded-2xl bg-emerald-50 ring-1 ring-emerald-200">
                  <span className="h-3 w-3 rounded-full bg-emerald-500 animate-pulse-soft" />
                  <span className="font-black text-emerald-700 text-lg">
                    {order.orderStatus === 'READY'
                      ? 'Ready to pick up!'
                      : order.orderStatus === 'PREPARING'
                        ? 'Cooking now...'
                        : order.orderStatus === 'SERVED'
                          ? 'Served'
                          : 'In kitchen'}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-start justify-center gap-10 mb-10">
            <div className="text-left">
              <div className="text-xs uppercase tracking-widest text-slate-400 font-black mb-2">
                Branch
              </div>
              <div className="text-xl font-black text-slate-800">
                {branding.branchName || 'Port Harcourt'}
              </div>
              <div className="text-lg font-semibold text-slate-500 mt-0.5">
                {branding.name || 'Prolific Tables'}
              </div>
            </div>

            <div className="text-left">
              <div className="text-xs uppercase tracking-widest text-slate-400 font-black mb-2">
                Receipt QR
              </div>
              <div className="h-28 w-28 rounded-2xl bg-white ring-2 ring-slate-200 flex items-center justify-center shadow-inner">
                <div className="grid grid-cols-5 gap-0.5 p-2">
                  {Array.from({ length: 25 }).map((_, i) => (
                    <div
                      key={i}
                      className={`w-3.5 h-3.5 rounded-sm ${
                        Math.random() > 0.4 ? 'bg-slate-900' : 'bg-transparent'
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center gap-4 p-5 rounded-2xl bg-slate-50">
            <div className="h-12 w-12 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
              <div className="relative">
                <span className="absolute inset-0 rounded-full bg-amber-400/30 animate-ping" />
                <span className="relative text-2xl">🔔</span>
              </div>
            </div>
            <div className="text-left">
              <div className="font-black text-slate-800 text-lg">
                We&apos;ll call your number when ready
              </div>
              <div className="text-sm text-slate-500 font-semibold">
                Returning to promotions in{' '}
                <span className="font-black text-amber-600 text-base tabular-nums">
                  {countdown}s
                </span>
              </div>
            </div>
          </div>

          <div className="mt-8 h-2 w-full rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 transition-all duration-1000 ease-linear rounded-full"
              style={{ width: `${((12 - countdown) / 12) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Footer branding: vendor + version (visible even on the thank-you confetti screen) */}
      <div className="absolute bottom-0 inset-x-0 z-20 px-10 py-4 border-t border-white/10 bg-gradient-to-t from-black/30 to-transparent backdrop-blur-sm flex items-center justify-between gap-3 text-sm">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 ring-1 ring-inset ring-white/15">
          <span className="font-black text-emerald-200 tracking-[0.18em] uppercase text-xs">
            Prolific POS v{APP_VERSION}
          </span>
        </div>
        <div className="font-semibold text-white/90">
          {POWERED_BY_LABEL}
        </div>
      </div>
    </div>
  );
}
