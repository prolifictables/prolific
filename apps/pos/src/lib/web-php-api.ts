import { useAuthStore } from './auth-store';
import { webPhpApiBase, webPhpDeviceId } from './web-php-config';

/** Authenticated, fail-closed adapter for browser-only PHP POS requests. */
export async function webPhpRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid PHP API path.');
  const send = async (force = false): Promise<Response> => {
    const token = await useAuthStore.getState().actions.refreshAccessToken({ force, deviceId: webPhpDeviceId() });
    return fetch(`${webPhpApiBase()}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init.headers,
        Authorization: `Bearer ${token}`,
      },
    });
  };
  let response = await send();
  if (response.status === 401) response = await send(true);
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    const safeCode = typeof payload?.error?.code === 'string' ? payload.error.code : '';
    const safeMessage = response.status < 500 && typeof payload?.error?.message === 'string'
      ? payload.error.message : 'The POS service is temporarily unavailable. Please retry.';
    throw new Error(safeCode ? `${safeCode}: ${safeMessage}` : safeMessage);
  }
  return payload.data as T;
}
