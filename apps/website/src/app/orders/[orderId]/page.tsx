import Link from 'next/link';
import OrderStatusClient, {
  LiveStatusPillar,
  LiveWhenCompleted,
} from '../../t/[token]/orders/[orderId]/order-status-client';

const API_BASE =
  (process.env.NEXT_PUBLIC_API_URL as string) || 'http://localhost:4000/api/v1';

async function fetchOrderStatus(orderId: string): Promise<any> {
  try {
    const res = await fetch(`${API_BASE}/public/orders/${orderId}`, {
      method: 'GET',
      cache: 'no-store',
    });
    const json = await res.json();
    if (!res.ok) return { error: json?.error?.message || `HTTP ${res.status}` };
    return json.data;
  } catch (e: any) {
    return { error: e?.message || 'Network error' };
  }
}

function formatNGN(amountCents: number) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
  }).format(amountCents / 100);
}

export default async function WebsiteOrderStatusPage({
  params,
  searchParams,
}: {
  params: { orderId: string };
  searchParams?: { ref?: string; status?: string };
}) {
  const { orderId } = params;
  const data = await fetchOrderStatus(orderId);

  if (data?.error) {
    return (
      <div className="min-h-screen w-full flex justify-center items-start bg-gradient-mesh-warm py-0 sm:py-6">
        <div className="w-full max-w-[480px] mx-auto min-h-screen sm:min-h-[calc(100vh-3rem)] sm:shadow-2xl sm:rounded-[2.5rem] sm:overflow-hidden relative border-x border-t sm:border border-restaurant-100 bg-restaurant flex flex-col items-center justify-center px-6 py-16">
          <div className="w-24 h-24 rounded-full bg-amber-100 flex items-center justify-center mb-5 shadow-card animate-fade-in">
            <span className="text-5xl">🔎</span>
          </div>
          <h1 className="text-xl headline text-restaurant-800 mb-2 animate-fade-in-up">
            Order not found
          </h1>
          <p className="text-sm text-ink-muted text-center max-w-sm mb-6 animate-fade-in-up-100">
            {data.error}
          </p>
          <Link
            href="/"
            className="rounded-2xl bg-gradient-warm text-white px-6 py-3 font-semibold shadow-glow-restaurant hover:brightness-105 transition animate-fade-in-up-200"
          >
            Back to Menu
          </Link>
        </div>
      </div>
    );
  }

  const restaurantName =
    (typeof process !== 'undefined'
      ? process.env.NEXT_PUBLIC_RESTAURANT_NAME
      : undefined) || 'Prolific Tables';

  return (
    <div className="min-h-screen w-full flex justify-center items-start bg-gradient-mesh-warm py-0 sm:py-6">
      <div className="w-full max-w-[480px] mx-auto min-h-screen sm:min-h-[calc(100vh-3rem)] sm:shadow-2xl sm:rounded-[2.5rem] sm:overflow-hidden relative border-x border-t sm:border border-restaurant-100 bg-slate-50">
        <div className="min-h-screen bg-slate-50 flex flex-col pb-8">
          <header className="sticky top-0 z-20 glass-dark px-4 py-3">
            <div className="flex items-center gap-3">
              <Link
                href="/"
                className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition"
                aria-label="Back"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="19" y1="12" x2="5" y2="12" />
                  <polyline points="12 19 5 12 12 5" />
                </svg>
              </Link>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-restaurant-100 opacity-80 leading-none">{restaurantName}</p>
                <h1 className="text-sm font-bold text-white truncate leading-tight mt-0.5">
                  Order {data.orderNumber}
                </h1>
              </div>
            </div>
          </header>

          <OrderStatusClient
            initialStatus={data.status}
            initialPaymentStatus={data.paymentStatus}
            orderId={orderId}
          >
            <main className="flex-1 px-4 pt-4 space-y-4">
              {searchParams?.status === 'success' && searchParams?.ref && (
                <div className="rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3 flex items-start gap-3 animate-fade-in-up">
                  <span className="text-xl flex-shrink-0">✅</span>
                  <div>
                    <p className="font-semibold text-emerald-800 text-sm">
                      Payment successful
                    </p>
                    <p className="text-[11px] text-emerald-700 mt-0.5">
                      Ref: {searchParams.ref.slice(0, 14)}…
                    </p>
                  </div>
                </div>
              )}
              {searchParams?.status === 'failed' && (
                <div className="rounded-2xl bg-red-50 border border-red-200 px-4 py-3 flex items-start gap-3 animate-fade-in-up">
                  <span className="text-xl flex-shrink-0">❌</span>
                  <div>
                    <p className="font-semibold text-red-800 text-sm">Payment failed</p>
                    <p className="text-[11px] text-red-600 mt-0.5">
                      You can pay at the counter instead.
                    </p>
                  </div>
                </div>
              )}

              <div className="rounded-3xl bg-gradient-sunset p-6 text-white shadow-glow-accent relative overflow-hidden">
                <div aria-hidden className="absolute -top-16 -right-12 w-48 h-48 rounded-full bg-white/10 blur-3xl" />
                <div className="relative z-10">
                  <p className="text-[11px] uppercase tracking-widest font-bold text-white/80">
                    Order Total
                  </p>
                  <p className="headline text-display-sm mt-1">
                    {formatNGN(data.totalCents)}
                  </p>
                </div>
              </div>

              <LiveStatusPillar />

              <div className="rounded-3xl bg-white shadow-md border border-restaurant-100 p-5">
                <h3 className="text-sm font-bold text-ink mb-4 flex items-center gap-2">
                  <span>🧾</span> Items
                </h3>
                <ul className="divide-y divide-restaurant-50">
                  {data.items?.map((it: any, idx: number) => (
                    <li key={idx} className="py-3 flex items-start gap-3 first:pt-0 last:pb-0 animate-fade-in-up" style={{ animationDelay: `${idx * 60}ms` }}>
                      <div className="w-11 h-11 rounded-2xl bg-restaurant-50 flex items-center justify-center flex-shrink-0 text-xl ring-1 ring-restaurant-100">
                        🍲
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-sm font-semibold text-ink">
                            {it.quantity}× {it.name}
                          </p>
                          <p className="text-sm font-bold text-restaurant-700 flex-shrink-0 tabular-nums">
                            {formatNGN(it.totalCents)}
                          </p>
                        </div>
                        {it.modifiersSummary?.length > 0 && (
                          <p className="mt-1 text-xs text-ink-muted">
                            + {it.modifiersSummary.join(', ')}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="rule my-4" />
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between text-ink-muted">
                    <span>Subtotal</span>
                    <span className="tabular-nums">{formatNGN(data.subtotalCents)}</span>
                  </div>
                  <div className="flex justify-between text-ink-muted">
                    <span>Tax</span>
                    <span className="tabular-nums">{formatNGN(data.taxCents)}</span>
                  </div>
                  <div className="flex justify-between text-ink-muted">
                    <span>Discount</span>
                    <span className="tabular-nums">{formatNGN(data.discountCents)}</span>
                  </div>
                  <div className="rule my-2" />
                  <div className="flex justify-between font-bold text-ink text-base">
                    <span>Total</span>
                    <span className="text-restaurant-700 tabular-nums">{formatNGN(data.totalCents)}</span>
                  </div>
                </div>
              </div>

              <LiveWhenCompleted>
                <div className="rounded-3xl bg-emerald-50 border border-emerald-200 p-6 text-center animate-scale-in">
                  <div className="w-16 h-16 mx-auto rounded-full bg-gradient-forest text-white flex items-center justify-center mb-4 shadow-glow-emerald">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  <h3 className="headline text-display-sm text-emerald-900">Thank you!</h3>
                  <p className="text-sm text-emerald-800 mt-1">
                    Hope to see you again soon.
                  </p>
                  <div className="mt-5 grid grid-cols-1 gap-3">
                    <Link
                      href="/"
                      className="w-full rounded-2xl bg-emerald-600 text-white py-3.5 font-semibold hover:bg-emerald-700 shadow-md"
                    >
                      Back to home
                    </Link>
                  </div>
                </div>
              </LiveWhenCompleted>
            </main>
          </OrderStatusClient>
        </div>
      </div>
    </div>
  );
}
