const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

const getToken = (): string | null => {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)access_token=([^;]+)/);
  if (match) return decodeURIComponent(match[1]);
  if (typeof window !== 'undefined') {
    return window.localStorage.getItem('access_token');
  }
  return null;
};

const handleUnauthorized = () => {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem('access_token');
    window.localStorage.removeItem('refresh_token');
    window.localStorage.removeItem('auth_user');
    window.localStorage.removeItem('auth_employee');
    window.localStorage.removeItem('auth_restaurant');
    window.localStorage.removeItem('auth_branch');
    if (typeof document !== 'undefined') {
      document.cookie = 'access_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
      document.cookie = 'refresh_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    }
    if (!window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
  }
};

const unwrap = async <T>(res: Response): Promise<T> => {
  let json: any;
  try {
    json = await res.json();
  } catch {
    json = { error: { message: 'Invalid response' } };
  }
  if (res.status === 401) {
    handleUnauthorized();
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const msg = json?.error?.message || json?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json.data as T;
};

const authHeaders = (): HeadersInit => {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
};

export async function apiGet<T>(path: string, opts?: { headers?: HeadersInit }): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      ...authHeaders(),
      ...(opts?.headers || {}),
    },
  });
  return unwrap<T>(res);
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  opts?: { headers?: HeadersInit; skipAuth?: boolean }
): Promise<T> {
  const headers = opts?.skipAuth
    ? { 'Content-Type': 'application/json', ...(opts?.headers || {}) }
    : { ...authHeaders(), ...(opts?.headers || {}) };
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return unwrap<T>(res);
}

export async function apiPatch<T>(
  path: string,
  body: unknown,
  opts?: { headers?: HeadersInit }
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers: {
      ...authHeaders(),
      ...(opts?.headers || {}),
    },
    body: JSON.stringify(body),
  });
  return unwrap<T>(res);
}

export async function apiDelete<T>(path: string, opts?: { headers?: HeadersInit }): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'DELETE',
    headers: {
      ...authHeaders(),
      ...(opts?.headers || {}),
    },
  });
  return unwrap<T>(res);
}

export const API_BASE_URL = API_BASE;
