'use client';

import { ApiWakeOverlay } from './ApiWakeOverlay';

export function ClientApiWakeLayer({ appName }: { appName?: string }) {
  return <ApiWakeOverlay appName={appName} />;
}
