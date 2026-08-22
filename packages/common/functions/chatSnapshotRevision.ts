import {
  type ChatStatusSnapshotRevision,
  selectNewestChatStatusSnapshot,
} from './chatStatusSnapshotRevision';
import type { IOfficialWhatsappConversationWindowSnapshot } from '../interfaces/IOfficialWhatsappConversationWindow';
import { selectNewestOfficialWhatsappWindowSnapshot } from './officialWhatsappWindowSnapshotRevision';

export interface ChatSnapshotRevision extends ChatStatusSnapshotRevision {
  official_window?:
    IOfficialWhatsappConversationWindowSnapshot | null | undefined;
}

/**
 * Reconciles the independent chat-status and official-window revisions.
 *
 * The newest status snapshot provides the base chat payload, while the newest
 * official window is selected separately by `updated_at`. This prevents an
 * otherwise newer status event from regressing the official conversation
 * window carried by another event or HTTP response.
 */
export const selectNewestChatSnapshotRevision = <
  TSnapshot extends ChatSnapshotRevision,
>(
  existing: TSnapshot | null | undefined,
  incoming: TSnapshot
): TSnapshot => {
  const selected = selectNewestChatStatusSnapshot(existing, incoming);
  if (!existing) {
    return selected;
  }

  const officialWindow = selectNewestOfficialWhatsappWindowSnapshot(
    existing.official_window,
    incoming.official_window
  );

  if (selected.official_window === officialWindow) {
    return selected;
  }

  return {
    ...selected,
    official_window: officialWindow,
  };
};
