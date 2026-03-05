import { BACKEND_URL } from '../config';
import { getToken, clearAuth } from '../storage/authStorage';
import {
  emitAttendanceBlocked,
  emitAuthUnauthorized,
} from '../utils/authEvents';
import type { AttendanceBlockedPayload } from '../types/attendanceHours';

const BASE = `${BACKEND_URL}/v1`;

async function handleUnauthorized(): Promise<void> {
  await clearAuth();
  emitAuthUnauthorized();
}

async function handleAttendanceBlocked(response: Response): Promise<boolean> {
  if (response.status !== 403) {
    return false;
  }

  try {
    const body = (await response.json()) as {
      message?: unknown;
      data?: {
        reason?: unknown;
        attendance_guard?: unknown;
      };
    };

    if (body?.data?.reason !== 'user_attendance_hours_blocked') {
      return false;
    }

    if (
      !body?.data?.attendance_guard ||
      typeof body.data.attendance_guard !== 'object'
    ) {
      return false;
    }

    const payload: AttendanceBlockedPayload = {
      reason: 'user_attendance_hours_blocked',
      attendance_guard: body.data
        .attendance_guard as AttendanceBlockedPayload['attendance_guard'],
      message:
        typeof body.message === 'string' && body.message.trim().length > 0
          ? body.message
          : null,
    };

    emitAttendanceBlocked(payload);

    return true;
  } catch {
    return false;
  }
}

type ApiEnvelope<T> = { status: boolean; data: T };
type ApiEnvelopeWithMessage<T> = {
  status?: boolean;
  data?: T;
  message?: unknown;
};
type QueryParamScalar = string | number;
type QueryParamValue = QueryParamScalar | QueryParamScalar[] | null | undefined;

export type ApiDetailedResponse<T> = {
  status: boolean;
  data: T | null;
  message: string | null;
};

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

async function parseJsonDetailed<T>(
  response: Response
): Promise<ApiDetailedResponse<T> | null> {
  try {
    const data = (await response.json()) as ApiEnvelopeWithMessage<T>;
    const message =
      typeof data?.message === 'string' && data.message.trim().length > 0
        ? data.message
        : null;
    const status = data?.status === true;
    const payload =
      data?.data !== undefined && data?.data !== null ? data.data : null;

    return {
      status,
      data: payload,
      message,
    };
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
  params?: Record<string, QueryParamValue>
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
      if (typeof v === 'undefined' || v === null) continue;

      if (Array.isArray(v)) {
        const definedItems = v.filter(
          (item): item is QueryParamScalar =>
            typeof item !== 'undefined' && item !== null
        );

        for (const item of definedItems) {
          url.searchParams.append(k, String(item));
        }
        continue;
      }

      url.searchParams.set(k, String(v));
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

  if (await handleAttendanceBlocked(res)) {
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

  if (await handleAttendanceBlocked(res)) {
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

  if (await handleAttendanceBlocked(res)) {
    return null;
  }

  return parseJsonSafe<T>(res);
}

export async function apiPostFormWithMessage<T>(
  path: string,
  body: FormData
): Promise<ApiDetailedResponse<T> | null> {
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

  if (await handleAttendanceBlocked(res)) {
    return null;
  }

  return parseJsonDetailed<T>(res);
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

  if (await handleAttendanceBlocked(res)) {
    return null;
  }

  return parseJsonSafe<T>(res);
}

export async function apiPatchWithMessage<T>(
  path: string,
  body: unknown
): Promise<ApiDetailedResponse<T> | null> {
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

  if (await handleAttendanceBlocked(res)) {
    return null;
  }

  return parseJsonDetailed<T>(res);
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

  if (await handleAttendanceBlocked(res)) {
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

  if (await handleAttendanceBlocked(res)) {
    return null;
  }

  return parseJsonSafe<T>(res);
}

export async function apiPatchFormWithMessage<T>(
  path: string,
  body: FormData
): Promise<ApiDetailedResponse<T> | null> {
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

  if (await handleAttendanceBlocked(res)) {
    return null;
  }

  return parseJsonDetailed<T>(res);
}

export async function apiDelete<T>(
  path: string,
  body?: unknown
): Promise<{ status: boolean; data: T } | null> {
  const headers = await buildAuthHeaders(
    body !== undefined ? 'application/json' : undefined
  );
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

  if (await handleAttendanceBlocked(res)) {
    return null;
  }

  return parseJsonSafe<T>(res);
}
