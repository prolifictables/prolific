import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { provider, ref, amountCents, status, orderId } = body;
    const apiBase =
      process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
    const backendOrigin = String(apiBase).replace(/\/api\/v1\/?$/, '');
    try {
      const fakeWebhookPayload: any = {
        event:
          status === 'success'
            ? provider === 'paystack'
              ? 'charge.success'
              : 'charge.completed'
            : 'charge.failed',
        data: {
          reference: ref,
          amount: amountCents,
          currency: 'NGN',
          status,
          transaction_id: `mock-${provider}-${Date.now()}`,
          orderId,
          customer: { email: 'guest@prolific.test' },
        },
      };
      const webhookUrl = `${backendOrigin}/api/v1/payments/webhook/${provider}`;
      await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-prolific-mock': '1',
        },
        body: JSON.stringify(fakeWebhookPayload),
      }).catch(() => {});
    } catch {}
    return NextResponse.json({
      ok: true,
      provider,
      ref,
      status,
      note: 'Mock webhook forwarded (signature verification skipped in dev).',
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || 'Bad request' },
      { status: 400 }
    );
  }
}
