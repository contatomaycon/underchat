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

interface MetaPaging {
  next?: string;
}

interface MetaMessageTemplateComponent {
  type: string;
  [key: string]: unknown;
}

interface MetaMessageTemplate {
  id?: string;
  name: string;
  language: string;
  category: string;
  sub_category?: string;
  parameter_format?: string;
  components?: MetaMessageTemplateComponent[];
  status?: string;
  quality_score?:
    | {
        score?: string;
        date?: number;
      }
    | string;
  rejected_reason?: string;
  message_send_ttl_seconds?: number;
  created_time?: string;
  updated_time?: string;
}

interface MetaMessageTemplatesResponse extends MetaGraphErrorResponse {
  data?: MetaMessageTemplate[];
  paging?: MetaPaging;
}

interface MetaBusinessApp {
  id: string;
  name?: string;
}

interface MetaBusinessAppsResponse extends MetaGraphErrorResponse {
  data?: MetaBusinessApp[];
  paging?: MetaPaging;
}

export interface MetaWhatsappMessageTemplateMutationResponse extends MetaGraphErrorResponse {
  id?: string;
  status?: string;
  category?: string;
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

export interface MetaWhatsappMessageTemplate {
  id: string | null;
  name: string;
  language: string;
  category: string;
  sub_category: string | null;
  parameter_format: string | null;
  components: MetaMessageTemplateComponent[];
  status: string | null;
  quality_score: string | null;
  rejected_reason: string | null;
  message_send_ttl_seconds: number | null;
  raw: Record<string, unknown>;
}

export interface MetaWhatsappMessageTemplatePayload {
  name?: string;
  language?: string;
  category?: string;
  sub_category?: string | null;
  parameter_format?: string | null;
  components?: MetaMessageTemplateComponent[];
  message_send_ttl_seconds?: number | null;
}

export interface MetaWhatsappBusinessApp {
  id: string;
  name: string | null;
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

  private normalizeTemplate(
    template: MetaMessageTemplate
  ): MetaWhatsappMessageTemplate {
    const qualityScore =
      typeof template.quality_score === 'string'
        ? template.quality_score
        : template.quality_score?.score;

    return {
      id: template.id ?? null,
      name: template.name,
      language: template.language,
      category: template.category,
      sub_category: template.sub_category ?? null,
      parameter_format: template.parameter_format ?? null,
      components: Array.isArray(template.components) ? template.components : [],
      status: template.status ?? null,
      quality_score: qualityScore ?? null,
      rejected_reason: template.rejected_reason ?? null,
      message_send_ttl_seconds:
        template.message_send_ttl_seconds === undefined
          ? null
          : template.message_send_ttl_seconds,
      raw: template as unknown as Record<string, unknown>,
    };
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

  async listMessageTemplates(input: {
    apiVersion: string;
    accessToken: string;
    wabaId: string;
  }): Promise<MetaWhatsappMessageTemplate[]> {
    const url = new URL(
      this.graphUrl(input.apiVersion, `${input.wabaId}/message_templates`)
    );
    url.searchParams.set(
      'fields',
      [
        'id',
        'name',
        'language',
        'category',
        'sub_category',
        'parameter_format',
        'components',
        'status',
        'quality_score',
        'rejected_reason',
        'message_send_ttl_seconds',
      ].join(',')
    );
    url.searchParams.set('limit', '100');
    url.searchParams.set('access_token', input.accessToken);

    const templates: MetaWhatsappMessageTemplate[] = [];
    let nextUrl: string | null = url.toString();

    while (nextUrl) {
      const response: Response = await fetch(nextUrl);
      const payload =
        await this.parseGraphResponse<MetaMessageTemplatesResponse>(response);

      templates.push(
        ...(payload.data?.map((template: MetaMessageTemplate) =>
          this.normalizeTemplate(template)
        ) ?? [])
      );

      nextUrl = payload.paging?.next ?? null;
    }

    return templates;
  }

  private async listBusinessAppEdge(input: {
    apiVersion: string;
    accessToken: string;
    businessId: string;
    edge: 'owned_apps' | 'client_apps';
  }): Promise<MetaWhatsappBusinessApp[]> {
    const url = new URL(
      this.graphUrl(input.apiVersion, `${input.businessId}/${input.edge}`)
    );
    url.searchParams.set('fields', 'id,name');
    url.searchParams.set('limit', '100');
    url.searchParams.set('access_token', input.accessToken);

    const apps: MetaWhatsappBusinessApp[] = [];
    let nextUrl: string | null = url.toString();

    while (nextUrl) {
      const response: Response = await fetch(nextUrl);
      const payload =
        await this.parseGraphResponse<MetaBusinessAppsResponse>(response);

      apps.push(
        ...(payload.data?.map((app) => ({
          id: app.id,
          name: app.name ?? null,
        })) ?? [])
      );

      nextUrl = payload.paging?.next ?? null;
    }

    return apps;
  }

  async listBusinessApps(input: {
    apiVersion: string;
    accessToken: string;
    businessId: string;
  }): Promise<MetaWhatsappBusinessApp[]> {
    const appsById = new Map<string, MetaWhatsappBusinessApp>();
    let fetchedAtLeastOneEdge = false;
    let lastError: unknown = null;

    for (const edge of ['owned_apps', 'client_apps'] as const) {
      try {
        const apps = await this.listBusinessAppEdge({
          ...input,
          edge,
        });
        fetchedAtLeastOneEdge = true;

        for (const app of apps) {
          appsById.set(app.id, app);
        }
      } catch (error) {
        lastError = error;
      }
    }

    if (!fetchedAtLeastOneEdge && lastError) {
      throw lastError;
    }

    return [...appsById.values()].sort((first, second) =>
      (first.name ?? first.id).localeCompare(second.name ?? second.id)
    );
  }

  async createMessageTemplate(input: {
    apiVersion: string;
    accessToken: string;
    wabaId: string;
    payload: MetaWhatsappMessageTemplatePayload;
  }): Promise<MetaWhatsappMessageTemplateMutationResponse> {
    const response = await fetch(
      this.graphUrl(input.apiVersion, `${input.wabaId}/message_templates`),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input.payload),
      }
    );

    return this.parseGraphResponse<MetaWhatsappMessageTemplateMutationResponse>(
      response
    );
  }

  async updateMessageTemplate(input: {
    apiVersion: string;
    accessToken: string;
    templateId: string;
    payload: MetaWhatsappMessageTemplatePayload;
  }): Promise<MetaWhatsappMessageTemplateMutationResponse> {
    const response = await fetch(
      this.graphUrl(input.apiVersion, input.templateId),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input.payload),
      }
    );

    return this.parseGraphResponse<MetaWhatsappMessageTemplateMutationResponse>(
      response
    );
  }

  async deleteMessageTemplate(input: {
    apiVersion: string;
    accessToken: string;
    wabaId: string;
    name: string;
    templateId?: string | null;
  }): Promise<boolean> {
    const url = new URL(
      this.graphUrl(input.apiVersion, `${input.wabaId}/message_templates`)
    );
    url.searchParams.set('name', input.name);
    if (input.templateId) {
      url.searchParams.set('hsm_id', input.templateId);
    }
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

  async uploadFile(input: {
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
      throw new Error('Meta Graph API did not return an upload handle');
    }

    return uploadPayload.h;
  }
}
