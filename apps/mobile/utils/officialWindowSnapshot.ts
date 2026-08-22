import type { ListChatsResult, ListMessageResponse } from '../types/chat';

type OfficialWindowSnapshot = Pick<ListMessageResponse, 'official_window'>;

function parseRevision(value?: string | null): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function selectNewestWindow(
  current: ListChatsResult['official_window'],
  incoming: ListChatsResult['official_window']
): ListChatsResult['official_window'] {
  if (incoming === undefined) return current;
  if (incoming === null || current === null || current === undefined) {
    return incoming;
  }

  const currentRevision = parseRevision(current.updated_at);
  const incomingRevision = parseRevision(incoming.updated_at);
  if (currentRevision !== null && incomingRevision === null) return current;
  if (currentRevision === null || incomingRevision === null) return incoming;
  return incomingRevision >= currentRevision ? incoming : current;
}

export function mergeChatOfficialWindowSnapshot(
  currentChat: ListChatsResult,
  requestedChatId: string,
  snapshot: OfficialWindowSnapshot | null | undefined
): ListChatsResult {
  if (
    currentChat.chat_id !== requestedChatId ||
    snapshot?.official_window === undefined
  ) {
    return currentChat;
  }

  const officialWindow = selectNewestWindow(
    currentChat.official_window,
    snapshot.official_window
  );
  if (currentChat.official_window === officialWindow) {
    return currentChat;
  }

  return {
    ...currentChat,
    official_window: officialWindow,
  };
}
