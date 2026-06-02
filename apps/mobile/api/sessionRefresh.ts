import { BACKEND_URL } from '../config';
import { getToken, persistAuthSession } from '../storage/authStorage';
import type { AuthLoginResponse } from './authApi';

export type RefreshSessionData = AuthLoginResponse;

type ApiEnvelope<T> = {
  status?: boolean;
  message?: unknown;
  data?: T | null;
};

export type RefreshSessionFailureReason =
  | 'unauthorized'
  | 'forbidden'
  | 'network_error'
  | 'invalid_response';

export type RefreshSessionResult =
  | { success: true; data: RefreshSessionData }
  | {
      success: false;
      reason: RefreshSessionFailureReason;
      message: string | null;
    };

let refreshSessionPromise: Promise<RefreshSessionResult> | null = null;

const REFRESH_PATH = '/v1/auth/refresh-token';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function isRefreshSessionData(value: unknown): value is RefreshSessionData {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.token === 'string' &&
    isRecord(value.user) &&
    isStringArray(value.permissions) &&
    isStringArray(value.sectors) &&
    Array.isArray(value.channels) &&
    typeof value.plan_is_active === 'boolean' &&
    isStringArray(value.plan_products) &&
    isRecord(value.attendance_guard)
  );
}

function readMessage(payload: ApiEnvelope<unknown> | null): string | null {
  const message = payload?.message;
  return typeof message === 'string' && message.trim().length > 0
    ? message
    : null;
}

async function parseEnvelope(
  response: Response
): Promise<ApiEnvelope<RefreshSessionData> | null> {
  try {
    return (await response.json()) as ApiEnvelope<RefreshSessionData>;
  } catch {
    return null;
  }
}

async function refreshSession(): Promise<RefreshSessionResult> {
  const token = await getToken();

  if (!token || !BACKEND_URL) {
    return {
      success: false,
      reason: !token ? 'unauthorized' : 'network_error',
      message: null,
    };
  }

  try {
    const response = await fetch(`${BACKEND_URL}${REFRESH_PATH}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'pt',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Client-Platform': 'mobile',
      },
      body: '{}',
    });

    const payload = await parseEnvelope(response);

    if (response.status === 401) {
      return {
        success: false,
        reason: 'unauthorized',
        message: readMessage(payload),
      };
    }

    if (response.status === 403) {
      return {
        success: false,
        reason: 'forbidden',
        message: readMessage(payload),
      };
    }

    if (!response.ok) {
      return {
        success: false,
        reason: 'network_error',
        message: readMessage(payload),
      };
    }

    if (!payload?.status || !isRefreshSessionData(payload.data)) {
      return {
        success: false,
        reason: 'invalid_response',
        message: readMessage(payload),
      };
    }

    await persistAuthSession({
      token: payload.data.token,
      user: payload.data.user,
      permissions: payload.data.permissions,
      sectors: payload.data.sectors,
      channels: payload.data.channels,
      plan_products: payload.data.plan_products,
    });

    return { success: true, data: payload.data };
  } catch {
    return {
      success: false,
      reason: 'network_error',
      message: null,
    };
  }
}

export async function refreshSessionWithSingleFlight(): Promise<RefreshSessionResult> {
  if (refreshSessionPromise) {
    return refreshSessionPromise;
  }

  refreshSessionPromise = refreshSession();

  try {
    return await refreshSessionPromise;
  } finally {
    refreshSessionPromise = null;
  }
}

export async function refreshSessionTokenWithSingleFlight(): Promise<
  string | null
> {
  const result = await refreshSessionWithSingleFlight();
  return result.success ? result.data.token : null;
}
