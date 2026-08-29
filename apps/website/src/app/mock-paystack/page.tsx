'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PrimaryButton } from '../../components/ui/Button';

function formatNGN(amountCents: number) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
  }).format(amountCents / 100);
}

export default function MockPaystackPage({
  searchParams,
}: {
  searchParams?: {
    ref?: string;
    amount?: string;
    status?: string;
  };
}) {
  const ref = searchParams?.ref || 'paystack_test_ref';
  const rawAmount = searchParams?.amount ? Number(searchParams.amount) : 5000;
  const amountCents = rawAmount > 10000 ? rawAmount : rawAmount * 100;
  const [lastToken, setLastToken] = useState<string>('');
  const [lastOrderId, setLastOrderId] = useState<string>('');
  const [lastOrderRoute, setLastOrderRoute] = useState<string>('');

  useEffect(() => {
    try {
      setLastToken(localStorage.getItem('lastToken') || 'DEMO');
      setLastOrderId(localStorage.getItem('lastOrderId') || 'DEMO');
      setLastOrderRoute(localStorage.getItem('lastOrderRoute') || '');
    } catch {}
  }, []);

  const go = (status: 'success' | 'failed') => {
    try {
      localStorage.setItem('mockPayStatus', status);
    } catch {}
    const token = lastToken || 'DEMO';
    const orderId = lastOrderId || 'DEMO';
    const fallbackRoute = `/t/${token}/orders/${orderId}`;
    const route = lastOrderRoute || fallbackRoute;
    const url = new URL(`${window.location.origin}${route}`);
    url.searchParams.set('ref', ref);
    url.searchParams.set('status', status);
    if (status === 'success') {
      const whUrl = `${window.location.origin}/api/payment-mock/webhook`;
      fetch(whUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'paystack',
          ref,
          amountCents,
          status,
          orderId,
        }),
      }).catch(() => {});
    }
    window.location.href = url.toString();
  };

  return (
    <div className="min-h-screen bg-[#0AA5DB]/5 flex flex-col px-4 py-8">
      <div className="mx-auto w-full max-w-sm">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-[#0AA5DB] text-white flex items-center justify-center font-bold">
              P
            </div>
            <div>
              <p className="font-bold text-slate-800 leading-tight">Paystack</p>
              <p className="text-[10px] text-slate-500 uppercase tracking-wide">
                Test Payment
              </p>
            </div>
          </div>
          <span className="text-[10px] bg-slate-100 text-slate-500 rounded-full px-2 py-1 font-mono">
            MOCK
          </span>
        </div>

        <div className="rounded-3xl bg-white shadow-card p-6 border border-slate-100">
          <div className="text-center">
            <p className="text-xs text-slate-500">Amount</p>
            <p className="text-3xl font-serif font-bold text-slate-800 mt-1">
              {formatNGN(amountCents)}
            </p>
            <p className="mt-2 text-[11px] font-mono text-slate-400 break-all">
              Ref: {ref}
            </p>
          </div>

          <div className="mt-6 space-y-3">
            <div className="rounded-xl bg-slate-50 p-3 text-xs space-y-2">
              <div className="flex justify-between text-slate-600">
                <span>Email</span>
                <span className="font-mono text-slate-700">guest@prolific.test</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Card</span>
                <span className="font-mono text-slate-700">•••• •••• •••• 4242</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Expiry</span>
                <span className="font-mono text-slate-700">12/28</span>
              </div>
            </div>

            <PrimaryButton
              fullWidth
              size="lg"
              className="!bg-[#0AA5DB] !hover:bg-[#088ABF]"
              onClick={() => go('success')}
            >
              ✅ Approve (fake success)
            </PrimaryButton>

            <button
              onClick={() => go('failed')}
              className="w-full rounded-2xl py-4 font-semibold text-red-600 border border-red-200 bg-red-50 hover:bg-red-100 transition"
            >
              ❌ Decline (fake fail)
            </button>
          </div>

          <p className="mt-6 text-center text-[10px] text-slate-400">
            This is a mock payment screen for development. No real money changes hands.
          </p>
        </div>

        <div className="mt-6 text-center">
          <Link
            href="/"
            className="text-xs text-slate-400 hover:text-slate-600 underline"
          >
            Cancel &amp; return to home
          </Link>
        </div>
      </div>
    </div>
  );
}
