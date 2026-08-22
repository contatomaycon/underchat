import type {
  SecureConnectionSessionResponse,
  SecureConnectionStatus,
  SecureSessionPackage,
} from './types';

type ApiResponse<T> = {
  data?: T;
  message?: string;
  status?: boolean;
};

const helperPlatform = 'chrome_extension';

function normalizeApiBaseUrl(value: string | undefined): string {
  const normalized = value?.trim().replace(/\/+$/, '') ?? '';
  const withoutVersion = normalized.endsWith('/v1')
    ? normalized.slice(0, -3)
    : normalized;

  return withoutVersion || 'http://localhost:3002';
}

function buildUrl(token: string, suffix = ''): string {
  const baseUrl = normalizeApiBaseUrl(__UNDERCHAT_EXTENSION_API_BASE_URL__);

  return `${baseUrl}/v1/worker/connection/secure-helper/${encodeURIComponent(
    token
  )}${suffix}`;
}

async function parseApiResponse<T>(response: Response): Promise<T> {
  const payload = (await response
    .json()
    .catch(() => null)) as ApiResponse<T> | null;

  if (!response.ok || !payload?.status || payload.data === undefined) {
    throw new Error(
      payload?.message || `Underchat API retornou HTTP ${response.status}.`
    );
  }

  return payload.data;
}

export async function fetchSecureSession(
  token: string,
  signal?: AbortSignal
): Promise<SecureConnectionSessionResponse> {
  const response = await fetch(buildUrl(token), {
    headers: { Accept: 'application/json' },
    method: 'GET',
    signal,
  });

  return parseApiResponse<SecureConnectionSessionResponse>(response);
}

export async function updateSecureStatus(input: {
  error?: string;
  message?: string;
  signal?: AbortSignal;
  status: SecureConnectionStatus;
  token: string;
}): Promise<SecureConnectionSessionResponse> {
  const response = await fetch(buildUrl(input.token, '/status'), {
    body: JSON.stringify({
      error: input.error,
      helper_platform: helperPlatform,
      helper_version: __UNDERCHAT_EXTENSION_VERSION__,
      message: input.message,
      status: input.status,
    }),
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    method: 'POST',
    signal: input.signal,
  });

  return parseApiResponse<SecureConnectionSessionResponse>(response);
}

export async function uploadSecureSession(input: {
  signal?: AbortSignal;
  sessionPackage: SecureSessionPackage;
  token: string;
}): Promise<SecureConnectionSessionResponse> {
  const response = await fetch(buildUrl(input.token, '/session'), {
    body: JSON.stringify(input.sessionPackage),
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    method: 'POST',
    signal: input.signal,
  });

  return parseApiResponse<SecureConnectionSessionResponse>(response);
}
