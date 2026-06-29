import { injectable } from 'tsyringe';

interface MetaGraphErrorResponse {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
  };
}

interface MetaTokenResponse extends MetaGraphErrorResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
}

interface MetaPhoneNumber {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
}

interface MetaPhoneNumbersResponse extends MetaGraphErrorResponse {
  data?: MetaPhoneNumber[];
}

export interface MetaWhatsappToken {
  access_token: string;
  token_type: string | null;
  expires_at: string | null;
  scope: string | null;
}

export interface MetaWhatsappPhoneNumber {
  id: string;
  display_phone_number: string | null;
  verified_name: string | null;
}

@injectable()
export class MetaWhatsappEmbeddedService {
  private graphUrl(apiVersion: string, path: string): string {
    return `https://graph.facebook.com/${apiVersion}/${path.replace(/^\/+/u, '')}`;
  }

  private async parseGraphResponse<T extends MetaGraphErrorResponse>(
    response: Response
  ): Promise<T> {
    const payload = (await response.json()) as T;

    if (!response.ok || payload.error) {
      const message = payload.error?.message ?? 'Meta Graph API request failed';
      throw new Error(message);
    }

    return payload;
  }

  async exchangeCode(input: {
    apiVersion: string;
    appId: string;
    appSecret: string;
    code: string;
  }): Promise<MetaWhatsappToken> {
    const url = new URL(this.graphUrl(input.apiVersion, 'oauth/access_token'));
    url.searchParams.set('client_id', input.appId);
    url.searchParams.set('client_secret', input.appSecret);
    url.searchParams.set('code', input.code);

    const response = await fetch(url);
    const payload = await this.parseGraphResponse<MetaTokenResponse>(response);

    if (!payload.access_token) {
      throw new Error('Meta Graph API did not return an access token');
    }

    const expiresAt = payload.expires_in
      ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
      : null;

    return {
      access_token: payload.access_token,
      token_type: payload.token_type ?? null,
      expires_at: expiresAt,
      scope: payload.scope ?? null,
    };
  }

  async viewPhoneNumber(input: {
    apiVersion: string;
    accessToken: string;
    wabaId: string;
    phoneNumberId: string;
  }): Promise<MetaWhatsappPhoneNumber> {
    const url = new URL(
      this.graphUrl(input.apiVersion, `${input.wabaId}/phone_numbers`)
    );
    url.searchParams.set('fields', 'id,display_phone_number,verified_name');
    url.searchParams.set('limit', '100');
    url.searchParams.set('access_token', input.accessToken);

    const response = await fetch(url);
    const payload =
      await this.parseGraphResponse<MetaPhoneNumbersResponse>(response);

    const phone = payload.data?.find((item) => item.id === input.phoneNumberId);

    if (!phone) {
      throw new Error('Meta phone number not found in selected WABA');
    }

    return {
      id: phone.id,
      display_phone_number: phone.display_phone_number ?? null,
      verified_name: phone.verified_name ?? null,
    };
  }
}
