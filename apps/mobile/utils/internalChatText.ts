import type { InternalChatMessage } from '../types/internalChat';

type TemplateParams = Record<string, string | number | null | undefined>;

const FALLBACK_ACTOR = 'Sistema';
const FALLBACK_TARGET = 'Usuário';

const INTERNAL_CHAT_TEXT_TAGS: Record<string, string> = {
  internal_chat_preview_image: '[Imagem]',
  internal_chat_preview_video: '[Vídeo]',
  internal_chat_preview_audio: '[Áudio]',
  internal_chat_preview_document: '[Documento]',
  internal_chat_preview_location: '[Localização]',
  internal_chat_preview_contact: '[Contato]',
  internal_chat_preview_contacts: '[Contatos]',
  internal_chat_preview_group_event: 'Atualização do grupo',
  internal_chat_system_group_created: '{actor} criou o grupo',
  internal_chat_system_group_member_added: '{actor} adicionou {target}',
  internal_chat_system_group_member_removed: '{actor} removeu {target}',
  internal_chat_system_group_member_left: '{actor} saiu do grupo',
  internal_chat_deleted_message: 'Mensagem removida',
  internal_chat_deleted_message_content: 'Mensagem apagada',
  internal_chat_message: 'Mensagem',
  internal_chat_reply: 'Resposta',
};

type InternalSystemPayload = {
  key?: string | null;
  action?: string | null;
  actor_name?: string | null;
  target_name?: string | null;
  params?: TemplateParams | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readSystemPayload(message: InternalChatMessage): InternalSystemPayload {
  const content = message.content as unknown;
  if (!isRecord(content) || !isRecord(content.system)) {
    return {};
  }

  const system = content.system;
  const params = isRecord(system.params)
    ? (system.params as TemplateParams)
    : null;

  return {
    key: typeof system.key === 'string' ? system.key : null,
    action: typeof system.action === 'string' ? system.action : null,
    actor_name:
      typeof system.actor_name === 'string' ? system.actor_name : null,
    target_name:
      typeof system.target_name === 'string' ? system.target_name : null,
    params,
  };
}

function interpolate(template: string, params: TemplateParams): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => {
    const value = params[key];
    if (value === null || value === undefined || value === '') {
      if (key === 'actor') return FALLBACK_ACTOR;
      if (key === 'target') return FALLBACK_TARGET;
      return '';
    }
    return String(value);
  });
}

export function resolveInternalChatTextTag(
  value: string | null | undefined,
  params: TemplateParams = {}
): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;

  const template = INTERNAL_CHAT_TEXT_TAGS[normalized];
  if (!template) return normalized;

  return interpolate(template, params);
}

export function isInternalChatSystemMessage(
  message: InternalChatMessage
): boolean {
  return message.type_user === 'system' || message.content?.type === 'system';
}

export function resolveInternalChatSenderName(
  message: InternalChatMessage
): string {
  if (isInternalChatSystemMessage(message)) return FALLBACK_ACTOR;
  return message.user?.name || FALLBACK_TARGET;
}

export function resolveInternalChatSystemMessageText(
  message: InternalChatMessage
): string {
  const system = readSystemPayload(message);
  const key =
    system.key ||
    message.content?.message ||
    (system.action ? `internal_chat_system_${system.action}` : null);
  const params: TemplateParams = {
    ...(system.params ?? {}),
    actor: system.params?.actor ?? system.actor_name ?? FALLBACK_ACTOR,
    target: system.params?.target ?? system.target_name ?? FALLBACK_TARGET,
  };

  return (
    resolveInternalChatTextTag(key, params) ??
    INTERNAL_CHAT_TEXT_TAGS.internal_chat_preview_group_event
  );
}

export function resolveInternalChatMessageText(
  message: InternalChatMessage
): string {
  const content = message.content;
  if (message.deleted) {
    return INTERNAL_CHAT_TEXT_TAGS.internal_chat_deleted_message_content;
  }
  if (isInternalChatSystemMessage(message)) {
    return resolveInternalChatSystemMessageText(message);
  }
  if (content?.message) {
    return resolveInternalChatTextTag(content.message) ?? content.message;
  }
  if (content?.image) {
    return (
      content.image.caption ||
      INTERNAL_CHAT_TEXT_TAGS.internal_chat_preview_image
    );
  }
  if (content?.video) {
    return (
      content.video.caption ||
      INTERNAL_CHAT_TEXT_TAGS.internal_chat_preview_video
    );
  }
  if (content?.audio) return INTERNAL_CHAT_TEXT_TAGS.internal_chat_preview_audio;
  if (content?.document) {
    return content.document.name || INTERNAL_CHAT_TEXT_TAGS.internal_chat_preview_document;
  }
  if (content?.location) {
    return content.location.name || INTERNAL_CHAT_TEXT_TAGS.internal_chat_preview_location;
  }
  if (content?.contact) return content.contact.name || INTERNAL_CHAT_TEXT_TAGS.internal_chat_preview_contact;
  if (content?.contacts) return INTERNAL_CHAT_TEXT_TAGS.internal_chat_preview_contacts;
  return '';
}

export function resolveInternalChatMessagePreview(
  message: InternalChatMessage
): string | null {
  const content = message.content;
  if (message.deleted) return INTERNAL_CHAT_TEXT_TAGS.internal_chat_deleted_message;
  if (!content) return null;
  if (isInternalChatSystemMessage(message)) {
    return INTERNAL_CHAT_TEXT_TAGS.internal_chat_preview_group_event;
  }
  if (content.type === 'text') {
    return content.message
      ? resolveInternalChatTextTag(content.message) ?? content.message
      : null;
  }
  if (content.image) return INTERNAL_CHAT_TEXT_TAGS.internal_chat_preview_image;
  if (content.video) return INTERNAL_CHAT_TEXT_TAGS.internal_chat_preview_video;
  if (content.audio) return INTERNAL_CHAT_TEXT_TAGS.internal_chat_preview_audio;
  if (content.document) return INTERNAL_CHAT_TEXT_TAGS.internal_chat_preview_document;
  if (content.location) return INTERNAL_CHAT_TEXT_TAGS.internal_chat_preview_location;
  if (content.contact) return INTERNAL_CHAT_TEXT_TAGS.internal_chat_preview_contact;
  if (content.contacts) return INTERNAL_CHAT_TEXT_TAGS.internal_chat_preview_contacts;
  return content.message
    ? resolveInternalChatTextTag(content.message) ?? content.message
    : null;
}
