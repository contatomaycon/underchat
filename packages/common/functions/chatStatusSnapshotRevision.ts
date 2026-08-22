import type { IChatMeta } from '../interfaces/IChat';

export interface ChatStatusSnapshotRevision {
  status?: string | null;
  meta?: {
    status_epoch?: number | null;
    status_event_id?: string | null;
  } | null;
}

const getStatusEpoch = (
  snapshot: ChatStatusSnapshotRevision
): number | null => {
  const epoch = snapshot.meta?.status_epoch;
  return typeof epoch === 'number' && Number.isFinite(epoch) ? epoch : null;
};

const compareStatusMetadata = (
  existing: IChatMeta,
  incoming: IChatMeta
): number | null => {
  const existingEpoch = existing.status_epoch;
  const incomingEpoch = incoming.status_epoch;
  const hasExistingEpoch =
    typeof existingEpoch === 'number' && Number.isFinite(existingEpoch);
  const hasIncomingEpoch =
    typeof incomingEpoch === 'number' && Number.isFinite(incomingEpoch);

  if (hasExistingEpoch && !hasIncomingEpoch) return -1;
  if (!hasExistingEpoch && hasIncomingEpoch) return 1;
  if (!hasExistingEpoch || !hasIncomingEpoch) return null;
  if (incomingEpoch !== existingEpoch) {
    return incomingEpoch > existingEpoch ? 1 : -1;
  }

  const existingEventId = existing.status_event_id;
  const incomingEventId = incoming.status_event_id;
  const hasExistingEventId =
    typeof existingEventId === 'string' && existingEventId.length > 0;
  const hasIncomingEventId =
    typeof incomingEventId === 'string' && incomingEventId.length > 0;

  if (hasExistingEventId && !hasIncomingEventId) return -1;
  if (!hasExistingEventId && hasIncomingEventId) return 1;
  if (!hasExistingEventId || !hasIncomingEventId) return 0;
  if (incomingEventId === existingEventId) return 0;
  return incomingEventId > existingEventId ? 1 : -1;
};

/** Keeps the newest status revision while still merging unrelated metadata. */
export const mergeChatStatusMetadata = (
  existing: IChatMeta | null | undefined,
  incoming: IChatMeta | null | undefined
): IChatMeta | null | undefined => {
  if (!incoming) return existing;
  if (!existing) return incoming;

  const merged: IChatMeta = { ...existing, ...incoming };
  const order = compareStatusMetadata(existing, incoming);
  if (order === null || order > 0) {
    return merged;
  }

  merged.status_epoch = existing.status_epoch;
  merged.status_event_id = existing.status_event_id;
  merged.status_source = existing.status_source;
  return merged;
};

const getStatusEventId = (
  snapshot: ChatStatusSnapshotRevision
): string | null => {
  const eventId = snapshot.meta?.status_event_id;
  return typeof eventId === 'string' && eventId.length > 0 ? eventId : null;
};

/**
 * Compares status revisions only when the status changed. Positive means the
 * incoming snapshot is newer; null delegates to the legacy ordering rules.
 */
export const compareChatStatusRevisions = (
  existing: ChatStatusSnapshotRevision,
  incoming: ChatStatusSnapshotRevision
): number | null => {
  if (existing.status === incoming.status) {
    return null;
  }

  const existingEpoch = getStatusEpoch(existing);
  const incomingEpoch = getStatusEpoch(incoming);
  if (existingEpoch === null && incomingEpoch !== null) {
    return 1;
  }
  if (existingEpoch !== null && incomingEpoch === null) {
    return -1;
  }
  if (existingEpoch === null || incomingEpoch === null) {
    return null;
  }

  if (incomingEpoch !== existingEpoch) {
    return incomingEpoch > existingEpoch ? 1 : -1;
  }

  const existingEventId = getStatusEventId(existing);
  const incomingEventId = getStatusEventId(incoming);
  if (existingEventId === null && incomingEventId !== null) {
    return 1;
  }
  if (existingEventId !== null && incomingEventId === null) {
    return -1;
  }
  if (existingEventId === null || incomingEventId === null) {
    return 0;
  }

  if (incomingEventId === existingEventId) {
    return 0;
  }

  return incomingEventId > existingEventId ? 1 : -1;
};

/**
 * Selects the snapshot with the newest status revision. Legacy snapshots and
 * valid updates carrying the same revision keep last-arrival semantics.
 */
export const selectNewestChatStatusSnapshot = <
  TSnapshot extends ChatStatusSnapshotRevision,
>(
  existing: TSnapshot | null | undefined,
  incoming: TSnapshot
): TSnapshot => {
  if (!existing) {
    return incoming;
  }

  if (existing.status === incoming.status) {
    const metadataOrder = compareStatusMetadata(
      existing.meta ?? {},
      incoming.meta ?? {}
    );

    if (metadataOrder === null || metadataOrder >= 0) {
      return incoming;
    }

    return existing;
  }

  const revisionOrder = compareChatStatusRevisions(existing, incoming);
  if (revisionOrder === null) {
    return incoming;
  }

  return revisionOrder > 0 ? incoming : existing;
};

/** Returns true only when the incoming snapshot carries another revision. */
export const hasDifferentIncomingStatusRevision = (
  existing: ChatStatusSnapshotRevision,
  incoming: ChatStatusSnapshotRevision
): boolean => {
  const incomingEpoch = getStatusEpoch(incoming);
  const incomingEventId = getStatusEventId(incoming);
  if (incomingEpoch === null && incomingEventId === null) {
    return false;
  }

  return (
    incomingEpoch !== getStatusEpoch(existing) ||
    incomingEventId !== getStatusEventId(existing)
  );
};
