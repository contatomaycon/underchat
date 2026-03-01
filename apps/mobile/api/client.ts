import { BACKEND_URL } from '../config';
import { getToken, clearAuth } from '../storage/authStorage';
import { emitAuthUnauthorized } from '../utils/authEvents';

const BASE = `${BACKEND_URL}/v1`;

async function handleUnauthorized(): Promise<void> {
  await clearAuth();
  emitAuthUnauthorized();
}

type ApiEnvelope<T> = { status: boolean; data: T };

async function parseJsonSafe<T>(
  response: Response
): Promise<ApiEnvelope<T> | null> {
  try {
    const data = (await response.json()) as ApiEnvelope<T>;
    if (!response.ok || !data?.status) return null;
    return data;
  } catch {
    return null;
  }
}

async function buildAuthHeaders(
  contentType?: 'application/json'
): Promise<Record<string, string> | null> {
  const token = await getToken();
  if (!token) return null;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Language': 'pt',
    Authorization: `Bearer ${token}`,
  };

  if (contentType) {
    headers['Content-Type'] = contentType;
  }

  return headers;
}

export async function apiGet<T>(
  path: string,
  params?: Record<string, string | number | undefined>
): Promise<{ status: boolean; data: T } | null> {
  const headers = await buildAuthHeaders('application/json');
  if (!headers) return null;

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
    headers,
  });

  if (res.status === 401) {
    await handleUnauthorized();
    return null;
  }

  return parseJsonSafe<T>(res);
}

export async function apiPost<T>(
  path: string,
  body: unknown
): Promise<{ status: boolean; data: T } | null> {
  const headers = await buildAuthHeaders('application/json');
  if (!headers) return null;

  const url = path.startsWith('http')
    ? path
    : `${BASE}${path.startsWith('/') ? '' : '/'}${path}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (res.status === 401) {
    await handleUnauthorized();
    return null;
  }

  return parseJsonSafe<T>(res);
}

export async function apiPostForm<T>(
  path: string,
  body: FormData
): Promise<{ status: boolean; data: T } | null> {
  const headers = await buildAuthHeaders();
  if (!headers) return null;

  const url = path.startsWith('http')
    ? path
    : `${BASE}${path.startsWith('/') ? '' : '/'}${path}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body,
  });

  if (res.status === 401) {
    await handleUnauthorized();
    return null;
  }

  return parseJsonSafe<T>(res);
}

export async function apiPatch<T>(
  path: string,
  body: unknown
): Promise<{ status: boolean; data: T } | null> {
  const headers = await buildAuthHeaders('application/json');
  if (!headers) return null;

  const url = path.startsWith('http')
    ? path
    : `${BASE}${path.startsWith('/') ? '' : '/'}${path}`;

  const res = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });

  if (res.status === 401) {
    await handleUnauthorized();
    return null;
  }

  return parseJsonSafe<T>(res);
}

export async function apiPut<T>(
  path: string,
  body: unknown
): Promise<{ status: boolean; data: T } | null> {
  const headers = await buildAuthHeaders('application/json');
  if (!headers) return null;

  const url = path.startsWith('http')
    ? path
    : `${BASE}${path.startsWith('/') ? '' : '/'}${path}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });

  if (res.status === 401) {
    await handleUnauthorized();
    return null;
  }

  return parseJsonSafe<T>(res);
}

export async function apiPatchForm<T>(
  path: string,
  body: FormData
): Promise<{ status: boolean; data: T } | null> {
  const headers = await buildAuthHeaders();
  if (!headers) return null;

  const url = path.startsWith('http')
    ? path
    : `${BASE}${path.startsWith('/') ? '' : '/'}${path}`;

  const res = await fetch(url, {
    method: 'PATCH',
    headers,
    body,
  });

  if (res.status === 401) {
    await handleUnauthorized();
    return null;
  }

  return parseJsonSafe<T>(res);
}

export async function apiDelete<T>(
  path: string,
  body?: unknown
): Promise<{ status: boolean; data: T } | null> {
  const headers = await buildAuthHeaders('application/json');
  if (!headers) return null;

  const url = path.startsWith('http')
    ? path
    : `${BASE}${path.startsWith('/') ? '' : '/'}${path}`;

  const requestInit: RequestInit = {
    method: 'DELETE',
    headers,
  };

  if (body !== undefined) {
    requestInit.body = JSON.stringify(body);
  }

  const res = await fetch(url, requestInit);

  if (res.status === 401) {
    await handleUnauthorized();
    return null;
  }

  return parseJsonSafe<T>(res);
}
