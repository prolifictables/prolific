'use client';

import { ApiWakeOverlay } from './ApiWakeOverlay';

// Client-only wrapper inserted into RSC root layout as the first child of <body>.
// Mounts the global wake-overlay bus subscriber. The overlay itself is `null` 99%
// of the time; it only becomes visible on the global beginWake() event.
export function ClientApiWakeLayer({ appName }: { appName?: string }) {
  return <ApiWakeOverlay appName={appName} />;
}
