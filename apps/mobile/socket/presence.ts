import type { ChatUserStatus } from '../api/chatApi';
import { getUser, patchUser } from '../storage/authStorage';
import { emitCurrentUserPresenceStatus } from '../utils/currentUserPresence';
import { publish } from './centrifugo';

type PresenceStatus = Extract<
  ChatUserStatus,
  'online' | 'away' | 'busy' | 'do_not_disturb' | 'offline'
>;

type PresenceMessage = {
  event: 'presence_update';
  user_id: string;
  status: PresenceStatus;
  is_heartbeat?: boolean;
};

const PRESENCE_CHANNEL = 'presence:updates';

function normalizeIdentifier(value: unknown): string | null {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

async function getCurrentUserId(): Promise<string | null> {
  const user = await getUser();
  if (!user || typeof user !== 'object') return null;

  const normalized = user as { user_id?: unknown; id?: unknown };
  return (
    normalizeIdentifier(normalized.user_id) ??
    normalizeIdentifier(normalized.id)
  );
}

const wait = async (ms: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

export async function publishPresence(
  status: PresenceStatus,
  options?: { isHeartbeat?: boolean }
): Promise<boolean> {
  const userId = await getCurrentUserId();
  if (!userId) {
    return false;
  }

  const message: PresenceMessage = {
    event: 'presence_update',
    user_id: userId,
    status,
    is_heartbeat: options?.isHeartbeat ?? false,
  };

  try {
    await publish(PRESENCE_CHANNEL, message);
    await patchUser({
      chat_user: {
        status,
      },
    });
    emitCurrentUserPresenceStatus(status);
    return true;
  } catch {
    return false;
  }
}

export async function ensureOnlinePresence(options?: {
  maxAttempts?: number;
  retryDelayMs?: number;
}): Promise<boolean> {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 3);
  const retryDelayMs = Math.max(200, options?.retryDelayMs ?? 1200);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const ok = await publishPresence('online');
    if (ok) {
      return true;
    }

    if (attempt < maxAttempts) {
      await wait(retryDelayMs);
    }
  }

  return false;
}
