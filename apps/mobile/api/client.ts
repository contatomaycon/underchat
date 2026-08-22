import { BACKEND_URL } from '../config';
import { getToken } from '../storage/authStorage';
import { emitAttendanceBlocked } from '../utils/authEvents';
import type { AttendanceBlockedPayload } from '../types/attendanceHours';
import { teardownMobileSessionOnUnauthorized } from '../utils/sessionTeardown';
import { refreshSessionTokenWithSingleFlight } from './sessionRefresh';

const BASE = `${BACKEND_URL}/v1`;
const AUTH_REQUEST_TIMEOUT_MS = 30000;
const AUTH_FORM_REQUEST_TIMEOUT_MS = 600000;

export type ApiUploadProgressCallback = (progress: number) => void;

export type ApiFormRequestOptions = {
  onUploadProgress?: ApiUploadProgressCallback;
  timeoutMs?: number;
};

async function handleUnauthorized(): Promise<void> {
  await teardownMobileSessionOnUnauthorized();
}

type AttendanceBlockedBody = {
  message?: unknown;
  data?: {
    reason?: unknown;
    attendance_guard?: unknown;
  };
};

function handleAttendanceBlockedBody(body: unknown): boolean {
  const typed = body as AttendanceBlockedBody | null;

  if (typed?.data?.reason !== 'user_attendance_hours_blocked') {
    return false;
  }

  if (
    !typed?.data?.attendance_guard ||
    typeof typed.data.attendance_guard !== 'object'
  ) {
    return false;
  }

  const payload: AttendanceBlockedPayload = {
    reason: 'user_attendance_hours_blocked',
    attendance_guard: typed.data
      .attendance_guard as AttendanceBlockedPayload['attendance_guard'],
    message:
      typeof typed.message === 'string' && typed.message.trim().length > 0
        ? typed.message
        : null,
  };

  emitAttendanceBlocked(payload);

  return true;
}

async function handleAttendanceBlocked(response: Response): Promise<boolean> {
  if (response.status !== 403) {
    return false;
  }

  try {
    return handleAttendanceBlockedBody(await response.json());
  } catch {
    return false;
  }
}

type ApiEnvelope<T> = { status: boolean; data: T };
type ApiEnvelopeWithMessage<T> = {
  id?: unknown;
  status?: boolean;
  data?: T;
  message?: unknown;
  operation_id?: unknown;
  idempotency_key?: unknown;
};
type QueryParamScalar = string | number;
type QueryParamValue = QueryParamScalar | QueryParamScalar[] | null | undefined;

export type ApiDetailedResponse<T> = {
  status: boolean;
  data: T | null;
  message: string | null;
  requestId: string | null;
  httpStatus: number | null;
  operationId?: string;
  idempotencyKey?: string;
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

function normalizeDetailedResponse<T>(
  data: ApiEnvelopeWithMessage<T> | null | undefined,
  httpStatus: number | null = null
): ApiDetailedResponse<T> {
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
    requestId:
      typeof data?.id === 'string' && data.id.trim().length > 0
        ? data.id
        : null,
    httpStatus,
    ...(typeof data?.operation_id === 'string' && data.operation_id
      ? { operationId: data.operation_id }
      : {}),
    ...(typeof data?.idempotency_key === 'string' && data.idempotency_key
      ? { idempotencyKey: data.idempotency_key }
      : {}),
  };
}

async function parseJsonDetailed<T>(
  response: Response
): Promise<ApiDetailedResponse<T> | null> {
  try {
    const data = (await response.json()) as ApiEnvelopeWithMessage<T>;
    return normalizeDetailedResponse(data, response.status);
  } catch {
    return null;
  }
}

function parseJsonText<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function parseDetailedJsonText<T>(
  text: string,
  httpStatus: number | null = null
): ApiDetailedResponse<T> | null {
  const data = parseJsonText<ApiEnvelopeWithMessage<T>>(text);
  if (!data) return null;
  return normalizeDetailedResponse(data, httpStatus);
}

async function buildAuthHeaders(
  contentType?: 'application/json',
  tokenOverride?: string
): Promise<Record<string, string> | null> {
  const token = tokenOverride ?? (await getToken());
  if (!token) return null;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Language': 'pt',
    Authorization: `Bearer ${token}`,
    'X-Client-Platform': 'mobile',
  };

  if (contentType) {
    headers['Content-Type'] = contentType;
  }

  return headers;
}

async function executeAuthRequest(
  execute: (headers: Record<string, string>) => Promise<Response>,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<Response | null> {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  try {
    const timeoutPromise = new Promise<null>((resolve) => {
      timeout = setTimeout(() => resolve(null), timeoutMs);
    });

    return await Promise.race([execute(headers), timeoutPromise]);
  } catch {
    return null;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function requestWithAuthRetry(
  contentType: 'application/json' | undefined,
  execute: (headers: Record<string, string>) => Promise<Response>,
  timeoutMs = AUTH_REQUEST_TIMEOUT_MS
): Promise<Response | null> {
  const initialHeaders = await buildAuthHeaders(contentType);
  if (!initialHeaders) {
    return null;
  }

  const initialResponse = await executeAuthRequest(
    execute,
    initialHeaders,
    timeoutMs
  );
  if (!initialResponse) {
    return null;
  }

  if (initialResponse.status !== 401) {
    return initialResponse;
  }

  const refreshedToken = await refreshSessionTokenWithSingleFlight();

  if (!refreshedToken) {
    await handleUnauthorized();
    return null;
  }

  const retryHeaders = await buildAuthHeaders(contentType, refreshedToken);

  if (!retryHeaders) {
    await handleUnauthorized();
    return null;
  }

  const retriedResponse = await executeAuthRequest(
    execute,
    retryHeaders,
    timeoutMs
  );
  if (!retriedResponse) {
    return null;
  }

  if (retriedResponse.status === 401) {
    await handleUnauthorized();
    return null;
  }

  return retriedResponse;
}

type UploadRequestMethod = 'POST' | 'PATCH';

type UploadRequestResult = {
  status: number;
  bodyText: string;
};

function executeUploadRequest(input: {
  url: string;
  method: UploadRequestMethod;
  body: FormData;
  headers: Record<string, string>;
  options?: ApiFormRequestOptions;
}): Promise<UploadRequestResult | null> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    let settled = false;

    const settle = (result: UploadRequestResult | null) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    xhr.open(input.method, input.url);
    xhr.timeout = input.options?.timeoutMs ?? AUTH_FORM_REQUEST_TIMEOUT_MS;

    for (const [key, value] of Object.entries(input.headers)) {
      xhr.setRequestHeader(key, value);
    }

    xhr.upload.onprogress = (event) => {
      if (!input.options?.onUploadProgress) return;
      if (!event.lengthComputable || !event.total) {
        input.options.onUploadProgress(0);
        return;
      }

      const progress = Math.min(
        99,
        Math.round((event.loaded / event.total) * 100)
      );
      input.options.onUploadProgress(progress);
    };

    xhr.onload = () => {
      settle({
        status: xhr.status,
        bodyText: typeof xhr.responseText === 'string' ? xhr.responseText : '',
      });
    };
    xhr.onerror = () => settle(null);
    xhr.onabort = () => settle(null);
    xhr.ontimeout = () => settle(null);

    try {
      xhr.send(input.body);
    } catch {
      settle(null);
    }
  });
}

async function uploadWithAuthRetry(input: {
  url: string;
  method: UploadRequestMethod;
  body: FormData;
  options?: ApiFormRequestOptions;
}): Promise<UploadRequestResult | null> {
  const initialHeaders = await buildAuthHeaders(undefined);
  if (!initialHeaders) {
    return null;
  }

  const initialResponse = await executeUploadRequest({
    ...input,
    headers: initialHeaders,
  });
  if (!initialResponse) {
    return null;
  }

  if (initialResponse.status !== 401) {
    return initialResponse;
  }

  const refreshedToken = await refreshSessionTokenWithSingleFlight();

  if (!refreshedToken) {
    await handleUnauthorized();
    return null;
  }

  const retryHeaders = await buildAuthHeaders(undefined, refreshedToken);

  if (!retryHeaders) {
    await handleUnauthorized();
    return null;
  }

  input.options?.onUploadProgress?.(0);

  const retriedResponse = await executeUploadRequest({
    ...input,
    headers: retryHeaders,
  });
  if (!retriedResponse) {
    return null;
  }

  if (retriedResponse.status === 401) {
    await handleUnauthorized();
    return null;
  }

  return retriedResponse;
}

export async function apiGet<T>(
  path: string,
  params?: Record<string, QueryParamValue>
): Promise<{ status: boolean; data: T } | null> {
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

  const res = await requestWithAuthRetry('application/json', (headers) =>
    fetch(url.toString(), {
      method: 'GET',
      headers,
    })
  );

  if (!res) {
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
  const url = path.startsWith('http')
    ? path
    : `${BASE}${path.startsWith('/') ? '' : '/'}${path}`;

  const res = await requestWithAuthRetry('application/json', (headers) =>
    fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  );

  if (!res) {
    return null;
  }

  if (await handleAttendanceBlocked(res)) {
    return null;
  }

  return parseJsonSafe<T>(res);
}

export async function apiPostWithMessage<T>(
  path: string,
  body: unknown
): Promise<ApiDetailedResponse<T> | null> {
  const url = path.startsWith('http')
    ? path
    : `${BASE}${path.startsWith('/') ? '' : '/'}${path}`;

  const res = await requestWithAuthRetry('application/json', (headers) =>
    fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  );

  if (!res) {
    return null;
  }

  if (await handleAttendanceBlocked(res)) {
    return null;
  }

  return parseJsonDetailed<T>(res);
}

export async function apiPostForm<T>(
  path: string,
  body: FormData
): Promise<{ status: boolean; data: T } | null> {
  const url = path.startsWith('http')
    ? path
    : `${BASE}${path.startsWith('/') ? '' : '/'}${path}`;

  const res = await requestWithAuthRetry(
    undefined,
    (headers) =>
      fetch(url, {
        method: 'POST',
        headers,
        body,
      }),
    AUTH_FORM_REQUEST_TIMEOUT_MS
  );

  if (!res) {
    return null;
  }

  if (await handleAttendanceBlocked(res)) {
    return null;
  }

  return parseJsonSafe<T>(res);
}

export async function apiPostFormWithMessage<T>(
  path: string,
  body: FormData,
  options?: ApiFormRequestOptions
): Promise<ApiDetailedResponse<T> | null> {
  const url = path.startsWith('http')
    ? path
    : `${BASE}${path.startsWith('/') ? '' : '/'}${path}`;

  if (options?.onUploadProgress) {
    const uploadResponse = await uploadWithAuthRetry({
      url,
      method: 'POST',
      body,
      options,
    });

    if (!uploadResponse) {
      return null;
    }

    const rawBody = parseJsonText<unknown>(uploadResponse.bodyText);
    if (uploadResponse.status === 403 && handleAttendanceBlockedBody(rawBody)) {
      return null;
    }

    return parseDetailedJsonText<T>(
      uploadResponse.bodyText,
      uploadResponse.status
    );
  }

  const res = await requestWithAuthRetry(
    undefined,
    (headers) =>
      fetch(url, {
        method: 'POST',
        headers,
        body,
      }),
    AUTH_FORM_REQUEST_TIMEOUT_MS
  );

  if (!res) {
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
  const url = path.startsWith('http')
    ? path
    : `${BASE}${path.startsWith('/') ? '' : '/'}${path}`;

  const res = await requestWithAuthRetry('application/json', (headers) =>
    fetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    })
  );

  if (!res) {
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
  const url = path.startsWith('http')
    ? path
    : `${BASE}${path.startsWith('/') ? '' : '/'}${path}`;

  const res = await requestWithAuthRetry('application/json', (headers) =>
    fetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    })
  );

  if (!res) {
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
  const url = path.startsWith('http')
    ? path
    : `${BASE}${path.startsWith('/') ? '' : '/'}${path}`;

  const res = await requestWithAuthRetry('application/json', (headers) =>
    fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    })
  );

  if (!res) {
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
  const url = path.startsWith('http')
    ? path
    : `${BASE}${path.startsWith('/') ? '' : '/'}${path}`;

  const res = await requestWithAuthRetry(
    undefined,
    (headers) =>
      fetch(url, {
        method: 'PATCH',
        headers,
        body,
      }),
    AUTH_FORM_REQUEST_TIMEOUT_MS
  );

  if (!res) {
    return null;
  }

  if (await handleAttendanceBlocked(res)) {
    return null;
  }

  return parseJsonSafe<T>(res);
}

export async function apiPatchFormWithMessage<T>(
  path: string,
  body: FormData,
  options?: ApiFormRequestOptions
): Promise<ApiDetailedResponse<T> | null> {
  const url = path.startsWith('http')
    ? path
    : `${BASE}${path.startsWith('/') ? '' : '/'}${path}`;

  if (options?.onUploadProgress) {
    const uploadResponse = await uploadWithAuthRetry({
      url,
      method: 'PATCH',
      body,
      options,
    });

    if (!uploadResponse) {
      return null;
    }

    const rawBody = parseJsonText<unknown>(uploadResponse.bodyText);
    if (uploadResponse.status === 403 && handleAttendanceBlockedBody(rawBody)) {
      return null;
    }

    return parseDetailedJsonText<T>(
      uploadResponse.bodyText,
      uploadResponse.status
    );
  }

  const res = await requestWithAuthRetry(
    undefined,
    (headers) =>
      fetch(url, {
        method: 'PATCH',
        headers,
        body,
      }),
    AUTH_FORM_REQUEST_TIMEOUT_MS
  );

  if (!res) {
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
  const contentType = body !== undefined ? 'application/json' : undefined;
  const url = path.startsWith('http')
    ? path
    : `${BASE}${path.startsWith('/') ? '' : '/'}${path}`;

  const res = await requestWithAuthRetry(contentType, (headers) => {
    const requestInit: RequestInit = {
      method: 'DELETE',
      headers,
    };

    if (body !== undefined) {
      requestInit.body = JSON.stringify(body);
    }

    return fetch(url, requestInit);
  });

  if (!res) {
    return null;
  }

  if (await handleAttendanceBlocked(res)) {
    return null;
  }

  return parseJsonSafe<T>(res);
}
