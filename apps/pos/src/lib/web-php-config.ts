/** Explicit browser PHP cutover configuration. No implicit Node fallback in this mode. */
export function isWebPhpMode(): boolean {
  return !isNativeDesktop() && import.meta.env.VITE_WEB_PHP_MODE === '1';
}

export function webPhpApiBase(): string {
  const configured = String(import.meta.env.VITE_WEB_PHP_API_BASE_URL || '').trim();
  const inferred =
    !configured && typeof window !== 'undefined' && window.location?.origin
      ? `${window.location.origin.replace(/\/+$/, '')}/api/v1`
      : '';
  const raw = (configured || inferred).trim().replace(/\/+$/, '');
  if (!raw || !/^https:\/\/[^/]+\/api\/v1$|^http:\/\/(?:localhost|127\.0\.0\.1):\d+\/api\/v1$/.test(raw)) {
    throw new Error('Web PHP mode requires an explicit HTTPS API URL (or loopback HTTP) ending in /api/v1.');
  }
  return raw;
}

/** Public identifier, not a credential: must be pre-provisioned as an active POS device server-side. */
export function webPhpDeviceId(): string {
  const configured = String(import.meta.env.VITE_POS_DEVICE_ID || '').trim();
  const stored = typeof localStorage !== 'undefined' ? String(localStorage.getItem('pos_device_id') || '').trim() : '';
  const id = configured || stored;
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) {
    throw new Error('This browser needs a pre-provisioned POS device ID before PHP sign-in.');
  }
  return id;
}

/** Bind browser PIN authentication to the provisioned terminal's branch. */
export function webPhpPinLoginPayload(pin: string): { pin: string; branchId: string; deviceId: string } {
  const configured = String(import.meta.env.VITE_DEFAULT_BRANCH_ID || '').trim();
  const stored =
    typeof localStorage !== 'undefined' ? String(localStorage.getItem('pos_branch_id') || '').trim() : '';
  const branchId = configured || stored;
  if (!/^[a-fA-F0-9]{24}$/.test(branchId)) {
    throw new Error('Web PHP sign-in requires a configured branch ID.');
  }
  return { pin, branchId, deviceId: webPhpDeviceId() };
}

/** Native storage/offline behavior is independent of the server contract. */
export function isNativeDesktop(): boolean {
  return typeof window !== 'undefined' && window.electronAPI?.isNativeDesktop === true;
}
export function isPhpPosMode(): boolean {
  return isNativeDesktop() || isWebPhpMode() || import.meta.env.VITE_PHP_STAGING_TEST === '1';
}
