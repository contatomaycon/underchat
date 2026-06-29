import { injectable } from 'tsyringe';

interface MetaGraphErrorResponse {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
  };
}

export class MetaGraphApiError extends Error {
  code: number | null;
  errorSubcode: number | null;
  type: string | null;

  constructor(error: NonNullable<MetaGraphErrorResponse['error']>) {
    super(error.message ?? 'Meta Graph API request failed');
    this.name = 'MetaGraphApiError';
    this.code = error.code ?? null;
    this.errorSubcode = error.error_subcode ?? null;
    this.type = error.type ?? null;
  }
}

export const isMetaPermissionsError = (error: unknown): boolean => {
  if (error instanceof MetaGraphApiError) {
    return error.code === 200;
  }

  return (
    error instanceof Error &&
    /(?:\(#200\)|code\s*200).*permissions?\s+error/i.test(error.message)
  );
};

export const isMetaSmbDeregisterUnsupportedError = (error: unknown): boolean =>
  error instanceof Error &&
  /deregister endpoint is not available for api solution for smb businesses/i.test(
    error.message
  );

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

interface MetaBusinessProfile {
  about?: string;
  address?: string;
  description?: string;
  email?: string;
  profile_picture_url?: string;
  websites?: string[];
  vertical?: string;
}

interface MetaBusinessProfileResponse extends MetaGraphErrorResponse {
  data?: MetaBusinessProfile[];
}

interface MetaSuccessResponse extends MetaGraphErrorResponse {
  success?: boolean;
}

interface MetaUploadSessionResponse extends MetaGraphErrorResponse {
  id?: string;
}

interface MetaUploadHandleResponse extends MetaGraphErrorResponse {
  h?: string;
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

export interface MetaWhatsappBusinessProfile {
  about: string | null;
  address: string | null;
  description: string | null;
  email: string | null;
  profile_picture_url: string | null;
  websites: string[];
  vertical: string | null;
}

export interface UpdateMetaWhatsappBusinessProfile {
  about?: string | null;
  address?: string | null;
  description?: string | null;
  email?: string | null;
  websites?: string[];
  vertical?: string | null;
  profile_picture_handle?: string | null;
}

@injectable()
export class MetaWhatsappEmbeddedService {
  private graphUrl(apiVersion: string, path: string): string {
    return `https://graph.facebook.com/${apiVersion}/${path.replace(/^\/+/u, '')}`;
  }

  private async parseGraphResponse<T extends MetaGraphErrorResponse>(
    response: Response
  ): Promise<T> {
    const responseText = await response.text();
    const payload = responseText.trim()
      ? (JSON.parse(responseText) as T)
      : ({} as T);

    if (!response.ok || payload.error) {
      if (payload.error) {
        throw new MetaGraphApiError(payload.error);
      }

      throw new Error('Meta Graph API request failed');
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
    const phones = await this.listPhoneNumbers({
      apiVersion: input.apiVersion,
      accessToken: input.accessToken,
      wabaId: input.wabaId,
    });

    const phone = phones.find((item) => item.id === input.phoneNumberId);

    if (!phone) {
      throw new Error('Meta phone number not found in selected WABA');
    }

    return phone;
  }

  async listPhoneNumbers(input: {
    apiVersion: string;
    accessToken: string;
    wabaId: string;
  }): Promise<MetaWhatsappPhoneNumber[]> {
    const url = new URL(
      this.graphUrl(input.apiVersion, `${input.wabaId}/phone_numbers`)
    );
    url.searchParams.set('fields', 'id,display_phone_number,verified_name');
    url.searchParams.set('limit', '100');
    url.searchParams.set('access_token', input.accessToken);

    const response = await fetch(url);
    const payload =
      await this.parseGraphResponse<MetaPhoneNumbersResponse>(response);

    return (
      payload.data?.map((phone) => ({
        id: phone.id,
        display_phone_number: phone.display_phone_number ?? null,
        verified_name: phone.verified_name ?? null,
      })) ?? []
    );
  }

  async viewBusinessProfile(input: {
    apiVersion: string;
    accessToken: string;
    phoneNumberId: string;
  }): Promise<MetaWhatsappBusinessProfile> {
    const url = new URL(
      this.graphUrl(
        input.apiVersion,
        `${input.phoneNumberId}/whatsapp_business_profile`
      )
    );
    url.searchParams.set(
      'fields',
      'about,address,description,email,profile_picture_url,websites,vertical'
    );
    url.searchParams.set('access_token', input.accessToken);

    const response = await fetch(url);
    const payload =
      await this.parseGraphResponse<MetaBusinessProfileResponse>(response);
    const profile = payload.data?.[0] ?? {};

    return {
      about: profile.about ?? null,
      address: profile.address ?? null,
      description: profile.description ?? null,
      email: profile.email ?? null,
      profile_picture_url: profile.profile_picture_url ?? null,
      websites: Array.isArray(profile.websites) ? profile.websites : [],
      vertical: profile.vertical ?? null,
    };
  }

  async updateBusinessProfile(input: {
    apiVersion: string;
    accessToken: string;
    phoneNumberId: string;
    data: UpdateMetaWhatsappBusinessProfile;
  }): Promise<boolean> {
    const body: Record<string, unknown> = {
      messaging_product: 'whatsapp',
    };

    for (const key of [
      'about',
      'address',
      'description',
      'email',
      'websites',
      'vertical',
      'profile_picture_handle',
    ] as const) {
      const value = input.data[key];
      if (value !== undefined) {
        body[key] = value;
      }
    }

    const response = await fetch(
      this.graphUrl(
        input.apiVersion,
        `${input.phoneNumberId}/whatsapp_business_profile`
      ),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
    const payload =
      await this.parseGraphResponse<MetaSuccessResponse>(response);

    return payload.success !== false;
  }

  async unsubscribeWabaApp(input: {
    apiVersion: string;
    accessToken: string;
    wabaId: string;
  }): Promise<boolean> {
    const url = new URL(
      this.graphUrl(input.apiVersion, `${input.wabaId}/subscribed_apps`)
    );
    url.searchParams.set('access_token', input.accessToken);

    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
      },
    });
    const payload =
      await this.parseGraphResponse<MetaSuccessResponse>(response);

    return payload.success !== false;
  }

  async deregisterPhoneNumber(input: {
    apiVersion: string;
    accessToken: string;
    phoneNumberId: string;
  }): Promise<boolean> {
    const response = await fetch(
      this.graphUrl(input.apiVersion, `${input.phoneNumberId}/deregister`),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
        },
      }
    );
    const payload =
      await this.parseGraphResponse<MetaSuccessResponse>(response);

    return payload.success !== false;
  }

  async uploadProfilePicture(input: {
    apiVersion: string;
    accessToken: string;
    appId: string;
    filename: string;
    fileType: string;
    fileBuffer: Buffer;
  }): Promise<string> {
    const sessionUrl = new URL(
      this.graphUrl(input.apiVersion, `${input.appId}/uploads`)
    );
    sessionUrl.searchParams.set('file_name', input.filename);
    sessionUrl.searchParams.set('file_length', String(input.fileBuffer.length));
    sessionUrl.searchParams.set('file_type', input.fileType);
    sessionUrl.searchParams.set('access_token', input.accessToken);

    const sessionResponse = await fetch(sessionUrl, { method: 'POST' });
    const sessionPayload =
      await this.parseGraphResponse<MetaUploadSessionResponse>(sessionResponse);

    if (!sessionPayload.id) {
      throw new Error('Meta Graph API did not return an upload session');
    }

    const uploadResponse = await fetch(
      this.graphUrl(input.apiVersion, sessionPayload.id),
      {
        method: 'POST',
        headers: {
          Authorization: `OAuth ${input.accessToken}`,
          file_offset: '0',
          'Content-Type': input.fileType,
        },
        body: new Blob([new Uint8Array(input.fileBuffer)], {
          type: input.fileType,
        }),
      }
    );
    const uploadPayload =
      await this.parseGraphResponse<MetaUploadHandleResponse>(uploadResponse);

    if (!uploadPayload.h) {
      throw new Error('Meta Graph API did not return a profile picture handle');
    }

    return uploadPayload.h;
  }
}
