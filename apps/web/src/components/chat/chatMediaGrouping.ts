import { EMessageType } from '@core/common/enums/EMessageType';
import { ListMessageResult } from '@core/schema/chat/listMessageChats/response.schema';
import { isTypeUser } from '@core/common/functions/isTypeUser';

const FALLBACK_GALLERY_WINDOW_MS = 5000;
const VALID_PIN_ACTIONS = new Set(['PIN', 'UNPIN', 'UNPIN_FOR_ALL', '1', '2']);

export interface GalleryImageItem {
  message: ListMessageResult;
  src: string;
  caption: string;
  downloadName: string;
  width: number | null;
  height: number | null;
}

export interface GalleryImageGroup {
  id: string;
  items: GalleryImageItem[];
}

export interface GalleryMembership {
  groupId: string;
  index: number;
  isHead: boolean;
}

export interface ImageGalleryLookup {
  groupsById: Record<string, GalleryImageGroup>;
  membershipByMessageId: Record<string, GalleryMembership>;
}

interface WorkingGroup {
  mode: 'metadata' | 'fallback';
  albumId: string | null;
  direction: 'incoming' | 'outgoing';
  lastTimestamp: number | null;
  items: GalleryImageItem[];
}

function normalizePinAction(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.toUpperCase();
}

function normalizeTextForEmptyCheck(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/[\u200B-\u200F\u2060\uFEFF]/g, '').trim();
}

function isImageMessage(message: ListMessageResult): boolean {
  return (
    message.content?.type === EMessageType.image &&
    typeof message.content?.image?.url === 'string' &&
    message.content.image.url.length > 0
  );
}

function getDirection(message: ListMessageResult): 'incoming' | 'outgoing' {
  return isTypeUser(message) ? 'incoming' : 'outgoing';
}

function getAlbumId(message: ListMessageResult): string | null {
  const albumId = message.content?.album?.id;
  if (typeof albumId !== 'string') return null;
  const trimmed = albumId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getMessageTimestampMs(message: ListMessageResult): number | null {
  const parsed = new Date(message.date).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function getImageDownloadName(message: ListMessageResult): string {
  const extension = message.content?.image?.extension?.trim();
  if (extension) {
    return `image.${extension.replace(/^\./, '')}`;
  }
  return 'image.jpg';
}

function getAlbumItemIndex(message: ListMessageResult): number | null {
  const value = message.content?.album?.item_index;
  if (typeof value !== 'number') return null;
  if (!Number.isFinite(value)) return null;
  return value;
}

function toGalleryItem(message: ListMessageResult): GalleryImageItem {
  const image = message.content?.image;
  return {
    message,
    src: image?.url ?? '',
    caption: image?.caption ?? '',
    downloadName: getImageDownloadName(message),
    width: image?.width ?? null,
    height: image?.height ?? null,
  };
}

function flushWorkingGroup(
  state: WorkingGroup | null,
  groupsById: Record<string, GalleryImageGroup>,
  membershipByMessageId: Record<string, GalleryMembership>
): void {
  if (!state || state.items.length < 2) {
    return;
  }

  const sortedItems =
    state.mode === 'metadata'
      ? state.items
          .map((item, index) => ({ item, index }))
          .sort((a, b) => {
            const aIndex = getAlbumItemIndex(a.item.message);
            const bIndex = getAlbumItemIndex(b.item.message);

            if (aIndex !== null && bIndex !== null && aIndex !== bIndex) {
              return aIndex - bIndex;
            }

            if (aIndex !== null && bIndex === null) return -1;
            if (aIndex === null && bIndex !== null) return 1;

            return a.index - b.index;
          })
          .map(({ item }) => item)
      : state.items;

  const firstMessageId = sortedItems[0]?.message.message_id;
  if (!firstMessageId) {
    return;
  }

  const groupId = `${state.mode}:${state.albumId ?? 'fallback'}:${firstMessageId}`;
  groupsById[groupId] = {
    id: groupId,
    items: sortedItems,
  };

  sortedItems.forEach((item, index) => {
    membershipByMessageId[item.message.message_id] = {
      groupId,
      index,
      isHead: index === 0,
    };
  });
}

export function isValidPinAction(
  pinAction: string | null | undefined
): boolean {
  const normalized = normalizePinAction(pinAction);
  if (!normalized) return false;
  return VALID_PIN_ACTIONS.has(normalized);
}

export function isGhostPinMessage(message: ListMessageResult): boolean {
  const content = message.content;
  if (!content) return false;
  if (content.type !== EMessageType.system) return false;
  if (!content.pin) return false;

  const messageText =
    typeof content.message === 'string' ? content.message.trim() : '';
  if (messageText) return false;

  return !isValidPinAction(content.pin.pin_action ?? null);
}

export function isGhostEmptyTextMessage(message: ListMessageResult): boolean {
  const content = message.content;
  if (!content) return false;
  if (content.type !== EMessageType.text) return false;

  const versions = content.version ?? [];
  if (versions.length > 0) {
    const latestVersion = versions.reduce((latest, current) => {
      if (!latest) return current;
      return new Date(current.date).getTime() > new Date(latest.date).getTime()
        ? current
        : latest;
    }, versions[0]);

    if (typeof latestVersion?.message === 'string') {
      return normalizeTextForEmptyCheck(latestVersion.message).length === 0;
    }
  }

  const messageText =
    typeof content.message === 'string' ? content.message : '';
  return normalizeTextForEmptyCheck(messageText).length === 0;
}

export function buildImageGalleryLookup(
  messages: ListMessageResult[]
): ImageGalleryLookup {
  const groupsById: Record<string, GalleryImageGroup> = {};
  const membershipByMessageId: Record<string, GalleryMembership> = {};

  let currentGroup: WorkingGroup | null = null;

  const flushCurrentGroup = () => {
    flushWorkingGroup(currentGroup, groupsById, membershipByMessageId);
    currentGroup = null;
  };

  for (const message of messages) {
    if (!isImageMessage(message)) {
      flushCurrentGroup();
      continue;
    }

    const albumId = getAlbumId(message);
    const mode: WorkingGroup['mode'] = albumId ? 'metadata' : 'fallback';
    const direction = getDirection(message);
    const timestamp = getMessageTimestampMs(message);

    const shouldJoinGroup = (() => {
      if (!currentGroup) return false;
      if (currentGroup.mode !== mode) return false;
      if (currentGroup.direction !== direction) return false;

      if (mode === 'metadata') {
        return (
          currentGroup.albumId !== null && currentGroup.albumId === albumId
        );
      }

      if (currentGroup.albumId !== null || albumId !== null) {
        return false;
      }

      if (currentGroup.lastTimestamp === null || timestamp === null) {
        return false;
      }

      return (
        timestamp - currentGroup.lastTimestamp <= FALLBACK_GALLERY_WINDOW_MS
      );
    })();

    const activeGroup = currentGroup;

    if (!shouldJoinGroup || !activeGroup) {
      flushCurrentGroup();
      currentGroup = {
        mode,
        albumId,
        direction,
        lastTimestamp: timestamp,
        items: [toGalleryItem(message)],
      };
      continue;
    }

    activeGroup.items.push(toGalleryItem(message));
    activeGroup.lastTimestamp = timestamp;
  }

  flushCurrentGroup();

  return {
    groupsById,
    membershipByMessageId,
  };
}
