import type { Message } from '@wwebjs/whatsapp-web.js';
import type { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';
import type { IWwebjsPinEventData } from '@core/common/interfaces/IWwebjsPinEventData';
import { EMessageType } from '@core/common/enums/EMessageType';
import { wwebjsEnvironment } from '@core/config/environments';
import { normalizeJid } from '@core/common/functions/normalizeJid';

const E2E_ENCRYPT_NOTIFICATION_TEXT =
  'As mensagens e chamadas são protegidas com criptografia de ponta a ponta. Ninguém fora desta conversa, nem mesmo o WhatsApp, pode ler ou ouvi-las.';
const CIPHERTEXT_FANOUT_NOTIFICATION_TEXT =
  'Você recebeu uma mensagem, mas ela não pôde ser descriptografada neste dispositivo.\nIsso pode ocorrer por ser uma mensagem de anúncio ou por estar em processo de sincronização. Verifique no dispositivo principal.';
const UNSUPPORTED_INCOMING_MESSAGE_TEXT =
  'Mensagem recebida não suportada pelo provedor. Verifique no WhatsApp.';
const SYSTEM_MESSAGE_JID_ALIASES = new Set(['0@c.us', '0@s.whatsapp.net']);
const WWEBJS_BUTTON_TYPES = new Set([
  'button',
  'buttons',
  'buttons_message',
  'buttons_response',
  'button_response',
  'template_button_reply',
]);
const WWEBJS_LIST_TYPES = new Set(['list', 'list_message', 'list_response']);

function readBooleanEnv(key: string): boolean {
  const raw = process.env[key];
  if (!raw) {
    return false;
  }

  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function csvEnvIncludes(key: string, value: string): boolean {
  const raw = process.env[key];
  if (!raw?.trim()) {
    return true;
  }

  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return false;
  }

  return raw
    .split(',')
    .map((item) => item.trim())
    .some((item) => item === '*' || item === normalizedValue);
}

function shouldLogWwebjsIncomingRawDebug(): boolean {
  const enabled =
    readBooleanEnv('MESSAGE_DEBUG_ENABLED') ||
    readBooleanEnv('WWEBJS_INCOMING_DEBUG_RAW');

  return (
    enabled &&
    csvEnvIncludes(
      'MESSAGE_DEBUG_ACCOUNT_IDS',
      wwebjsEnvironment.wwebjsAccountId
    ) &&
    csvEnvIncludes('MESSAGE_DEBUG_WORKER_IDS', wwebjsEnvironment.wwebjsWorkerId)
  );
}

type WwebjsButtonPayloadButton = {
  id?: string;
  displayText: string;
  type?: string | number;
};

type WwebjsButtonPayload = {
  text?: string;
  footer?: string;
  header?: string;
  headerType?: string | number;
  buttons: WwebjsButtonPayloadButton[];
};

type WwebjsListPayloadRow = {
  id?: string;
  title: string;
  description?: string;
};

type WwebjsListPayloadSection = {
  id?: string;
  title?: string;
  rows: WwebjsListPayloadRow[];
};

type WwebjsListPayload = {
  text?: string;
  buttonText?: string;
  listType?: string | number;
  sections: WwebjsListPayloadSection[];
};

type WwebjsListResponsePayload = {
  id?: string;
  title: string;
  description?: string;
};

type WwebjsCtaUrlPayload = {
  body?: string;
  displayText: string;
  url: string;
  rawButton: Record<string, unknown>;
  rawInteractive?: Record<string, unknown>;
};

type WwebjsContent = NonNullable<IUpsertMessage['content']>;

interface WwebjsInteractiveResolutionInput {
  id: string;
  rawType: string;
  rawData?: Record<string, unknown>;
  fromMe: boolean;
  body: string;
  messageType: EMessageType | null;
}

interface WwebjsInteractiveResolution {
  body: string;
  messageType: EMessageType | null;
  buttonsContent?: WwebjsContent;
  buttonsResponseText?: string;
  listContent?: WwebjsContent;
  listResponse?: WwebjsListResponsePayload;
  ctaUrlContent?: WwebjsContent;
  ctaUrlPayload?: WwebjsCtaUrlPayload;
}

function getMessageId(msg: Message): string | undefined {
  if (!msg?.id) return undefined;
  if (
    typeof msg.id === 'object' &&
    msg.id !== null &&
    '_serialized' in msg.id
  ) {
    return (msg.id as { _serialized: string })._serialized;
  }
  return String(msg.id);
}

function getNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getSerializedIdLike(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return getNonEmptyString(value);
  }

  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const valueObject = value as Record<string, unknown>;
  return (
    getNonEmptyString(valueObject._serialized) ??
    getNonEmptyString(valueObject.id)
  );
}

function getMessageIdRemote(msg: Message): string | undefined {
  if (!msg?.id || typeof msg.id !== 'object' || msg.id === null) {
    return undefined;
  }

  const idObject = msg.id as {
    remoteJid?: unknown;
    remote?: unknown;
  };

  return (
    getSerializedIdLike(idObject.remoteJid) ??
    getSerializedIdLike(idObject.remote)
  );
}

function isSystemMessageJid(value: string): boolean {
  const raw = getNonEmptyString(value)?.toLowerCase();
  if (!raw) {
    return false;
  }

  const normalized = (normalizeJid(raw) ?? raw).toLowerCase();
  if (SYSTEM_MESSAGE_JID_ALIASES.has(normalized)) {
    return true;
  }

  const [user, domain] = normalized.split('@');
  if (!user || !domain) {
    return false;
  }

  return user === '0' && (domain === 'c.us' || domain === 's.whatsapp.net');
}

function mapWwebjsTypeToMessageType(
  type: string | undefined,
  rawData?: Record<string, unknown>
): EMessageType | null {
  const t = (type ?? 'chat').toLowerCase();
  const subType = getNonEmptyString(rawData?.subtype)?.toLowerCase();

  if (
    t === 'protocol' &&
    (subType === 'ephemeral_setting' || subType === 'ephemeral_sync_response')
  ) {
    return EMessageType.set_disappearing_messages;
  }

  if (t === 'ciphertext') {
    return EMessageType.system;
  }

  if (
    t === 'automated_greeting_message' ||
    t === 'interactive' ||
    t === 'native_flow' ||
    isButtonPayload(t, rawData) ||
    isListPayload(t, rawData)
  ) {
    return EMessageType.text;
  }
  if (t === 'chat') return EMessageType.text;
  if (t === 'image') return EMessageType.image;
  if (t === 'video') return EMessageType.video;
  if (t === 'ptv') return EMessageType.video_note;
  if (t === 'ptt' || t === 'audio') return EMessageType.audio;
  if (t === 'sticker') return EMessageType.sticker;
  if (t === 'document') return EMessageType.document;
  if (t === 'location') return EMessageType.location;
  if (t === 'contacts' || t === 'multi_vcard') return EMessageType.contacts;
  if (t === 'contact' || t === 'vcard') return EMessageType.contact_card;
  if (t === 'pin_message' || t === 'pinned_message') {
    return EMessageType.system;
  }
  if (t === 'e2e_notification') return EMessageType.system;
  return null;
}

function resolveE2ENotificationBody(
  rawType: string,
  rawSubType?: string
): string | undefined {
  if (rawType !== 'e2e_notification') {
    return undefined;
  }

  if (!rawSubType || rawSubType === 'encrypt') {
    return E2E_ENCRYPT_NOTIFICATION_TEXT;
  }

  return undefined;
}

function resolveCiphertextFallbackBody(rawType: string): string | undefined {
  if (rawType !== 'ciphertext') {
    return undefined;
  }

  return CIPHERTEXT_FANOUT_NOTIFICATION_TEXT;
}

function getNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function getBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function isLikelyBase64MediaPayload(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return false;
  if (normalized.startsWith('data:image/')) return true;
  if (normalized.length < 256) return false;
  if (!/^[A-Za-z0-9+/=]+$/.test(normalized)) return false;

  return (
    normalized.startsWith('iVBORw0KGgo') ||
    normalized.startsWith('/9j/') ||
    normalized.startsWith('R0lGOD') ||
    normalized.startsWith('UklGR')
  );
}

function getObjectRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function parseJsonRecord(value: unknown): Record<string, unknown> | undefined {
  const record = getObjectRecord(value);
  if (record) return record;

  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  try {
    return getObjectRecord(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function getNativeFlowBody(
  body: string,
  rawData?: Record<string, unknown>
): string | undefined {
  const interactiveMessage = getObjectRecord(rawData?.interactiveMessage);
  const interactiveBody = getObjectRecord(interactiveMessage?.body);
  const rawBody = getObjectRecord(rawData?.body);

  return (
    getNonEmptyString(interactiveBody?.text) ??
    getNonEmptyString(interactiveMessage?.body) ??
    getNonEmptyString(interactiveMessage?.text) ??
    getNonEmptyString(rawBody?.text) ??
    getNonEmptyString(rawData?.body) ??
    getNonEmptyString(body)
  );
}

function getCtaUrlPayload(
  body: string,
  rawData?: Record<string, unknown>
): WwebjsCtaUrlPayload | undefined {
  const interactiveMessage = getObjectRecord(rawData?.interactiveMessage);
  const nativeFlowSources = [
    getObjectRecord(interactiveMessage?.nativeFlowMessage),
    getObjectRecord(rawData?.nativeFlowMessage),
    getObjectRecord(rawData?.nativeFlow),
  ].filter((source): source is Record<string, unknown> => source !== undefined);
  const buttonArrays = [
    ...nativeFlowSources.map((source) => source.buttons),
    interactiveMessage?.buttons,
    rawData?.buttons,
  ];
  const rawButtons = buttonArrays.find(
    (value): value is unknown[] => Array.isArray(value) && value.length > 0
  );

  if (!rawButtons?.length) return undefined;

  for (const rawButton of rawButtons) {
    const button = getObjectRecord(rawButton);
    if (!button) continue;

    const name = getNonEmptyString(button.name)?.toLowerCase();
    if (name !== 'cta_url') continue;

    const params = parseJsonRecord(
      button.buttonParamsJson ??
        button.buttonParamsJSON ??
        button.paramsJson ??
        button.paramsJSON
    );
    const url = getNonEmptyString(params?.url);
    if (!url) continue;

    return {
      body: getNativeFlowBody(body, rawData),
      displayText:
        getNonEmptyString(params?.display_text) ??
        getNonEmptyString(params?.displayText) ??
        getNonEmptyString(params?.title) ??
        getNonEmptyString(params?.text) ??
        'Abrir link',
      url,
      rawButton: button,
      rawInteractive: interactiveMessage,
    };
  }

  return undefined;
}

function buildCtaUrlContent(payload: WwebjsCtaUrlPayload): WwebjsContent {
  const message = payload.body ?? payload.displayText;

  return {
    type: EMessageType.text,
    message,
    official: {
      provider: 'meta_whatsapp',
      type: 'interactive',
      display: {
        kind: 'cta_url',
        raw_type: 'cta_url',
        body: payload.body ?? null,
        action_label: payload.displayText,
        actions: [
          {
            type: 'cta_url',
            title: payload.displayText,
            url: payload.url,
          },
        ],
      },
      raw: {
        type: 'interactive',
        interactive: {
          body:
            payload.rawInteractive?.body ??
            (payload.body ? { text: payload.body } : undefined),
          nativeFlowMessage: {
            buttons: [payload.rawButton],
          },
        },
      },
    },
  };
}

function getButtonPayload(
  rawData?: Record<string, unknown>
): WwebjsButtonPayload | undefined {
  const buttonsMessage = getObjectRecord(rawData?.buttonsMessage);
  const interactiveMessage = getObjectRecord(rawData?.interactiveMessage);
  const source = buttonsMessage ?? rawData;
  if (!source) return undefined;

  const buttonArrays = [
    buttonsMessage?.buttons,
    rawData?.buttons,
    rawData?.dynamicReplyButtons,
    rawData?.replyButtons,
    rawData?.hydratedButtons,
    interactiveMessage?.buttons,
  ];
  const rawButtons = buttonArrays.find(Array.isArray) as unknown[] | undefined;
  if (!rawButtons?.length) return undefined;

  const buttons = rawButtons
    .map((item) => getObjectRecord(item))
    .filter((button): button is Record<string, unknown> => button !== undefined)
    .map((button): WwebjsButtonPayloadButton | null => {
      const textObject =
        getObjectRecord(button.buttonText) ??
        getObjectRecord(button.text) ??
        getObjectRecord(button.title);
      const displayText =
        getNonEmptyString(textObject?.displayText) ??
        getNonEmptyString(textObject?.text) ??
        getNonEmptyString(button.displayText) ??
        getNonEmptyString(button.text) ??
        getNonEmptyString(button.title);
      if (!displayText) return null;

      const payload: WwebjsButtonPayloadButton = { displayText };
      const id =
        getNonEmptyString(button.buttonId) ??
        getNonEmptyString(button.buttonID) ??
        getNonEmptyString(button.id);
      const type =
        getNonEmptyString(button.type) ??
        (typeof button.type === 'number' ? button.type : undefined);

      if (id) payload.id = id;
      if (type !== undefined) payload.type = type;

      return payload;
    })
    .filter((button): button is WwebjsButtonPayloadButton => button !== null);

  if (!buttons.length) return undefined;

  return {
    text:
      getNonEmptyString(source.contentText) ??
      getNonEmptyString(source.body) ??
      getNonEmptyString(source.text) ??
      getNonEmptyString(rawData?.body),
    footer:
      getNonEmptyString(source.footerText) ?? getNonEmptyString(source.footer),
    header:
      getNonEmptyString(source.headerText) ??
      getNonEmptyString(source.title) ??
      getNonEmptyString(source.header),
    headerType:
      getNonEmptyString(source.headerType) ??
      (typeof source.headerType === 'number' ? source.headerType : undefined),
    buttons,
  };
}

function isButtonPayload(
  rawType: string,
  rawData?: Record<string, unknown>
): boolean {
  return WWEBJS_BUTTON_TYPES.has(rawType) || Boolean(getButtonPayload(rawData));
}

function buildButtonContent(
  rawType: string,
  body: string,
  rawData?: Record<string, unknown>
): IUpsertMessage['content'] | undefined {
  const payload = getButtonPayload(rawData);
  if (!payload) return undefined;

  const text = payload.text ?? body;
  return {
    type: EMessageType.text,
    message: text,
    buttons: {
      text: text || null,
      footer: payload.footer ?? null,
      header: payload.header ?? null,
      header_type: payload.headerType ?? rawType,
      buttons: payload.buttons.map((button) => ({
        id: button.id ?? null,
        display_text: button.displayText,
        type: button.type ?? null,
      })),
    },
  };
}

function buildButtonsProtoMessage(
  payload: WwebjsButtonPayload,
  fallbackText?: string
): Record<string, unknown> {
  return {
    buttonsMessage: {
      contentText: payload.text ?? fallbackText,
      footerText: payload.footer ?? undefined,
      headerText: payload.header ?? undefined,
      headerType: payload.headerType ?? undefined,
      buttons: payload.buttons.map((button) => ({
        buttonId: button.id ?? undefined,
        buttonText: { displayText: button.displayText },
        type: button.type ?? undefined,
      })),
    },
  };
}

function buildCtaUrlProtoMessage(
  payload: WwebjsCtaUrlPayload
): Record<string, unknown> {
  const button = { ...payload.rawButton };
  if (!button.buttonParamsJson && !button.buttonParamsJSON) {
    button.buttonParamsJson = JSON.stringify({
      display_text: payload.displayText,
      url: payload.url,
    });
  }

  return {
    interactiveMessage: {
      body: payload.body ? { text: payload.body } : undefined,
      nativeFlowMessage: {
        buttons: [button],
      },
    },
  };
}

function getButtonsResponseText(
  rawData?: Record<string, unknown>
): string | undefined {
  const response = getObjectRecord(rawData?.buttonsResponseMessage) ?? rawData;
  return (
    getNonEmptyString(response?.selectedDisplayText) ??
    getNonEmptyString(response?.displayText) ??
    getNonEmptyString(response?.body) ??
    getNonEmptyString(response?.text) ??
    getNonEmptyString(response?.selectedButtonId) ??
    getNonEmptyString(response?.selectedButtonID)
  );
}

function getListRowTitle(row: Record<string, unknown>): string | undefined {
  return (
    getNonEmptyString(row.title) ??
    getNonEmptyString(row.name) ??
    getNonEmptyString(row.text) ??
    getNonEmptyString(row.displayText) ??
    getNonEmptyString(row.rowId) ??
    getNonEmptyString(row.rowID) ??
    getNonEmptyString(row.id)
  );
}

function getListPayload(
  rawData?: Record<string, unknown>
): WwebjsListPayload | undefined {
  const listMessage = getObjectRecord(rawData?.listMessage);
  const list = getObjectRecord(rawData?.list);
  const source = listMessage ?? list ?? rawData;
  if (!source) return undefined;

  const rawSections = Array.isArray(source.sections) ? source.sections : [];
  const sections = rawSections
    .map((item, index): WwebjsListPayloadSection | null => {
      const section = getObjectRecord(item);
      if (!section) return null;

      const rawRows = Array.isArray(section.rows) ? section.rows : [];
      const rows = rawRows
        .map((rawRow): WwebjsListPayloadRow | null => {
          const row = getObjectRecord(rawRow);
          if (!row) return null;

          const title = getListRowTitle(row);
          if (!title) return null;

          const payload: WwebjsListPayloadRow = { title };
          const id =
            getNonEmptyString(row.rowId) ??
            getNonEmptyString(row.rowID) ??
            getNonEmptyString(row.id);
          const description = getNonEmptyString(row.description);

          if (id) payload.id = id;
          if (description) payload.description = description;

          return payload;
        })
        .filter((row): row is WwebjsListPayloadRow => row !== null);

      if (!rows.length) return null;

      const payload: WwebjsListPayloadSection = { rows };
      const id =
        getNonEmptyString(section.id) ??
        getNonEmptyString(section.sectionId) ??
        `section-${index + 1}`;
      const title = getNonEmptyString(section.title);

      if (id) payload.id = id;
      if (title) payload.title = title;

      return payload;
    })
    .filter((section): section is WwebjsListPayloadSection => section !== null);

  if (!sections.length) return undefined;

  return {
    text:
      getNonEmptyString(source.description) ??
      getNonEmptyString(source.text) ??
      getNonEmptyString(source.body) ??
      getNonEmptyString(rawData?.body),
    buttonText:
      getNonEmptyString(source.buttonText) ??
      getNonEmptyString(source.button_text) ??
      getNonEmptyString(source.button),
    listType:
      getNonEmptyString(source.listType) ??
      (typeof source.listType === 'number' ? source.listType : undefined),
    sections,
  };
}

function getListResponsePayload(
  rawType: string,
  rawData?: Record<string, unknown>
): WwebjsListResponsePayload | undefined {
  const response =
    getObjectRecord(rawData?.listResponseMessage) ??
    getObjectRecord(rawData?.listResponse) ??
    (rawType === 'list_response' ? rawData : undefined);
  if (!response) return undefined;

  const singleSelectReply = getObjectRecord(response.singleSelectReply);
  const id =
    getNonEmptyString(singleSelectReply?.selectedRowId) ??
    getNonEmptyString(singleSelectReply?.selectedRowID) ??
    getNonEmptyString(singleSelectReply?.rowId) ??
    getNonEmptyString(singleSelectReply?.rowID) ??
    getNonEmptyString(response.selectedRowId) ??
    getNonEmptyString(response.selectedRowID) ??
    getNonEmptyString(response.rowId) ??
    getNonEmptyString(response.rowID) ??
    getNonEmptyString(response.id);
  const title =
    getNonEmptyString(response.title) ??
    getNonEmptyString(response.body)?.split('\n')[0]?.trim() ??
    getNonEmptyString(response.selectedDisplayText) ??
    id;
  const description =
    getNonEmptyString(response.description) ??
    getNonEmptyString(response.body)?.split('\n').slice(1).join('\n').trim();

  if (!title) return undefined;

  return {
    id,
    title,
    description: description || undefined,
  };
}

function isListPayload(
  rawType: string,
  rawData?: Record<string, unknown>
): boolean {
  return (
    WWEBJS_LIST_TYPES.has(rawType) ||
    Boolean(getListPayload(rawData)) ||
    Boolean(getListResponsePayload(rawType, rawData))
  );
}

function buildListContent(
  rawType: string,
  body: string,
  rawData?: Record<string, unknown>
): IUpsertMessage['content'] | undefined {
  const payload = getListPayload(rawData);
  if (!payload) return undefined;

  const text = payload.text ?? body;
  return {
    type: EMessageType.text,
    message: text,
    list: {
      text: text || null,
      button_text: payload.buttonText ?? null,
      list_type: payload.listType ?? rawType,
      sections: payload.sections.map((section) => ({
        id: section.id ?? null,
        title: section.title ?? null,
        rows: section.rows.map((row) => ({
          id: row.id ?? null,
          title: row.title,
          description: row.description ?? null,
        })),
      })),
    },
  };
}

function buildListProtoMessage(
  payload: WwebjsListPayload,
  fallbackText?: string
): Record<string, unknown> {
  return {
    listMessage: {
      description: payload.text ?? fallbackText,
      buttonText: payload.buttonText ?? undefined,
      listType: payload.listType ?? undefined,
      sections: payload.sections.map((section) => ({
        title: section.title ?? undefined,
        rows: section.rows.map((row) => ({
          rowId: row.id ?? undefined,
          title: row.title,
          description: row.description ?? undefined,
        })),
      })),
    },
  };
}

function buildListResponseProtoMessage(
  payload: WwebjsListResponsePayload
): Record<string, unknown> {
  return {
    listResponseMessage: {
      title: payload.title,
      description: payload.description,
      singleSelectReply: {
        selectedRowId: payload.id,
      },
    },
  };
}

function safeStringify(value: unknown, maxLength = 4000): string {
  try {
    const seen = new WeakSet<object>();
    const serialized = JSON.stringify(value, (_key, item) => {
      if (typeof item === 'object' && item !== null) {
        if (seen.has(item)) return '[Circular]';
        seen.add(item);
      }
      if (typeof item === 'function') return '[Function]';
      return item;
    });
    if (!serialized) return '';
    return serialized.length > maxLength
      ? `${serialized.slice(0, maxLength)}...`
      : serialized;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function logWwebjsIncomingDebug(payload: Record<string, unknown>): void {
  console.warn('[WWEBJS_INCOMING_DEBUG]', safeStringify(payload));
}

function getRawDataFieldNames(
  rawData: Record<string, unknown> | undefined
): string[] {
  return rawData ? Object.keys(rawData).sort() : [];
}

function hasRawDataRecord(
  rawData: Record<string, unknown> | undefined,
  key: string
): boolean {
  return Boolean(getObjectRecord(rawData?.[key]));
}

function logWwebjsIncomingSummary(payload: Record<string, unknown>): void {
  console.info('[WWEBJS_INCOMING_SUMMARY]', safeStringify(payload));
}

function resolveMessageBody(
  rawType: string,
  body: string,
  rawData?: Record<string, unknown>
): string {
  const ctaUrlBody = getCtaUrlPayload(body, rawData)?.body;
  if (ctaUrlBody) {
    return ctaUrlBody;
  }

  const listContentText =
    getListPayload(rawData)?.text ??
    getListResponsePayload(rawType, rawData)?.title;
  if (listContentText) {
    return listContentText;
  }

  const buttonContentText =
    getButtonPayload(rawData)?.text ?? getButtonsResponseText(rawData);
  if (buttonContentText) {
    return buttonContentText;
  }

  const ctwaContext = getObjectRecord(rawData?.ctwaContext);
  const caption = getNonEmptyString(rawData?.caption);
  const greetingMessageBody =
    getNonEmptyString(ctwaContext?.greetingMessageBody) ??
    getNonEmptyString(rawData?.greetingMessageBody);
  const isMediaType =
    rawType === 'image' || rawType === 'video' || rawType === 'ptv';

  if (!body) {
    return caption ?? greetingMessageBody ?? '';
  }

  if (isMediaType && caption && isLikelyBase64MediaPayload(body)) {
    return caption;
  }

  return body;
}

function resolveWwebjsInteractiveMessage({
  id,
  rawType,
  rawData,
  fromMe,
  body,
  messageType,
}: WwebjsInteractiveResolutionInput): WwebjsInteractiveResolution {
  let nextBody = body;
  let nextMessageType = messageType;
  const ctaUrlPayload = getCtaUrlPayload(body, rawData);
  const ctaUrlContent = ctaUrlPayload
    ? buildCtaUrlContent(ctaUrlPayload)
    : undefined;
  const isWwebjsButtonType = WWEBJS_BUTTON_TYPES.has(rawType);
  const buttonsContent =
    buildButtonContent(rawType, body, rawData) ?? undefined;
  const buttonsResponseText =
    isWwebjsButtonType || getObjectRecord(rawData?.buttonsResponseMessage)
      ? getButtonsResponseText(rawData)
      : undefined;
  const isWwebjsListType = WWEBJS_LIST_TYPES.has(rawType);
  const listContent = buildListContent(rawType, body, rawData) ?? undefined;
  const listResponse = getListResponsePayload(rawType, rawData);

  if (ctaUrlContent) {
    nextMessageType = EMessageType.text;
    nextBody = ctaUrlContent.message ?? body;
    logWwebjsIncomingDebug({
      stage: 'wwebjs.message_to_upsert.cta_url',
      id,
      raw_type: rawType,
      from_me: fromMe,
      mapped_type: nextMessageType,
      body: nextBody,
      raw_data: rawData,
    });
  }

  if (!ctaUrlContent && (buttonsContent || buttonsResponseText)) {
    nextMessageType = EMessageType.text;
    nextBody = buttonsContent?.message ?? buttonsResponseText ?? body;
    logWwebjsIncomingDebug({
      stage: 'wwebjs.message_to_upsert.buttons',
      id,
      raw_type: rawType,
      from_me: fromMe,
      mapped_type: nextMessageType,
      body: nextBody,
      raw_data: rawData,
    });
  } else if (isWwebjsButtonType) {
    logWwebjsIncomingDebug({
      stage: 'wwebjs.message_to_upsert.button_type_without_payload',
      id,
      raw_type: rawType,
      from_me: fromMe,
      mapped_type: nextMessageType,
      body: nextBody,
      raw_data: rawData,
    });
  }

  if (listContent || listResponse) {
    nextMessageType = EMessageType.text;
    nextBody = listContent?.message ?? listResponse?.title ?? nextBody;
    logWwebjsIncomingDebug({
      stage: 'wwebjs.message_to_upsert.list',
      id,
      raw_type: rawType,
      from_me: fromMe,
      mapped_type: nextMessageType,
      body: nextBody,
      raw_data: rawData,
    });
  } else if (isWwebjsListType) {
    logWwebjsIncomingDebug({
      stage: 'wwebjs.message_to_upsert.list_type_without_payload',
      id,
      raw_type: rawType,
      from_me: fromMe,
      mapped_type: nextMessageType,
      body: nextBody,
      raw_data: rawData,
    });
  }

  return {
    body: nextBody,
    messageType: nextMessageType,
    buttonsContent,
    buttonsResponseText,
    listContent,
    listResponse,
    ctaUrlContent,
    ctaUrlPayload,
  };
}

function getPinTypeValue(value: unknown): string | number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = Number(trimmed);
  if (Number.isFinite(parsed) && String(parsed) === trimmed) {
    return parsed;
  }

  return trimmed;
}

function isMediaAlbumAssociation(rawData?: Record<string, unknown>): boolean {
  const associationType = getNonEmptyString(rawData?.associationType)
    ?.toUpperCase()
    ?.trim();
  const viewMode = getNonEmptyString(rawData?.viewMode)?.toUpperCase()?.trim();

  return associationType === 'MEDIA_ALBUM' || viewMode === 'MEDIA_ALBUM';
}

function resolvePinType(
  rawType: string,
  rawData?: Record<string, unknown>,
  pinEventData?: IWwebjsPinEventData
): string | number | undefined {
  const candidates = [
    pinEventData?.pinType,
    rawData?.pinMessageType,
    rawData?.pinType,
    rawData?.pinActionType,
    rawData?.pinAction,
  ];

  for (const candidate of candidates) {
    const value = getPinTypeValue(candidate);
    if (value !== undefined) {
      return value;
    }
  }

  if (pinEventData?.isPinned === false) {
    return 'UNPIN';
  }
  if (pinEventData?.isPinned === true) {
    return 'PIN';
  }

  if (rawType === 'pinned_message') {
    return 'PIN';
  }

  return undefined;
}

function getSerializedId(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') {
    return getNonEmptyString(value);
  }
  if (typeof value !== 'object') return undefined;

  const objectValue = value as Record<string, unknown>;
  const directKeys = ['_serialized', 'id', 'stanzaId', 'stanzaID'];
  for (const key of directKeys) {
    const candidate = objectValue[key];
    if (typeof candidate === 'string') {
      const normalized = getNonEmptyString(candidate);
      if (normalized) return normalized;
    }
  }

  return undefined;
}

function resolvePinParentMessageId(
  rawData?: Record<string, unknown>,
  pinEventData?: IWwebjsPinEventData,
  options?: { allowParentMsgKey?: boolean }
): string | undefined {
  const allowParentMsgKey = options?.allowParentMsgKey ?? true;
  const candidates: unknown[] = [
    pinEventData?.parentMessageId,
    rawData?.pinParentKey,
    rawData?.targetMsgKey,
  ];

  if (allowParentMsgKey) {
    candidates.push(rawData?.parentMsgKey);
  }

  for (const candidate of candidates) {
    const serializedId = getSerializedId(candidate);
    if (serializedId) {
      return serializedId;
    }
  }

  return undefined;
}

function buildPinInChatMessage(
  rawType: string,
  rawData?: Record<string, unknown>,
  pinEventData?: IWwebjsPinEventData
): Record<string, unknown> | undefined {
  const isAlbumAssociation = isMediaAlbumAssociation(rawData);
  const hasExplicitPinSignals =
    rawType === 'pin_message' ||
    rawType === 'pinned_message' ||
    pinEventData !== undefined ||
    rawData?.pinMessageType !== undefined ||
    rawData?.pinType !== undefined ||
    rawData?.pinActionType !== undefined ||
    rawData?.pinAction !== undefined ||
    rawData?.pinParentKey !== undefined;

  if (!hasExplicitPinSignals) {
    return undefined;
  }

  const pinType = resolvePinType(rawType, rawData, pinEventData);
  const parentMessageId = resolvePinParentMessageId(rawData, pinEventData, {
    allowParentMsgKey: !isAlbumAssociation,
  });

  if (pinType === undefined && !parentMessageId) {
    return undefined;
  }

  const pinPayload: Record<string, unknown> = {};
  if (parentMessageId) {
    pinPayload.key = { id: parentMessageId };
  }
  if (pinType !== undefined) {
    pinPayload.type = pinType;
  }

  return pinPayload;
}

function getEphemeralExpiration(rawData?: Record<string, unknown>): number {
  const candidates = [
    rawData?.ephemeralDuration,
    rawData?.ephemeralExpiration,
    rawData?.disappearingMessagesInChat,
  ];

  for (const candidate of candidates) {
    const value = getNumber(candidate);
    if (value !== undefined) {
      return value > 0 ? value : 0;
    }
  }

  if (rawData?.disappearingMessagesInChat === false) {
    return 0;
  }

  return 0;
}

function buildDisappearingProtocolMessage(
  rawType: string,
  rawData?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (rawType !== 'protocol') {
    return undefined;
  }

  const subType = getNonEmptyString(rawData?.subtype)?.toLowerCase();
  if (
    subType !== 'ephemeral_setting' &&
    subType !== 'ephemeral_sync_response'
  ) {
    return undefined;
  }

  const expiration = getEphemeralExpiration(rawData);
  return {
    protocolMessage: {
      ephemeralExpiration: expiration,
    },
  };
}

function buildLocationMessage(
  msg: Message
): Record<string, unknown> | undefined {
  const raw = msg as unknown as {
    location?: {
      latitude?: unknown;
      longitude?: unknown;
      name?: unknown;
      address?: unknown;
      description?: unknown;
    };
    _data?: {
      lat?: unknown;
      lng?: unknown;
      loc?: unknown;
    };
  };
  const location = raw.location;
  const data = raw._data;

  const latitude = getNumber(location?.latitude) ?? getNumber(data?.lat);
  const longitude = getNumber(location?.longitude) ?? getNumber(data?.lng);
  const name =
    getNonEmptyString(location?.name) ?? getNonEmptyString(data?.loc);
  const address =
    getNonEmptyString(location?.address) ??
    getNonEmptyString(location?.description) ??
    getNonEmptyString(data?.loc);

  const locationMessage: Record<string, unknown> = {};
  if (latitude !== undefined) {
    locationMessage.degreesLatitude = latitude;
  }
  if (longitude !== undefined) {
    locationMessage.degreesLongitude = longitude;
  }
  if (name) {
    locationMessage.name = name;
  }
  if (address) {
    locationMessage.address = address;
  }

  return Object.keys(locationMessage).length > 0 ? locationMessage : undefined;
}

function getVcards(msg: Message): string[] {
  const raw = msg as unknown as { vCards?: unknown };
  if (!Array.isArray(raw.vCards)) return [];
  return raw.vCards.filter((value): value is string => {
    return typeof value === 'string' && value.trim().length > 0;
  });
}

function getVcardDisplayName(vcard: string): string | undefined {
  const lines = vcard.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('FN:')) {
      return getNonEmptyString(trimmed.slice(3));
    }
  }
  return undefined;
}

function buildContactPayload(
  msg: Message,
  rawType: string,
  body: string
): Record<string, unknown> | undefined {
  const isSingleContact = rawType === 'vcard' || rawType === 'contact';
  const isMultiContact = rawType === 'multi_vcard' || rawType === 'contacts';
  if (!isSingleContact && !isMultiContact) return undefined;

  const vcards = getVcards(msg);
  const bodyVcard = getNonEmptyString(body);
  const raw = msg as unknown as {
    _data?: { vcardFormattedName?: unknown };
  };
  const vcardFormattedName = getNonEmptyString(raw._data?.vcardFormattedName);

  if (isSingleContact) {
    const vcard = vcards[0] ?? bodyVcard;
    if (!vcard) return undefined;

    return {
      contactMessage: {
        vcard,
        displayName: vcardFormattedName ?? getVcardDisplayName(vcard),
      },
    };
  }

  const contactVcards =
    vcards.length > 0 ? vcards : bodyVcard ? [bodyVcard] : [];
  if (!contactVcards.length) return undefined;

  return {
    contactsArrayMessage: {
      contacts: contactVcards.map((vcard) => ({
        vcard,
        displayName: getVcardDisplayName(vcard),
      })),
    },
  };
}

function getDocumentCaption(msg: Message): string | undefined {
  const raw = msg as unknown as {
    _data?: {
      caption?: unknown;
      filename?: unknown;
      isCaptionByUser?: unknown;
    };
  };
  const caption = getNonEmptyString(raw._data?.caption);
  if (!caption) return undefined;

  const filename = getNonEmptyString(raw._data?.filename);
  const isCaptionByUser = raw._data?.isCaptionByUser;

  if (isCaptionByUser === true) {
    return caption;
  }
  if (isCaptionByUser === false) {
    return undefined;
  }

  if (filename && caption === filename) {
    return undefined;
  }

  return caption;
}

function getNotifyNameFromMessage(msg: Message): string | undefined {
  const raw = msg as unknown as {
    id?: {
      name?: unknown;
    };
    _data?: {
      notifyName?: unknown;
    };
  };
  return (
    getNonEmptyString(raw.id?.name) ?? getNonEmptyString(raw._data?.notifyName)
  );
}

function resolveGroupParticipant(
  msg: Message,
  remoteJid: string
): string | undefined {
  if (!remoteJid.endsWith('@g.us')) return undefined;

  const author = getNonEmptyString(
    (msg as unknown as { author?: unknown }).author
  );
  if (author) {
    const normalized = normalizeJid(author) ?? author;
    if (normalized !== remoteJid) return normalized;
  }

  const from = getNonEmptyString(msg.from);
  if (from) {
    const normalized = normalizeJid(from) ?? from;
    if (normalized !== remoteJid && !normalized.endsWith('@g.us')) {
      return normalized;
    }
  }

  return undefined;
}

function getRawMessageData(msg: Message): Record<string, unknown> | undefined {
  const rawData = (msg as unknown as { rawData?: unknown }).rawData;
  if (rawData && typeof rawData === 'object') {
    return rawData as Record<string, unknown>;
  }

  const data = (msg as unknown as { _data?: unknown })._data;
  if (data && typeof data === 'object') {
    return data as Record<string, unknown>;
  }

  return undefined;
}

function buildForwardedContextInfo(
  msg: Message
): Record<string, unknown> | undefined {
  const rawData = getRawMessageData(msg);

  const topIsForwarded = getBoolean(
    (msg as unknown as { isForwarded?: unknown }).isForwarded
  );
  const rawIsForwarded = getBoolean(rawData?.isForwarded);

  const topForwardingScore = getNumber(
    (msg as unknown as { forwardingScore?: unknown }).forwardingScore
  );
  const rawForwardingScore =
    getNumber(rawData?.forwardingScore) ?? getNumber(rawData?.forwardsCount);
  const forwardingScore = topForwardingScore ?? rawForwardingScore;
  const inferredForwardedByScore =
    forwardingScore !== undefined && forwardingScore > 0;
  const isForwarded = topIsForwarded ?? rawIsForwarded;

  if (isForwarded !== true && !inferredForwardedByScore) {
    return undefined;
  }

  const contextInfo: Record<string, unknown> = {
    isForwarded: true,
  };

  if (forwardingScore !== undefined) {
    contextInfo.forwardingScore = forwardingScore;
  }

  return contextInfo;
}

function getJsonString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const normalized = getNonEmptyString(value);
    return normalized;
  }

  if (!value || typeof value !== 'object') {
    return undefined;
  }

  try {
    const serialized = JSON.stringify(value);
    return getNonEmptyString(serialized);
  } catch {
    return undefined;
  }
}

function buildExternalAdReplyFromRawData(
  rawData?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!rawData) return undefined;

  const ctwaContext = getObjectRecord(rawData.ctwaContext);
  const interactiveHeader = getObjectRecord(rawData.interactiveHeader);
  const conversionData =
    getObjectRecord(ctwaContext?.conversionData) ??
    getObjectRecord(rawData.conversionData);

  const externalAdReply: Record<string, unknown> = {};

  const title =
    getNonEmptyString(ctwaContext?.title) ??
    getNonEmptyString(rawData.title) ??
    getNonEmptyString(interactiveHeader?.title);
  if (title) externalAdReply.title = title;

  const mediaType =
    getNumber(ctwaContext?.mediaType) ??
    getNumber(rawData.mediaType) ??
    getNumber(rawData.richPreviewType);
  if (mediaType !== undefined) externalAdReply.mediaType = mediaType;

  const thumbnailUrl =
    getNonEmptyString(ctwaContext?.originalImageUrl) ??
    getNonEmptyString(rawData.originalImageUrl) ??
    getNonEmptyString(ctwaContext?.thumbnailUrl) ??
    getNonEmptyString(rawData.thumbnailUrl) ??
    getNonEmptyString(interactiveHeader?.thumbnail);
  if (thumbnailUrl) externalAdReply.thumbnailUrl = thumbnailUrl;

  const sourceType =
    getNonEmptyString(ctwaContext?.sourceType) ??
    getNonEmptyString(rawData.sourceType);
  if (sourceType) externalAdReply.sourceType = sourceType;

  const sourceId =
    getNonEmptyString(ctwaContext?.sourceId) ??
    getNonEmptyString(rawData.sourceId);
  if (sourceId) externalAdReply.sourceId = sourceId;

  const sourceUrl =
    getNonEmptyString(ctwaContext?.sourceUrl) ??
    getNonEmptyString(rawData.sourceUrl);
  if (sourceUrl) externalAdReply.sourceUrl = sourceUrl;

  const containsAutoReply =
    getBoolean(ctwaContext?.containsAutoReply) ??
    getBoolean(rawData.containsAutoReply);
  if (containsAutoReply !== undefined) {
    externalAdReply.containsAutoReply = containsAutoReply;
  }

  const renderLargerThumbnail =
    getBoolean(ctwaContext?.renderLargerThumbnail) ??
    getBoolean(rawData.renderLargerThumbnail);
  if (renderLargerThumbnail !== undefined) {
    externalAdReply.renderLargerThumbnail = renderLargerThumbnail;
  }

  const showAdAttribution =
    getBoolean(ctwaContext?.showAdAttribution) ??
    getBoolean(rawData.showAdAttribution);
  if (showAdAttribution !== undefined) {
    externalAdReply.showAdAttribution = showAdAttribution;
  }

  const ctwaClid =
    getNonEmptyString(ctwaContext?.ctwaClid) ??
    getNonEmptyString(rawData.ctwaClid) ??
    getNonEmptyString(conversionData?.ctwaClid) ??
    getNonEmptyString(conversionData?.ctwa_clid) ??
    getNonEmptyString(conversionData?.clid);
  if (ctwaClid) externalAdReply.ctwaClid = ctwaClid;

  const clickToWhatsappCall =
    getBoolean(ctwaContext?.clickToWhatsappCall) ??
    getBoolean(rawData.clickToWhatsappCall);
  if (clickToWhatsappCall !== undefined) {
    externalAdReply.clickToWhatsappCall = clickToWhatsappCall;
  }

  const adContextPreviewDismissed =
    getBoolean(ctwaContext?.adContextPreviewDismissed) ??
    getBoolean(rawData.adContextPreviewDismissed);
  if (adContextPreviewDismissed !== undefined) {
    externalAdReply.adContextPreviewDismissed = adContextPreviewDismissed;
  }

  const sourceApp =
    getNonEmptyString(ctwaContext?.sourceApp) ??
    getNonEmptyString(rawData.sourceApp);
  if (sourceApp) externalAdReply.sourceApp = sourceApp;

  const automatedGreetingMessageShown =
    getBoolean(ctwaContext?.automatedGreetingMessageShown) ??
    getBoolean(rawData.automatedGreetingMessageShown);
  if (automatedGreetingMessageShown !== undefined) {
    externalAdReply.automatedGreetingMessageShown =
      automatedGreetingMessageShown;
  }

  const greetingMessageBody =
    getNonEmptyString(ctwaContext?.greetingMessageBody) ??
    getNonEmptyString(rawData.greetingMessageBody) ??
    getNonEmptyString(ctwaContext?.description) ??
    getNonEmptyString(rawData.description);
  if (greetingMessageBody) {
    externalAdReply.greetingMessageBody = greetingMessageBody;
  }

  const disableNudge =
    getBoolean(ctwaContext?.disableNudge) ?? getBoolean(rawData.disableNudge);
  if (disableNudge !== undefined) externalAdReply.disableNudge = disableNudge;

  const originalImageUrl =
    getNonEmptyString(ctwaContext?.originalImageUrl) ??
    getNonEmptyString(rawData.originalImageUrl);
  if (originalImageUrl) externalAdReply.originalImageUrl = originalImageUrl;

  const wtwaAdFormat =
    getBoolean(ctwaContext?.wtwaAdFormat) ?? getBoolean(rawData.wtwaAdFormat);
  if (wtwaAdFormat !== undefined) externalAdReply.wtwaAdFormat = wtwaAdFormat;

  return Object.keys(externalAdReply).length > 0 ? externalAdReply : undefined;
}

function buildAdsContextInfoFromRawData(
  rawData?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!rawData) return undefined;

  const ctwaContext = getObjectRecord(rawData.ctwaContext);
  const conversionData =
    getObjectRecord(ctwaContext?.conversionData) ??
    getObjectRecord(rawData.conversionData);

  const contextInfo: Record<string, unknown> = {};

  const conversionSource =
    getNonEmptyString(ctwaContext?.conversionSource) ??
    getNonEmptyString(rawData.conversionSource);
  if (conversionSource) contextInfo.conversionSource = conversionSource;

  const conversionDelaySeconds =
    getNumber(ctwaContext?.conversionDelaySeconds) ??
    getNumber(rawData.conversionDelaySeconds);
  if (conversionDelaySeconds !== undefined) {
    contextInfo.conversionDelaySeconds = conversionDelaySeconds;
  }

  const entryPointConversionSource =
    getNonEmptyString(ctwaContext?.entryPointConversionSource) ??
    getNonEmptyString(rawData.entryPointConversionSource);
  if (entryPointConversionSource) {
    contextInfo.entryPointConversionSource = entryPointConversionSource;
  }

  const entryPointConversionApp =
    getNonEmptyString(ctwaContext?.entryPointConversionApp) ??
    getNonEmptyString(rawData.entryPointConversionApp);
  if (entryPointConversionApp) {
    contextInfo.entryPointConversionApp = entryPointConversionApp;
  }

  const entryPointConversionDelaySeconds =
    getNumber(ctwaContext?.entryPointConversionDelaySeconds) ??
    getNumber(rawData.entryPointConversionDelaySeconds);
  if (entryPointConversionDelaySeconds !== undefined) {
    contextInfo.entryPointConversionDelaySeconds =
      entryPointConversionDelaySeconds;
  }

  const trustBannerAction =
    getNumber(ctwaContext?.trustBannerAction) ??
    getNumber(rawData.trustBannerAction);
  if (trustBannerAction !== undefined) {
    contextInfo.trustBannerAction = trustBannerAction;
  }

  const ctwaSignals =
    getNonEmptyString(ctwaContext?.ctwaSignals) ??
    getNonEmptyString(rawData.ctwaSignals) ??
    getJsonString(conversionData);
  if (ctwaSignals) {
    contextInfo.ctwaSignals = ctwaSignals;
  }

  const externalAdReply = buildExternalAdReplyFromRawData(rawData);
  if (externalAdReply) {
    contextInfo.externalAdReply = externalAdReply;
  }

  return Object.keys(contextInfo).length > 0 ? contextInfo : undefined;
}

function buildExtendedTextPreviewFromRawData(
  rawData?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!rawData) return undefined;

  const ctwaContext = getObjectRecord(rawData.ctwaContext);
  const extendedTextPreview: Record<string, unknown> = {};

  const matchedText =
    getNonEmptyString(rawData.matchedText) ??
    getNonEmptyString(ctwaContext?.sourceUrl) ??
    getNonEmptyString(rawData.sourceUrl);
  if (matchedText) {
    extendedTextPreview.matchedText = matchedText;
  }

  const title =
    getNonEmptyString(rawData.title) ?? getNonEmptyString(ctwaContext?.title);
  if (title) {
    extendedTextPreview.title = title;
  }

  const description =
    getNonEmptyString(rawData.description) ??
    getNonEmptyString(ctwaContext?.description);
  if (description) {
    extendedTextPreview.description = description;
  }

  const originalThumbnailUrl =
    getNonEmptyString(ctwaContext?.originalImageUrl) ??
    getNonEmptyString(rawData.originalImageUrl) ??
    getNonEmptyString(ctwaContext?.thumbnailUrl) ??
    getNonEmptyString(rawData.thumbnailUrl);
  if (originalThumbnailUrl) {
    extendedTextPreview.originalThumbnailUrl = originalThumbnailUrl;
  }

  if (!originalThumbnailUrl) {
    const jpegThumbnail =
      getNonEmptyString(rawData.thumbnail) ??
      getNonEmptyString(ctwaContext?.thumbnail);
    if (jpegThumbnail) {
      extendedTextPreview.jpegThumbnail = jpegThumbnail;
    }
  }

  const previewType =
    getNumber(rawData.previewType) ?? getNumber(rawData.richPreviewType);
  if (previewType !== undefined) {
    extendedTextPreview.previewType = previewType;
  }

  return Object.keys(extendedTextPreview).length > 0
    ? extendedTextPreview
    : undefined;
}

function mergeContextInfo(
  quoted?: Record<string, unknown>,
  forwarded?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!quoted && !forwarded) {
    return undefined;
  }

  return {
    ...(quoted ?? {}),
    ...(forwarded ?? {}),
  };
}

function getContextInfoTargetKey(
  rawType: string,
  messageType: EMessageType,
  innerMessage: Record<string, unknown>
): string | undefined {
  if (
    messageType === EMessageType.text ||
    messageType === EMessageType.system ||
    messageType === EMessageType.annotation
  ) {
    return 'extendedTextMessage';
  }

  const keyByRawType: Record<string, string> = {
    image: 'imageMessage',
    video: 'videoMessage',
    ptv: 'ptvMessage',
    ptt: 'audioMessage',
    audio: 'audioMessage',
    document: 'documentMessage',
    sticker: 'stickerMessage',
    location: 'locationMessage',
    vcard: 'contactMessage',
    contact: 'contactMessage',
    multi_vcard: 'contactsArrayMessage',
    contacts: 'contactsArrayMessage',
  };

  if (keyByRawType[rawType]) {
    return keyByRawType[rawType];
  }

  const knownContextKeys = [
    'extendedTextMessage',
    'imageMessage',
    'videoMessage',
    'ptvMessage',
    'documentMessage',
    'audioMessage',
    'stickerMessage',
    'locationMessage',
    'contactMessage',
    'contactsArrayMessage',
  ];

  for (const key of knownContextKeys) {
    if (getObjectRecord(innerMessage[key])) {
      return key;
    }
  }

  return undefined;
}

function attachContextInfo(
  innerMessage: Record<string, unknown>,
  contextInfo: Record<string, unknown>,
  rawType: string,
  messageType: EMessageType
): void {
  const targetKey = getContextInfoTargetKey(rawType, messageType, innerMessage);
  if (!targetKey) {
    return;
  }

  const currentTarget = getObjectRecord(innerMessage[targetKey]) ?? {};
  const currentContext = getObjectRecord(currentTarget.contextInfo) ?? {};

  innerMessage[targetKey] = {
    ...currentTarget,
    contextInfo: {
      ...currentContext,
      ...contextInfo,
    },
  };
}

function getQuotedIdFromRaw(raw?: Record<string, unknown>): string | undefined {
  if (!raw) return undefined;

  const directKeys = [
    'quotedStanzaID',
    'quotedStanzaId',
    'quotedMsgId',
    'quotedMsgID',
    'quotedMessageId',
    'quotedMessageID',
  ];
  for (const key of directKeys) {
    const quotedId = getSerializedId(raw[key]);
    if (quotedId) return quotedId;
  }

  const keyLikeKeys = [
    'quotedMsgKey',
    'quotedMessageKey',
    'quotedParentMsgKey',
    'quotedMsg',
    'quotedMessage',
  ];
  for (const key of keyLikeKeys) {
    const keyLike = raw[key];
    const quotedId = getSerializedId(keyLike);
    if (quotedId) return quotedId;

    if (keyLike && typeof keyLike === 'object') {
      const nestedId = getSerializedId((keyLike as Record<string, unknown>).id);
      if (nestedId) return nestedId;
    }
  }

  return undefined;
}

function getQuotedParticipantFromRaw(
  raw?: Record<string, unknown>
): string | undefined {
  if (!raw) return undefined;

  const candidateKeys = [
    'quotedParticipant',
    'quotedParticipantId',
    'quotedAuthor',
  ];
  for (const key of candidateKeys) {
    const participant =
      getSerializedId(raw[key]) ?? getNonEmptyString(raw[key]);
    if (!participant) continue;
    const normalized = normalizeJid(participant) ?? participant;
    if (!normalized.endsWith('@g.us')) {
      return normalized;
    }
  }

  return undefined;
}

function resolveQuotedParticipant(msg: Message): string | undefined {
  const author = getNonEmptyString(
    (msg as unknown as { author?: unknown }).author
  );
  if (author) {
    return normalizeJid(author) ?? author;
  }

  const from = getNonEmptyString(msg.from);
  if (from && !from.endsWith('@g.us')) {
    return normalizeJid(from) ?? from;
  }

  return undefined;
}

function buildQuotedProtoMessage(
  quoted: Message
): Record<string, unknown> | undefined {
  const rawType = (quoted.type ?? 'chat').toLowerCase();
  const body = typeof quoted.body === 'string' ? quoted.body : '';
  const raw = quoted as unknown as {
    _data?: {
      mimetype?: unknown;
      filename?: unknown;
      duration?: unknown;
      seconds?: unknown;
      isAnimated?: unknown;
      width?: unknown;
      height?: unknown;
    };
  };
  const rawData = raw._data;
  const buttonPayload = getButtonPayload(
    rawData as Record<string, unknown> | undefined
  );
  const listPayload = getListPayload(
    rawData as Record<string, unknown> | undefined
  );

  if (buttonPayload) {
    return buildButtonsProtoMessage(buttonPayload, body);
  }

  if (listPayload) {
    return buildListProtoMessage(listPayload, body);
  }

  if (rawType === 'chat') {
    return {
      conversation: body,
      extendedTextMessage: { text: body },
    };
  }

  if (rawType === 'image') {
    return {
      imageMessage: {
        caption: body || undefined,
        mimetype: getNonEmptyString(rawData?.mimetype),
        width: getNumber(rawData?.width),
        height: getNumber(rawData?.height),
      },
    };
  }

  if (rawType === 'video') {
    return {
      videoMessage: {
        caption: body || undefined,
        mimetype: getNonEmptyString(rawData?.mimetype),
        seconds: getNumber(rawData?.seconds) ?? getNumber(rawData?.duration),
        width: getNumber(rawData?.width),
        height: getNumber(rawData?.height),
      },
    };
  }

  if (rawType === 'ptv') {
    return {
      ptvMessage: {
        caption: body || undefined,
        mimetype: getNonEmptyString(rawData?.mimetype),
        seconds: getNumber(rawData?.seconds) ?? getNumber(rawData?.duration),
        width: getNumber(rawData?.width),
        height: getNumber(rawData?.height),
      },
    };
  }

  if (rawType === 'ptt') {
    return {
      audioMessage: {
        ptt: true,
        mimetype: getNonEmptyString(rawData?.mimetype),
        seconds: getNumber(rawData?.seconds) ?? getNumber(rawData?.duration),
      },
    };
  }

  if (rawType === 'audio') {
    return {
      audioMessage: {
        ptt: false,
        mimetype: getNonEmptyString(rawData?.mimetype),
        seconds: getNumber(rawData?.seconds) ?? getNumber(rawData?.duration),
      },
    };
  }

  if (rawType === 'sticker') {
    return {
      stickerMessage: {
        mimetype: getNonEmptyString(rawData?.mimetype),
        isAnimated: getBoolean(rawData?.isAnimated),
        width: getNumber(rawData?.width),
        height: getNumber(rawData?.height),
      },
    };
  }

  if (rawType === 'document') {
    const caption = getDocumentCaption(quoted);
    return {
      documentMessage: {
        caption: caption || undefined,
        fileName: getNonEmptyString(rawData?.filename),
        mimetype: getNonEmptyString(rawData?.mimetype),
      },
    };
  }

  if (rawType === 'location') {
    const locationMessage = buildLocationMessage(quoted);
    if (!locationMessage) return undefined;
    return { locationMessage };
  }

  if (
    rawType === 'vcard' ||
    rawType === 'contact' ||
    rawType === 'multi_vcard' ||
    rawType === 'contacts'
  ) {
    const contactPayload = buildContactPayload(quoted, rawType, body) as
      | {
          contactMessage?: Record<string, unknown>;
          contactsArrayMessage?: { contacts?: Array<Record<string, unknown>> };
        }
      | undefined;
    const singleContact = contactPayload?.contactMessage;
    if (singleContact) {
      return { contactMessage: singleContact };
    }

    const firstContact = contactPayload?.contactsArrayMessage?.contacts?.[0];
    if (firstContact?.vcard) {
      return {
        contactMessage: {
          vcard: firstContact.vcard,
          displayName: firstContact.displayName,
        },
      };
    }
  }

  if (body) {
    return {
      conversation: body,
      extendedTextMessage: { text: body },
    };
  }

  return undefined;
}

function buildQuotedProtoMessageFromRaw(
  raw: Record<string, unknown>
): Record<string, unknown> | undefined {
  const rawType =
    getNonEmptyString(raw.type)?.toLowerCase() ??
    getNonEmptyString(raw.kind)?.toLowerCase() ??
    'chat';
  const body =
    getNonEmptyString(raw.body) ??
    getNonEmptyString(raw.caption) ??
    getNonEmptyString(raw.contentText) ??
    getNonEmptyString(raw.description) ??
    '';
  const buttonPayload = getButtonPayload(raw);
  const listPayload = getListPayload(raw);

  if (buttonPayload) {
    return buildButtonsProtoMessage(buttonPayload, body);
  }

  if (listPayload) {
    return buildListProtoMessage(listPayload, body);
  }

  if (rawType === 'chat' && body) {
    return {
      conversation: body,
      extendedTextMessage: { text: body },
    };
  }

  return undefined;
}

async function buildQuotedContextInfo(
  msg: Message
): Promise<Record<string, unknown> | undefined> {
  const rawData = getRawMessageData(msg);
  const rawQuotedId = getQuotedIdFromRaw(rawData);
  const rawParticipant = getQuotedParticipantFromRaw(rawData);
  const rawQuotedMessage =
    getObjectRecord(rawData?.quotedMsg) ??
    getObjectRecord(rawData?.quotedMessage);

  if (!msg.hasQuotedMsg && !rawQuotedId && !rawQuotedMessage) {
    return undefined;
  }

  try {
    const quoted = await msg.getQuotedMessage();
    if (quoted) {
      const stanzaId = getMessageId(quoted) ?? rawQuotedId;
      if (!stanzaId) return undefined;

      const quotedMessage = buildQuotedProtoMessage(quoted) ?? {};
      const participant = resolveQuotedParticipant(quoted) ?? rawParticipant;
      const contextInfo: Record<string, unknown> = {
        stanzaId,
        quotedMessage,
      };

      if (participant) {
        contextInfo.participant = participant;
      }

      return contextInfo;
    }
  } catch {}

  if (!rawQuotedId) return undefined;

  const contextInfo: Record<string, unknown> = {
    stanzaId: rawQuotedId,
    quotedMessage: rawQuotedMessage
      ? (buildQuotedProtoMessageFromRaw(rawQuotedMessage) ?? {})
      : {},
  };

  if (rawParticipant) {
    contextInfo.participant = rawParticipant;
  }

  return contextInfo;
}

interface WwebjsResolvedJids {
  remoteJid?: string;
  remoteJidAlt?: string;
}

export async function wwebjsMessageToUpsert(
  msg: Message,
  resolvedJids?: WwebjsResolvedJids,
  pushName?: string,
  pinEventData?: IWwebjsPinEventData
): Promise<IUpsertMessage | null> {
  if (!msg?.id) return null;

  const id = getMessageId(msg);
  if (!id) return null;

  const fallbackRemoteJidRaw =
    getMessageIdRemote(msg) ??
    (msg.fromMe ? msg.to || msg.from || '' : msg.from || msg.to || '');
  const fallbackRemoteJid =
    normalizeJid(fallbackRemoteJidRaw) ?? fallbackRemoteJidRaw;
  const remoteJid = resolvedJids?.remoteJid ?? fallbackRemoteJid;
  if (!remoteJid) return null;
  const remoteJidAlt = resolvedJids?.remoteJidAlt;
  const normalizedRemoteJid = (
    normalizeJid(remoteJid) ?? remoteJid
  ).toLowerCase();

  if (
    isSystemMessageJid(normalizedRemoteJid) ||
    normalizedRemoteJid === 'status@broadcast' ||
    normalizedRemoteJid.endsWith('@broadcast') ||
    normalizedRemoteJid.endsWith('@g.us') ||
    normalizedRemoteJid.endsWith('@newsletter')
  ) {
    return null;
  }

  const rawType = (msg.type ?? 'chat').toLowerCase();
  if (rawType === 'notification_template' || rawType === 'e2e_notification') {
    return null;
  }
  const rawData = getRawMessageData(msg);
  const ack = getNumber(msg.ack) ?? getNumber(rawData?.ack);
  const rawSubType = getNonEmptyString(rawData?.subtype)?.toLowerCase();
  const rawBody = typeof msg.body === 'string' ? msg.body : '';
  logWwebjsIncomingSummary({
    stage: 'wwebjs.message_to_upsert.received',
    worker_id: wwebjsEnvironment.wwebjsWorkerId,
    account_id: wwebjsEnvironment.wwebjsAccountId,
    id,
    raw_type: rawType,
    raw_subtype: rawSubType ?? null,
    from_me: msg.fromMe,
    from: msg.from ?? null,
    to: msg.to ?? null,
    author: msg.author ?? null,
    body_preview: rawBody.trim().slice(0, 500) || null,
    raw_data_fields: getRawDataFieldNames(rawData),
    has_interactive_message: hasRawDataRecord(rawData, 'interactiveMessage'),
    has_native_flow_message: hasRawDataRecord(rawData, 'nativeFlowMessage'),
    has_native_flow: hasRawDataRecord(rawData, 'nativeFlow'),
    has_buttons_message: hasRawDataRecord(rawData, 'buttonsMessage'),
    has_buttons_response_message: hasRawDataRecord(
      rawData,
      'buttonsResponseMessage'
    ),
  });
  if (shouldLogWwebjsIncomingRawDebug()) {
    logWwebjsIncomingDebug({
      stage: 'wwebjs.message_to_upsert.received_raw',
      worker_id: wwebjsEnvironment.wwebjsWorkerId,
      account_id: wwebjsEnvironment.wwebjsAccountId,
      id,
      raw_type: rawType,
      raw_subtype: rawSubType ?? null,
      from_me: msg.fromMe,
      body: rawBody,
      raw_data: rawData,
    });
  }
  let body = resolveMessageBody(rawType, rawBody, rawData);
  let messageType = mapWwebjsTypeToMessageType(rawType, rawData);
  const interactiveResolution = resolveWwebjsInteractiveMessage({
    id,
    rawType,
    rawData,
    fromMe: msg.fromMe,
    body,
    messageType,
  });
  body = interactiveResolution.body;
  messageType = interactiveResolution.messageType;
  const {
    buttonsContent,
    buttonsResponseText,
    listContent,
    listResponse,
    ctaUrlContent,
    ctaUrlPayload,
  } = interactiveResolution;
  const pinInChatMessage = buildPinInChatMessage(
    rawType,
    rawData,
    pinEventData
  );
  const disappearingProtocolMessage = buildDisappearingProtocolMessage(
    rawType,
    rawData
  );
  if (pinInChatMessage) {
    messageType = EMessageType.system;
  }
  if (disappearingProtocolMessage) {
    messageType = EMessageType.set_disappearing_messages;
  }
  const unsupportedFallback = !messageType;
  if (!messageType) {
    logWwebjsIncomingDebug({
      stage: 'wwebjs.message_to_upsert.unknown_message_type',
      id,
      raw_type: rawType,
      raw_subtype: rawSubType,
      from_me: msg.fromMe,
      body,
      raw_data: rawData,
    });
    messageType = EMessageType.system;
    body = body || UNSUPPORTED_INCOMING_MESSAGE_TEXT;
  }
  const isViewOnceUnavailableFanout =
    rawType === 'ciphertext' &&
    (rawSubType === 'view_once_unavailable_fanout' ||
      rawSubType?.startsWith('view_once_unavailable_'));
  const isViewOnce =
    rawType !== 'ciphertext' &&
    ((msg as { isViewOnce?: boolean }).isViewOnce === true ||
      isViewOnceUnavailableFanout ||
      messageType === EMessageType.view_once);
  if (isViewOnce) {
    messageType = EMessageType.view_once;
  }

  if (!body) {
    const e2eNotificationBody = resolveE2ENotificationBody(rawType, rawSubType);
    if (e2eNotificationBody) {
      body = e2eNotificationBody;
    }
  }
  if (!body) {
    const ciphertextFallbackBody = resolveCiphertextFallbackBody(rawType);
    if (ciphertextFallbackBody) {
      body = ciphertextFallbackBody;
    }
  }

  const innerMessage: Record<string, unknown> = {};
  if (messageType === EMessageType.text && body) {
    const extendedTextPreview = buildExtendedTextPreviewFromRawData(rawData);
    innerMessage.conversation = body;
    innerMessage.extendedTextMessage = {
      text: body,
      ...(extendedTextPreview ?? {}),
    };
  }
  if (messageType === EMessageType.system && body) {
    innerMessage.conversation = body;
    innerMessage.extendedTextMessage = {
      text: body,
    };
  }
  if (rawType === 'document') {
    const caption = getDocumentCaption(msg);
    if (caption) {
      innerMessage.documentMessage = { caption };
    }
  }
  if (rawType === 'location') {
    const locationMessage = buildLocationMessage(msg);
    if (locationMessage) {
      innerMessage.locationMessage = locationMessage;
    }
  }
  const contactPayload = buildContactPayload(msg, rawType, rawBody);
  if (contactPayload) {
    Object.assign(innerMessage, contactPayload);
  }
  if (pinInChatMessage) {
    innerMessage.pinInChatMessage = pinInChatMessage;
  }
  if (disappearingProtocolMessage) {
    Object.assign(innerMessage, disappearingProtocolMessage);
  }
  if (buttonsContent?.buttons) {
    Object.assign(
      innerMessage,
      buildButtonsProtoMessage(
        {
          text: buttonsContent.buttons.text ?? undefined,
          footer: buttonsContent.buttons.footer ?? undefined,
          header: buttonsContent.buttons.header ?? undefined,
          headerType: buttonsContent.buttons.header_type ?? undefined,
          buttons: buttonsContent.buttons.buttons.map((button) => ({
            id: button.id ?? undefined,
            displayText: button.display_text,
            type: button.type ?? undefined,
          })),
        },
        body
      )
    );
  }
  if (buttonsResponseText) {
    innerMessage.buttonsResponseMessage = {
      selectedDisplayText: buttonsResponseText,
    };
  }
  if (ctaUrlPayload) {
    Object.assign(innerMessage, buildCtaUrlProtoMessage(ctaUrlPayload));
  }
  if (listContent?.list) {
    Object.assign(
      innerMessage,
      buildListProtoMessage(
        {
          text: listContent.list.text ?? undefined,
          buttonText: listContent.list.button_text ?? undefined,
          listType: listContent.list.list_type ?? undefined,
          sections: listContent.list.sections.map((section) => ({
            id: section.id ?? undefined,
            title: section.title ?? undefined,
            rows: section.rows.map((row) => ({
              id: row.id ?? undefined,
              title: row.title,
              description: row.description ?? undefined,
            })),
          })),
        },
        body
      )
    );
  }
  if (listResponse) {
    Object.assign(innerMessage, buildListResponseProtoMessage(listResponse));
  }

  const quotedContextInfo = await buildQuotedContextInfo(msg);
  const forwardedContextInfo = buildForwardedContextInfo(msg);
  const adsContextInfo = buildAdsContextInfoFromRawData(rawData);
  const contextInfo = mergeContextInfo(
    mergeContextInfo(quotedContextInfo, forwardedContextInfo),
    adsContextInfo
  );
  if (contextInfo) {
    attachContextInfo(innerMessage, contextInfo, rawType, messageType);
  }

  if (
    Object.keys(innerMessage).length === 0 &&
    body &&
    rawType !== 'location' &&
    rawType !== 'document' &&
    rawType !== 'vcard' &&
    rawType !== 'contact' &&
    rawType !== 'multi_vcard' &&
    rawType !== 'contacts'
  ) {
    innerMessage.conversation = body;
  }

  const resolvedPushName =
    pushName ?? (msg.fromMe ? undefined : getNotifyNameFromMessage(msg));

  const envelope: IUpsertMessage['message'] = {
    key: {
      id,
      remoteJid,
      remoteJidAlt,
      fromMe: msg.fromMe ?? false,
      participant: resolveGroupParticipant(msg, remoteJid),
      isViewOnce: isViewOnce || undefined,
    },
    message: innerMessage,
    messageTimestamp: msg.timestamp,
    pushName: resolvedPushName,
    ack,
  };

  return {
    worker_id: wwebjsEnvironment.wwebjsWorkerId,
    account_id: wwebjsEnvironment.wwebjsAccountId,
    type: messageType,
    message: envelope,
    content: unsupportedFallback
      ? {
          type: EMessageType.system,
          message: body || UNSUPPORTED_INCOMING_MESSAGE_TEXT,
        }
      : ctaUrlContent
        ? ctaUrlContent
        : buttonsContent
          ? buttonsContent
          : buttonsResponseText
            ? {
                type: EMessageType.text,
                message: buttonsResponseText,
              }
            : listContent
              ? listContent
              : listResponse
                ? {
                    type: EMessageType.text,
                    message: listResponse.title,
                  }
                : undefined,
    has_quoted: (msg.hasQuotedMsg ?? false) || !!quotedContextInfo,
  };
}
