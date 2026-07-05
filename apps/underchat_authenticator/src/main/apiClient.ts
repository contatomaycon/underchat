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

export interface SecureSessionPackage {
  account_hint?: string;
  created_at: string;
  format_version: string;
  payload?: unknown;
  payload_ref?: string;
  source: 'whatsapp_web';
  target_provider: 'auto' | 'baileys' | 'wwebjs' | 'whatsmeow';
  web_version?: string;
}

interface ApiEnvelope<T> {
  data?: T;
  message?: string;
  status?: boolean;
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
        throw new Error(`API retornou HTTP ${response.status}.`);
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
          throw new Error(envelope.message ?? 'API retornou erro.');
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
