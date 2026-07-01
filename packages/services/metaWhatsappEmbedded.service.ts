import { injectable } from 'tsyringe';
import { downloadMediaBuffer } from '@core/common/functions/downloadMediaBuffer';

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

interface MetaPagingResponse {
  paging?: {
    next?: string;
  };
}

export interface MetaTemplateButton {
  type?: string;
  text?: string;
  url?: string;
  phone_number?: string;
  example?: string[];
}

export interface MetaTemplateComponent {
  type?: string;
  format?: string;
  text?: string;
  example?: Record<string, unknown>;
  buttons?: MetaTemplateButton[];
}

interface MetaMessageTemplate {
  id?: string;
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  components?: MetaTemplateComponent[];
}

interface MetaMessageTemplatesResponse
  extends MetaGraphErrorResponse, MetaPagingResponse {
  data?: MetaMessageTemplate[];
}

interface MetaWhatsappMessageSendResponse extends MetaGraphErrorResponse {
  messaging_product?: string;
  contacts?: Array<{
    input?: string;
    wa_id?: string;
  }>;
  messages?: Array<{
    id?: string;
    message_status?: string;
  }>;
}

interface MetaWhatsappMediaResponse extends MetaGraphErrorResponse {
  url?: string;
  mime_type?: string;
  sha256?: string;
  file_size?: number;
  id?: string;
  messaging_product?: string;
}

interface MetaWhatsappMediaUploadResponse extends MetaGraphErrorResponse {
  id?: string;
}

type MetaWhatsappMessageType =
  | 'text'
  | 'template'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contacts'
  | 'reaction';

export interface MetaWhatsappContactMessage {
  name: {
    formatted_name: string;
    first_name?: string;
    last_name?: string;
  };
  phones?: Array<{
    phone: string;
    type?: string;
    wa_id?: string;
  }>;
  emails?: Array<{
    email: string;
    type?: string;
  }>;
}

export type MetaWhatsappTemplateComponentParameter = {
  type: 'text';
  text: string;
};

export type MetaWhatsappTemplateMessageComponent = {
  type: 'header' | 'body' | 'button';
  parameters?: MetaWhatsappTemplateComponentParameter[];
  sub_type?: 'url';
  index?: string;
};

export interface MetaWhatsappApprovedTemplate {
  id: string | null;
  name: string;
  language: string;
  status: 'APPROVED';
  category: string | null;
  components: MetaTemplateComponent[];
}

export interface MetaWhatsappMessageSendResult {
  message_id: string | null;
  contact_wa_id: string | null;
  message_status: string | null;
  raw: MetaWhatsappMessageSendResponse;
}

export interface MetaWhatsappMediaInfo {
  id: string;
  url: string;
  mime_type: string | null;
  sha256: string | null;
  file_size: number | null;
}

export interface MetaWhatsappDownloadedMedia {
  buffer: Buffer;
  mimetype: string;
  filename: string;
  size: number;
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

  async listApprovedMessageTemplates(input: {
    apiVersion: string;
    accessToken: string;
    wabaId: string;
  }): Promise<MetaWhatsappApprovedTemplate[]> {
    const templates: MetaWhatsappApprovedTemplate[] = [];
    let nextUrl: string | null = null;
    let page = 0;

    do {
      const url: URL = nextUrl
        ? new URL(nextUrl)
        : new URL(
            this.graphUrl(input.apiVersion, `${input.wabaId}/message_templates`)
          );

      if (!nextUrl) {
        url.searchParams.set(
          'fields',
          'id,name,language,status,category,components'
        );
        url.searchParams.set('limit', '100');
        url.searchParams.set('access_token', input.accessToken);
      }

      const response: Response = await fetch(url);
      const payload: MetaMessageTemplatesResponse =
        await this.parseGraphResponse<MetaMessageTemplatesResponse>(response);

      for (const template of payload.data ?? []) {
        if (
          template.status !== 'APPROVED' ||
          !template.name ||
          !template.language
        ) {
          continue;
        }

        templates.push({
          id: template.id ?? null,
          name: template.name,
          language: template.language,
          status: 'APPROVED',
          category: template.category ?? null,
          components: template.components ?? [],
        });
      }

      nextUrl = payload.paging?.next ?? null;
      page += 1;
    } while (nextUrl && page < 50);

    return templates;
  }

  async sendTemplateMessage(input: {
    apiVersion: string;
    accessToken: string;
    phoneNumberId: string;
    to: string;
    templateName: string;
    language: string;
    components?: MetaWhatsappTemplateMessageComponent[];
  }): Promise<MetaWhatsappMessageSendResult> {
    const template: Record<string, unknown> = {
      name: input.templateName,
      language: {
        code: input.language,
      },
    };

    if (input.components?.length) {
      template.components = input.components;
    }

    return this.sendWhatsappMessage({
      apiVersion: input.apiVersion,
      accessToken: input.accessToken,
      phoneNumberId: input.phoneNumberId,
      body: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: input.to,
        type: 'template',
        template,
      },
    });
  }

  async markMessageAsRead(input: {
    apiVersion: string;
    accessToken: string;
    phoneNumberId: string;
    messageId: string;
  }): Promise<boolean> {
    const response = await fetch(
      this.graphUrl(input.apiVersion, `${input.phoneNumberId}/messages`),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: input.messageId,
        }),
      }
    );
    const payload =
      await this.parseGraphResponse<MetaSuccessResponse>(response);

    return payload.success ?? response.ok;
  }

  async sendTextMessage(input: {
    apiVersion: string;
    accessToken: string;
    phoneNumberId: string;
    to: string;
    message: string;
    contextMessageId?: string | null;
  }): Promise<MetaWhatsappMessageSendResult> {
    return this.sendWhatsappMessage({
      apiVersion: input.apiVersion,
      accessToken: input.accessToken,
      phoneNumberId: input.phoneNumberId,
      body: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: input.to,
        type: 'text',
        text: {
          preview_url: false,
          body: input.message,
        },
        ...this.messageContext(input.contextMessageId),
      },
    });
  }

  async uploadMediaFromUrl(input: {
    apiVersion: string;
    accessToken: string;
    phoneNumberId: string;
    url: string;
    filename?: string | null;
    mimetype?: string | null;
  }): Promise<string> {
    const downloaded = await downloadMediaBuffer(input.url);
    const mimetype =
      input.mimetype ?? downloaded.contentType ?? 'application/octet-stream';
    const filename =
      input.filename?.trim() ||
      downloaded.filename ||
      this.filenameFromUrl(input.url, mimetype);

    return this.uploadWhatsappMedia({
      apiVersion: input.apiVersion,
      accessToken: input.accessToken,
      phoneNumberId: input.phoneNumberId,
      buffer: downloaded.buffer,
      filename,
      mimetype,
    });
  }

  async uploadWhatsappMedia(input: {
    apiVersion: string;
    accessToken: string;
    phoneNumberId: string;
    buffer: Buffer;
    filename: string;
    mimetype: string;
  }): Promise<string> {
    const formData = new FormData();
    const file = new Blob([new Uint8Array(input.buffer)], {
      type: input.mimetype,
    });
    formData.set('messaging_product', 'whatsapp');
    formData.set('type', input.mimetype);
    formData.set('file', file, input.filename);

    const response = await fetch(
      this.graphUrl(input.apiVersion, `${input.phoneNumberId}/media`),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
        },
        body: formData,
      }
    );
    const payload =
      await this.parseGraphResponse<MetaWhatsappMediaUploadResponse>(response);

    if (!payload.id) {
      throw new Error('Meta Graph API did not return a media id');
    }

    return payload.id;
  }

  async sendImageMessage(input: {
    apiVersion: string;
    accessToken: string;
    phoneNumberId: string;
    to: string;
    mediaId: string;
    caption?: string | null;
    contextMessageId?: string | null;
  }): Promise<MetaWhatsappMessageSendResult> {
    return this.sendMediaMessage({
      ...input,
      type: 'image',
      media: this.mediaPayload(input.mediaId, input.caption),
    });
  }

  async sendVideoMessage(input: {
    apiVersion: string;
    accessToken: string;
    phoneNumberId: string;
    to: string;
    mediaId: string;
    caption?: string | null;
    contextMessageId?: string | null;
  }): Promise<MetaWhatsappMessageSendResult> {
    return this.sendMediaMessage({
      ...input,
      type: 'video',
      media: this.mediaPayload(input.mediaId, input.caption),
    });
  }

  async sendAudioMessage(input: {
    apiVersion: string;
    accessToken: string;
    phoneNumberId: string;
    to: string;
    mediaId: string;
    voice?: boolean | null;
    contextMessageId?: string | null;
  }): Promise<MetaWhatsappMessageSendResult> {
    const media = this.mediaPayload(input.mediaId);
    if (input.voice === true) {
      media.voice = true;
    }

    return this.sendMediaMessage({
      ...input,
      type: 'audio',
      media,
    });
  }

  async sendDocumentMessage(input: {
    apiVersion: string;
    accessToken: string;
    phoneNumberId: string;
    to: string;
    mediaId: string;
    caption?: string | null;
    filename?: string | null;
    contextMessageId?: string | null;
  }): Promise<MetaWhatsappMessageSendResult> {
    const media = this.mediaPayload(input.mediaId, input.caption);
    const filename = input.filename?.trim();
    if (filename) {
      media.filename = filename;
    }

    return this.sendMediaMessage({
      ...input,
      type: 'document',
      media,
    });
  }

  async sendStickerMessage(input: {
    apiVersion: string;
    accessToken: string;
    phoneNumberId: string;
    to: string;
    mediaId: string;
    contextMessageId?: string | null;
  }): Promise<MetaWhatsappMessageSendResult> {
    return this.sendMediaMessage({
      ...input,
      type: 'sticker',
      media: this.mediaPayload(input.mediaId),
    });
  }

  async sendLocationMessage(input: {
    apiVersion: string;
    accessToken: string;
    phoneNumberId: string;
    to: string;
    latitude: number;
    longitude: number;
    name?: string | null;
    address?: string | null;
    contextMessageId?: string | null;
  }): Promise<MetaWhatsappMessageSendResult> {
    const location: Record<string, unknown> = {
      latitude: input.latitude,
      longitude: input.longitude,
    };
    const name = input.name?.trim();
    const address = input.address?.trim();
    if (name) {
      location.name = name;
    }
    if (address) {
      location.address = address;
    }

    return this.sendWhatsappMessage({
      apiVersion: input.apiVersion,
      accessToken: input.accessToken,
      phoneNumberId: input.phoneNumberId,
      body: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: input.to,
        type: 'location',
        location,
        ...this.messageContext(input.contextMessageId),
      },
    });
  }

  async sendContactsMessage(input: {
    apiVersion: string;
    accessToken: string;
    phoneNumberId: string;
    to: string;
    contacts: MetaWhatsappContactMessage[];
    contextMessageId?: string | null;
  }): Promise<MetaWhatsappMessageSendResult> {
    return this.sendWhatsappMessage({
      apiVersion: input.apiVersion,
      accessToken: input.accessToken,
      phoneNumberId: input.phoneNumberId,
      body: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: input.to,
        type: 'contacts',
        contacts: input.contacts,
        ...this.messageContext(input.contextMessageId),
      },
    });
  }

  async sendReactionMessage(input: {
    apiVersion: string;
    accessToken: string;
    phoneNumberId: string;
    to: string;
    messageId: string;
    emoji: string;
  }): Promise<MetaWhatsappMessageSendResult> {
    return this.sendWhatsappMessage({
      apiVersion: input.apiVersion,
      accessToken: input.accessToken,
      phoneNumberId: input.phoneNumberId,
      body: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: input.to,
        type: 'reaction',
        reaction: {
          message_id: input.messageId,
          emoji: input.emoji,
        },
      },
    });
  }

  private async sendMediaMessage(input: {
    apiVersion: string;
    accessToken: string;
    phoneNumberId: string;
    to: string;
    type: Exclude<
      MetaWhatsappMessageType,
      'text' | 'template' | 'location' | 'contacts' | 'reaction'
    >;
    media: Record<string, unknown>;
    contextMessageId?: string | null;
  }): Promise<MetaWhatsappMessageSendResult> {
    return this.sendWhatsappMessage({
      apiVersion: input.apiVersion,
      accessToken: input.accessToken,
      phoneNumberId: input.phoneNumberId,
      body: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: input.to,
        type: input.type,
        [input.type]: input.media,
        ...this.messageContext(input.contextMessageId),
      },
    });
  }

  private mediaPayload(
    mediaId: string,
    caption?: string | null
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      id: mediaId,
    };
    const normalizedCaption = caption?.trim();
    if (normalizedCaption) {
      payload.caption = normalizedCaption;
    }

    return payload;
  }

  private messageContext(
    messageId?: string | null
  ): { context: { message_id: string } } | Record<string, never> {
    const normalized = messageId?.trim();
    if (!normalized) {
      return {};
    }

    return {
      context: {
        message_id: normalized,
      },
    };
  }

  private filenameFromUrl(url: string, mimetype: string): string {
    try {
      const pathname = new URL(url).pathname;
      const filename = pathname.split('/').filter(Boolean).pop();
      if (filename) {
        return decodeURIComponent(filename);
      }
    } catch {
      // Ignore malformed URLs and use a deterministic fallback below.
    }

    return `underchat-whatsapp-media-${Date.now()}.${this.extensionFromMime(mimetype)}`;
  }

  private async sendWhatsappMessage(input: {
    apiVersion: string;
    accessToken: string;
    phoneNumberId: string;
    body: Record<string, unknown>;
  }): Promise<MetaWhatsappMessageSendResult> {
    const response = await fetch(
      this.graphUrl(input.apiVersion, `${input.phoneNumberId}/messages`),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input.body),
      }
    );
    const payload =
      await this.parseGraphResponse<MetaWhatsappMessageSendResponse>(response);
    const message = payload.messages?.[0] ?? null;
    const contact = payload.contacts?.[0] ?? null;

    return {
      message_id: message?.id ?? null,
      contact_wa_id: contact?.wa_id ?? null,
      message_status: message?.message_status ?? null,
      raw: payload,
    };
  }

  async getMediaUrl(input: {
    apiVersion: string;
    accessToken: string;
    mediaId: string;
  }): Promise<MetaWhatsappMediaInfo> {
    const url = new URL(this.graphUrl(input.apiVersion, input.mediaId));
    url.searchParams.set('access_token', input.accessToken);

    const response = await fetch(url);
    const payload =
      await this.parseGraphResponse<MetaWhatsappMediaResponse>(response);

    if (!payload.url) {
      throw new Error('Meta Graph API did not return a media URL');
    }

    return {
      id: payload.id ?? input.mediaId,
      url: payload.url,
      mime_type: payload.mime_type ?? null,
      sha256: payload.sha256 ?? null,
      file_size: payload.file_size ?? null,
    };
  }

  async downloadMedia(input: {
    accessToken: string;
    url: string;
    filename?: string | null;
    mimetype?: string | null;
  }): Promise<MetaWhatsappDownloadedMedia> {
    const response = await fetch(input.url, {
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(
        `Meta media download failed: ${response.status} ${response.statusText}`
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mimetype =
      input.mimetype ??
      response.headers.get('content-type') ??
      'application/octet-stream';
    const filename =
      input.filename?.trim() ||
      `meta-whatsapp-media-${Date.now()}.${this.extensionFromMime(mimetype)}`;

    return {
      buffer,
      mimetype,
      filename,
      size: buffer.byteLength,
    };
  }

  private extensionFromMime(mimetype: string): string {
    const normalized = mimetype.split(';')[0].trim().toLowerCase();
    const extension = normalized.split('/')[1]?.replace(/[^a-z0-9.+-]/gu, '');
    if (!extension) {
      return 'bin';
    }

    if (extension === 'jpeg') {
      return 'jpg';
    }

    return extension;
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

  async subscribeWabaApp(input: {
    apiVersion: string;
    accessToken: string;
    wabaId: string;
  }): Promise<boolean> {
    const response = await fetch(
      this.graphUrl(input.apiVersion, `${input.wabaId}/subscribed_apps`),
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
