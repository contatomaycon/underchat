import { BACKEND_URL } from '../config';
import { getToken, setToken } from '../storage/authStorage';

type RefreshTokenResponse = {
  token?: string;
  plan_is_active?: boolean;
};

type ApiEnvelope<T> = {
  status?: boolean;
  data?: T | null;
};

let refreshSessionPromise: Promise<string | null> | null = null;

const REFRESH_PATH = '/v1/auth/refresh-token';

async function refreshSessionToken(): Promise<string | null> {
  const token = await getToken();

  if (!token || !BACKEND_URL) {
    return null;
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

    if (!response.ok) {
      return null;
    }

    const payload =
      (await response.json()) as ApiEnvelope<RefreshTokenResponse>;
    const refreshedToken = payload?.data?.token;

    if (!payload?.status || !refreshedToken) {
      return null;
    }

    await setToken(refreshedToken);
    return refreshedToken;
  } catch {
    return null;
  }
}

export async function refreshSessionTokenWithSingleFlight(): Promise<
  string | null
> {
  if (refreshSessionPromise) {
    return refreshSessionPromise;
  }

  refreshSessionPromise = refreshSessionToken();

  try {
    return await refreshSessionPromise;
  } finally {
    refreshSessionPromise = null;
  }
}
