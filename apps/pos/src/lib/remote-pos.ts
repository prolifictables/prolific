const API_BASE =
  (typeof import.meta !== 'undefined' &&
    (import.meta as any).env &&
    ((import.meta as any).env.VITE_API_BASE_URL ||
      (import.meta as any).env.VITE_API_URL ||
      (import.meta as any).env.VITE_PUBLIC_API_URL ||
      (import.meta as any).env.API_BASE_URL)) ||
  'http://localhost:4000/api/v1';

export async function fetchPosBootstrap(opts: {
  accessToken: string;
  signal?: AbortSignal;
}): Promise<{ employees: any[]; tables: any[] }> {
  const res = await fetch(`${API_BASE}/pos/bootstrap`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${opts.accessToken}` },
    signal: opts.signal,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      (json && (json.error?.message || json.message || json.error)) ||
      `HTTP ${res.status}`;
    throw new Error(msg);
  }
  const data = json && (json.data ?? json);
  const employees = Array.isArray(data?.employees) ? data.employees : [];
  const tables = Array.isArray(data?.tables) ? data.tables : [];
  return { employees, tables };
}
