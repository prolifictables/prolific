const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

type NextFetchRequestConfig = {
  revalidate?: number | false;
  tags?: string[];
};

export async function apiGet<T>(
  path: string,
  opts?: { next?: NextFetchRequestConfig; headers?: HeadersInit }
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'GET',
    cache: 'no-store',
    headers: opts?.headers,
    ...(opts?.next ? { next: opts.next } : {}),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
  return json.data as T;
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  opts?: { headers?: HeadersInit }
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(opts?.headers || {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
  return json.data as T;
}
