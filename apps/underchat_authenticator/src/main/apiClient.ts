import type { SecureSessionPackage as BrowserSecureSessionPackage } from '@underchat/whatsapp-web-session-browser';

import type { AuthenticatorDeepLinkContext } from './deepLink';

export interface AuthenticatorSession {
  channel_name?: string;
  channelName?: string;
  connection_attempt_id?: string;
  error?: string;
  expires_at?: string;
  expiresAt?: string;
  message?: string;
  status?: number | string;
  token_hash?: string;
  worker_id?: string;
  worker_type_id?: string;
}

export interface AuthenticatorActionResult {
  connected?: boolean;
  error?: string;
  message?: string;
  status?: number | string;
}

export interface SecureSessionPackage extends BrowserSecureSessionPackage {
  payload_ref?: string;
}

interface ApiEnvelope<T> {
  data?: T;
  error?: string;
  fail_reason?: string;
  message?: string;
  status?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function extractApiErrorMessage(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  const scopes = [value];
  if (isRecord(value.data)) scopes.push(value.data);
  if (isRecord(value.error)) scopes.push(value.error);

  for (const key of ['fail_reason', 'error', 'message'] as const) {
    for (const scope of scopes) {
      const candidate = scope[key];
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
  }

  return null;
}

type ApiLogFn = (
  event: string,
  context: AuthenticatorDeepLinkContext,
  details?: Record<string, unknown>
) => void;

export class AuthenticatorApiClient {
  constructor(private readonly log?: ApiLogFn) {}

  async fetchSession(
    context: AuthenticatorDeepLinkContext
  ): Promise<AuthenticatorSession> {
    return this.request<AuthenticatorSession>(context, '', {
      method: 'GET',
    });
  }

  async updateSecureStatus(
    context: AuthenticatorDeepLinkContext,
    input: {
      error?: string;
      helper_platform?: string;
      helper_version?: string;
      message?: string;
      status: string;
    }
  ): Promise<AuthenticatorActionResult> {
    return this.request<AuthenticatorActionResult>(context, '/status', {
      body: JSON.stringify(input),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    });
  }

  async uploadSecureSession(
    context: AuthenticatorDeepLinkContext,
    sessionPackage: SecureSessionPackage
  ): Promise<AuthenticatorActionResult> {
    return this.request<AuthenticatorActionResult>(context, '/session', {
      body: JSON.stringify(sessionPackage),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    });
  }

  private async request<T>(
    context: AuthenticatorDeepLinkContext,
    suffix: string,
    init: RequestInit
  ): Promise<T> {
    const basePath = '/worker/connection/secure-helper';
    const endpoint = `${context.apiBaseUrl}${basePath}/${encodeURIComponent(
      context.token
    )}${suffix}`;
    const startedAt = Date.now();

    this.log?.('api.request.start', context, {
      body_bytes:
        typeof init.body === 'string'
          ? Buffer.byteLength(init.body)
          : undefined,
      method: init.method ?? 'GET',
      suffix: suffix || '/',
    });

    try {
      const response = await fetch(endpoint, {
        ...init,
        cache: 'no-store',
        redirect: 'error',
      });

      this.log?.('api.request.response', context, {
        duration_ms: Date.now() - startedAt,
        method: init.method ?? 'GET',
        status: response.status,
        suffix: suffix || '/',
      });

      if (!response.ok) {
        const errorPayload = (await response
          .json()
          .catch(() => null)) as unknown;
        throw new Error(
          extractApiErrorMessage(errorPayload) ??
            `API retornou HTTP ${response.status}.`
        );
      }

      if (response.status === 204) {
        return {} as T;
      }

      const json = (await response.json()) as T | ApiEnvelope<T>;

      if (
        json &&
        typeof json === 'object' &&
        'status' in json &&
        'data' in json
      ) {
        const envelope = json as ApiEnvelope<T>;
        if (envelope.status === false) {
          throw new Error(
            extractApiErrorMessage(envelope) ?? 'API retornou erro.'
          );
        }
        return (envelope.data ?? ({} as T)) as T;
      }

      return json as T;
    } catch (error) {
      this.log?.('api.request.error', context, {
        duration_ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
        method: init.method ?? 'GET',
        suffix: suffix || '/',
      });
      throw error;
    }
  }
}
