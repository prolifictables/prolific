'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CustomerBranding,
  CustomerOrderPreview,
  CustomerPromo,
  CustomerScreenName,
  CustomerSpecial,
  CustomerStatePayload,
} from '../../vite-env';
import CustomerIdleScreen from './CustomerIdleScreen';
import ActiveOrderScreen from './ActiveOrderScreen';
import ThankYouScreen from './ThankYouScreen';

const DEFAULT_BRANDING: CustomerBranding = {
  name: 'Prolific Tables',
  tagline: 'Bold Flavours, Warm Welcome',
  wifi: 'Free Wi-Fi: ProlificTables_Guest',
  openingHours: 'Mon–Sun 8am – 11pm',
  branchName: 'Port Harcourt',
};

export default function CustomerDisplayApp() {
  const [screen, setScreen] = useState<CustomerScreenName>('idle');
  const [branding, setBranding] = useState<CustomerBranding>(DEFAULT_BRANDING);
  const [orderPreview, setOrderPreview] = useState<CustomerOrderPreview | null>(null);
  // Admin-edited promos and specials; null = "use CustomerIdleScreen baked-in defaults".
  // These arrive via the BroadcastChannel payload every time emitCustomerState fires.
  const [promos, setPromos] = useState<CustomerPromo[] | null>(null);
  const [specials, setSpecials] = useState<CustomerSpecial[] | null>(null);

  const thankyouTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screenRef = useRef(screen);
  screenRef.current = screen;

  const clearThankyouTimer = useCallback(() => {
    if (thankyouTimerRef.current) {
      clearTimeout(thankyouTimerRef.current);
      thankyouTimerRef.current = null;
    }
  }, []);

  const goToIdle = useCallback(() => {
    clearThankyouTimer();
    setScreen('idle');
  }, [clearThankyouTimer]);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const fallback =
          (await window.customerWindowAPI?.getRestaurantBranding?.()) || null;
        if (alive && fallback) {
          setBranding((prev) => ({ ...prev, ...fallback }));
        }
      } catch (e) {
        console.warn('[customer-display] getRestaurantBranding failed', e);
      }
    })();

    const handleState = (payload: CustomerStatePayload) => {
      if (!alive) return;
      if (!payload) return;

      if (payload.branding) {
        setBranding((prev) => ({ ...prev, ...payload.branding! }));
      }

      if (payload.orderPreview) {
        setOrderPreview(payload.orderPreview);
      }

      // Admin-edited promo carousel / today's specials (from branch.settings → customerDisplay).
      // Explicit arrays (even empty) set state; missing key leaves it alone.
      if (Object.prototype.hasOwnProperty.call(payload, 'promos')) {
        setPromos(Array.isArray(payload.promos) ? payload.promos : null);
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'specials')) {
        setSpecials(Array.isArray(payload.specials) ? payload.specials : null);
      }

      const nextScreen = payload.screen;
      if (!nextScreen || nextScreen === 'idle') {
        clearThankyouTimer();
        setScreen('idle');
        return;
      }

      if (nextScreen === 'order') {
        clearThankyouTimer();
        setScreen('order');
        return;
      }

      if (nextScreen === 'thankyou') {
        clearThankyouTimer();
        setScreen('thankyou');
        thankyouTimerRef.current = setTimeout(() => {
          if (screenRef.current === 'thankyou') {
            setScreen('idle');
          }
        }, 12000);
        return;
      }
    };

    // Primary subscription path: Electron real preload (or the mock shim's
    // polyfill installed alongside it). This fires immediately in both
    // environments and keeps the popup in sync.
    try {
      window.customerWindowAPI?.subscribeCustomerState?.(handleState);
    } catch (e) {
      console.warn('[customer-display] subscribeCustomerState failed', e);
    }

    // Browser-mode fallback: listen DIRECTLY on the BroadcastChannel bus.
    // This is redundant when the polyfill is installed, but it makes the
    // customer display robust to HMR re-installs and any race where the
    // popup mounts before the shim finishes wiring subscribeCustomerState.
    // POS window is the writer (emits customer-state), popup is the reader.
    let fallbackChannel: BroadcastChannel | null = null;
    try {
      fallbackChannel = new BroadcastChannel('prolific-customer-display-v1');
      fallbackChannel.onmessage = (ev: MessageEvent) => {
        const msg = ev.data;
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'customer-state') {
          handleState(msg.payload || {});
        }
      };
      // Ask the POS window to replay the last known state. Without this, a
      // popup opened AFTER the cashier already had a cart sits on stale idle
      // screen until the next item add/remove. customer-latest-request is a
      // symmetrical handshake that the POS window's channel handler replies
      // to by re-posting latestCustomerState.
      try {
        fallbackChannel.postMessage({ type: 'customer-latest-request' });
      } catch (_) {
        /* ignore */
      }
    } catch (e) {
      console.warn('[customer-display] BroadcastChannel fallback unavailable', e);
      fallbackChannel = null;
    }

    return () => {
      alive = false;
      clearThankyouTimer();
      try {
        window.customerWindowAPI?.unsubscribeCustomerState?.();
      } catch (_e) {
        // ignore
      }
      try {
        fallbackChannel?.close();
      } catch (_e) {
        // ignore
      }
    };
  }, [clearThankyouTimer]);

  const renderCurrentScreen = () => {
    switch (screen) {
      case 'idle':
        return <CustomerIdleScreen branding={branding} promos={promos} specials={specials} />;
      case 'order':
        return (
          <ActiveOrderScreen
            branding={branding}
            order={
              orderPreview || {
                orderNumber: '000',
                lines: [],
                subtotalCents: 0,
                discountCents: 0,
                taxCents: 0,
                totalCents: 0,
              }
            }
          />
        );
      case 'thankyou':
        return (
          <ThankYouScreen
            branding={branding}
            order={orderPreview || undefined}
            onAutoNavigate={goToIdle}
          />
        );
      default:
        return <CustomerIdleScreen branding={branding} promos={promos} specials={specials} />;
    }
  };

  return (
    <div
      className="absolute inset-0 w-0 h-0 bg-slate-950 text-white overflow-hidden touch-none"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw',
        height: '100vh',
        margin: 0,
        padding: 0,
      }}
    >
      {renderCurrentScreen()}
    </div>
  );
}
