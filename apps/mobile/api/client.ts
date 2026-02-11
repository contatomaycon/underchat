import { BACKEND_URL } from '../config';
import { getToken, clearAuth } from '../storage/authStorage';
import { emitAuthUnauthorized } from '../utils/authEvents';

const BASE = `${BACKEND_URL}/v1`;

async function handleUnauthorized(): Promise<void> {
  await clearAuth();
  emitAuthUnauthorized();
}

export async function apiGet<T>(
  path: string,
  params?: Record<string, string | number | undefined>
): Promise<{ status: boolean; data: T } | null> {
  const token = await getToken();
  if (!token) return null;

  const url = new URL(
    path.startsWith('http')
      ? path
      : `${BASE}${path.startsWith('/') ? '' : '/'}${path}`
  );
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Accept-Language': 'pt',
      Authorization: `Bearer ${token}`,
    },
  });

  if (res.status === 401) {
    await handleUnauthorized();
    return null;
  }

  const body = (await res.json()) as { status: boolean; data: T };
  if (!res.ok || !body?.status) return null;
  return body;
}

export async function apiPost<T>(
  path: string,
  body: unknown
): Promise<{ status: boolean; data: T } | null> {
  const token = await getToken();
  if (!token) return null;

  const url = path.startsWith('http')
    ? path
    : `${BASE}${path.startsWith('/') ? '' : '/'}${path}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Accept-Language': 'pt',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (res.status === 401) {
    await handleUnauthorized();
    return null;
  }

  const data = (await res.json()) as { status: boolean; data: T };
  if (!res.ok || !data?.status) return null;
  return data;
}
