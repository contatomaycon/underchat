import type { ListMessageResult } from '../types/chat';
import { pt } from '../locales/pt';

const VALID_PIN_ACTIONS = new Set(['PIN', 'UNPIN', 'UNPIN_FOR_ALL', '1', '2']);
const ZERO_WIDTH_PATTERN = /[\u200B-\u200F\u2060\uFEFF]/g;

const NON_TEXT_RENDERABLE_CONTENT_KEYS = [
  'quoted',
  'link_preview',
  'image',
  'video',
  'sticker',
  'location',
  'contact',
  'contacts',
  'audio',
  'document',
  'template',
  'album',
  'pin',
  'ephemeral',
  'forward',
] as const;

function formatTemplate(
  template: string,
  values: Record<string, string>
): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, value),
    template
  );
}

function normalizePinAction(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.toUpperCase();
}

function normalizeTextForEmptyCheck(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(ZERO_WIDTH_PATTERN, '').trim();
}

function isPlainObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasRenderableValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObjectRecord(value)) return Object.keys(value).length > 0;
  return true;
}

export function isValidPinAction(
  pinAction: string | null | undefined
): boolean {
  const normalized = normalizePinAction(pinAction);
  if (!normalized) return false;
  return VALID_PIN_ACTIONS.has(normalized);
}

export function getPinSystemMessageText(
  message: ListMessageResult
): string | null {
  const pin = message.content?.pin;
  if (!pin || !isValidPinAction(pin.pin_action ?? null)) return null;

  const pinAction = normalizePinAction(pin.pin_action);
  const isUnpin =
    pinAction === '2' || pinAction === 'UNPIN_FOR_ALL' || pinAction === 'UNPIN';

  if (pin.pin_user_name) {
    return formatTemplate(
      isUnpin ? pt.message_unpinned_by_user : pt.message_pinned_by_user,
      { name: pin.pin_user_name }
    );
  }

  if (pin.pin_user_phone) {
    return formatTemplate(
      isUnpin ? pt.message_unpinned_by_phone : pt.message_pinned_by_phone,
      { phone: pin.pin_user_phone }
    );
  }

  return isUnpin ? pt.message_unpinned_default : pt.message_pinned_default;
}

export function getEphemeralSystemMessageText(
  message: ListMessageResult
): string | null {
  const ephemeral = message.content?.ephemeral;
  if (!ephemeral) return null;

  if (ephemeral.user_name) {
    return formatTemplate(
      ephemeral.enabled
        ? pt.message_ephemeral_activated_by_user
        : pt.message_ephemeral_deactivated_by_user,
      { name: ephemeral.user_name }
    );
  }

  if (ephemeral.user_phone) {
    return formatTemplate(
      ephemeral.enabled
        ? pt.message_ephemeral_activated_by_phone
        : pt.message_ephemeral_deactivated_by_phone,
      { phone: ephemeral.user_phone }
    );
  }

  return ephemeral.enabled
    ? pt.message_ephemeral_activated_default
    : pt.message_ephemeral_deactivated_default;
}

export function getSystemMessageText(
  message: ListMessageResult
): string | null {
  if (message.content?.type !== 'system') return null;

  const pinText = getPinSystemMessageText(message);
  if (pinText) return pinText;

  const ephemeralText = getEphemeralSystemMessageText(message);
  if (!ephemeralText) return null;

  if (message.content.ephemeral?.enabled) {
    return `${ephemeralText}\n${pt.message_ephemeral_activated_description}`;
  }

  return ephemeralText;
}

export function isGhostPinMessage(message: ListMessageResult): boolean {
  const content = message.content;
  if (!content || content.type !== 'system' || !content.pin) return false;

  if (normalizeTextForEmptyCheck(content.message).length > 0) {
    return false;
  }

  return !isValidPinAction(content.pin.pin_action ?? null);
}

export function isGhostEmptyTextMessage(message: ListMessageResult): boolean {
  const content = message.content;
  if (!content || content.type !== 'text') return false;

  const versions = content.version ?? [];
  if (versions.length > 0) {
    const latestVersion = versions.reduce((latest, current) => {
      if (!latest) return current;
      return new Date(current.date).getTime() > new Date(latest.date).getTime()
        ? current
        : latest;
    }, versions[0]);

    if (normalizeTextForEmptyCheck(latestVersion?.message).length > 0) {
      return false;
    }
  }

  if (normalizeTextForEmptyCheck(content.message).length > 0) {
    return false;
  }

  return !NON_TEXT_RENDERABLE_CONTENT_KEYS.some((key) =>
    hasRenderableValue(content[key])
  );
}

export function shouldRenderChatMessage(message: ListMessageResult): boolean {
  return !isGhostPinMessage(message) && !isGhostEmptyTextMessage(message);
}
