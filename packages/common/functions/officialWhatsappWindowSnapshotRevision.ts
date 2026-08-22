import type { IOfficialWhatsappConversationWindowSnapshot } from '../interfaces/IOfficialWhatsappConversationWindow';

type WindowSnapshot =
  IOfficialWhatsappConversationWindowSnapshot | null | undefined;

function revisionTimestamp(snapshot: WindowSnapshot): number | null {
  if (!snapshot?.updated_at) {
    return null;
  }

  const timestamp = new Date(snapshot.updated_at).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

/** Positive means that the incoming window snapshot is newer. */
export function compareOfficialWhatsappWindowSnapshotRevisions(
  existing: WindowSnapshot,
  incoming: WindowSnapshot
): number | null {
  if (incoming === undefined) {
    return -1;
  }
  if (existing === undefined) {
    return 1;
  }
  if (incoming === null) {
    return existing === null ? 0 : -1;
  }
  if (existing === null) {
    return 1;
  }

  const existingRevision = revisionTimestamp(existing);
  const incomingRevision = revisionTimestamp(incoming);
  if (existingRevision === null && incomingRevision === null) {
    return null;
  }
  if (existingRevision === null) {
    return 1;
  }
  if (incomingRevision === null) {
    return -1;
  }
  if (incomingRevision === existingRevision) {
    return 0;
  }

  return incomingRevision > existingRevision ? 1 : -1;
}

export function selectNewestOfficialWhatsappWindowSnapshot(
  existing: WindowSnapshot,
  incoming: WindowSnapshot
): WindowSnapshot {
  const order = compareOfficialWhatsappWindowSnapshotRevisions(
    existing,
    incoming
  );

  if (order === null) {
    return incoming;
  }

  return order >= 0 ? incoming : existing;
}

export function hasApplicableIncomingOfficialWhatsappWindowSnapshot(
  existing: WindowSnapshot,
  incoming: WindowSnapshot
): boolean {
  if (incoming === undefined) {
    return false;
  }

  const order = compareOfficialWhatsappWindowSnapshotRevisions(
    existing,
    incoming
  );
  if (order !== null) {
    return order > 0;
  }

  return JSON.stringify(existing ?? null) !== JSON.stringify(incoming ?? null);
}
