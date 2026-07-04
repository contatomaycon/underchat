import type { PasskeyDeepLinkContext } from './deepLink';

export interface PasskeyHelperSession {
  channel_name?: string;
  channelName?: string;
  confirmationCode?: string;
  expires_at?: string;
  expiresAt?: string;
  passkey_confirmation_code?: string;
  passkey_public_key?: unknown;
  passkey_skip_handoff_ux?: boolean;
  passkeyPublicKey?: unknown;
  publicKey?: unknown;
  skipHandoffUX?: boolean;
  status?: number;
}

export interface PasskeyHelperActionResult {
  code?: number;
  confirmationCode?: string;
  connected?: boolean;
  message?: string;
  passkey_confirmation_code?: string;
  passkeyConfirmationCode?: string;
  passkey_skip_handoff_ux?: boolean;
  passkeySkipHandoffUX?: boolean;
  status?: number;
}

export class PasskeyHelperApiClient {
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

  private async request<T>(
    context: PasskeyDeepLinkContext,
    suffix: string,
    init: RequestInit
  ): Promise<T> {
    const endpoint = `${context.apiBaseUrl}/worker/connection/passkey-helper/${encodeURIComponent(
      context.token
    )}${suffix}`;
    const response = await fetch(endpoint, {
      ...init,
      cache: 'no-store',
      redirect: 'error',
    });

    if (!response.ok) {
      throw new Error(`API retornou HTTP ${response.status}.`);
    }

    if (response.status === 204) {
      return {} as T;
    }

    return (await response.json()) as T;
  }
}
