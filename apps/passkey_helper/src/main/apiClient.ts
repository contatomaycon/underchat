import type { PasskeyDeepLinkContext } from './deepLink';

export interface PasskeyHelperSession {
  channel_name?: string;
  channelName?: string;
  confirmationCode?: string;
  connection_attempt_id?: string;
  error?: string;
  expires_at?: string;
  expiresAt?: string;
  helper_download_url?: string;
  message?: string;
  passkey_confirmation_code?: string;
  passkey_public_key?: unknown;
  passkey_skip_handoff_ux?: boolean;
  passkeyPublicKey?: unknown;
  publicKey?: unknown;
  skipHandoffUX?: boolean;
  status?: number | string;
  token_hash?: string;
  worker_id?: string;
  worker_type_id?: string;
}

export interface PasskeyHelperActionResult {
  code?: number;
  confirmationCode?: string;
  connected?: boolean;
  error?: string;
  message?: string;
  passkey_confirmation_code?: string;
  passkeyConfirmationCode?: string;
  passkey_skip_handoff_ux?: boolean;
  passkeySkipHandoffUX?: boolean;
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
  context: PasskeyDeepLinkContext,
  details?: Record<string, unknown>
) => void;

export class PasskeyHelperApiClient {
  constructor(private readonly log?: ApiLogFn) {}

  async fetchSession(
    context: PasskeyDeepLinkContext
  ): Promise<PasskeyHelperSession> {
    return this.request<PasskeyHelperSession>(context, '', {
      method: 'GET',
    });
  }

  async sendPasskeyResponse(
    context: PasskeyDeepLinkContext,
    passkeyResponse: unknown
  ): Promise<PasskeyHelperActionResult> {
    return this.request<PasskeyHelperActionResult>(
      context,
      '/passkey-response',
      {
        body: JSON.stringify(passkeyResponse),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      }
    );
  }

  async confirmPasskey(
    context: PasskeyDeepLinkContext
  ): Promise<PasskeyHelperActionResult> {
    return this.request<PasskeyHelperActionResult>(
      context,
      '/passkey-confirmation',
      {
        body: JSON.stringify({ confirmed: true }),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      }
    );
  }

  async updateSecureStatus(
    context: PasskeyDeepLinkContext,
    input: {
      error?: string;
      helper_platform?: string;
      helper_version?: string;
      message?: string;
      status: string;
    }
  ): Promise<PasskeyHelperActionResult> {
    return this.request<PasskeyHelperActionResult>(context, '/status', {
      body: JSON.stringify(input),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    });
  }

  async uploadSecureSession(
    context: PasskeyDeepLinkContext,
    sessionPackage: SecureSessionPackage
  ): Promise<PasskeyHelperActionResult> {
    return this.request<PasskeyHelperActionResult>(context, '/session', {
      body: JSON.stringify(sessionPackage),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    });
  }

  private async request<T>(
    context: PasskeyDeepLinkContext,
    suffix: string,
    init: RequestInit
  ): Promise<T> {
    const basePath =
      context.mode === 'secure'
        ? '/worker/connection/secure-helper'
        : '/worker/connection/passkey-helper';
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
