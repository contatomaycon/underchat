import type { ChatUserStatus } from '../api/chatApi';

const listeners = new Set<(status: ChatUserStatus) => void>();
let latestStatus: ChatUserStatus | null = null;

export function emitCurrentUserPresenceStatus(status: ChatUserStatus): void {
  latestStatus = status;

  for (const listener of listeners) {
    try {
      listener(status);
    } catch {
      // ignore listener errors
    }
  }
}

export function addCurrentUserPresenceStatusListener(
  listener: (status: ChatUserStatus) => void,
  options?: { emitCurrent?: boolean }
): () => void {
  listeners.add(listener);

  if (options?.emitCurrent && latestStatus) {
    try {
      listener(latestStatus);
    } catch {
      // ignore listener errors
    }
  }

  return () => {
    listeners.delete(listener);
  };
}

export function getCurrentUserPresenceStatusSnapshot(): ChatUserStatus | null {
  return latestStatus;
}
