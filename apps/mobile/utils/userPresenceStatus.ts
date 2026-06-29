import type { ChatUserStatus } from '../api/chatApi';

export type UserPresenceStatus = Extract<
  ChatUserStatus,
  'online' | 'busy' | 'do_not_disturb' | 'away' | 'offline'
>;

type ChangeUserPresenceStatusParams = {
  currentStatus: UserPresenceStatus;
  nextStatus: UserPresenceStatus;
  canUpdateOwnStatus: boolean;
  isSaving: boolean;
  publishPresence: (status: UserPresenceStatus) => Promise<boolean>;
  setStatus: (status: UserPresenceStatus) => void;
  setSaving: (saving: boolean) => void;
  onStatusUpdated?: (status: ChatUserStatus) => void;
  onError?: () => void;
};

export type ChangeUserPresenceStatusResult = 'updated' | 'failed' | 'skipped';

export async function changeUserPresenceStatus({
  currentStatus,
  nextStatus,
  canUpdateOwnStatus,
  isSaving,
  publishPresence,
  setStatus,
  setSaving,
  onStatusUpdated,
  onError,
}: ChangeUserPresenceStatusParams): Promise<ChangeUserPresenceStatusResult> {
  if (!canUpdateOwnStatus || isSaving || nextStatus === currentStatus) {
    return 'skipped';
  }

  setStatus(nextStatus);
  setSaving(true);

  try {
    const ok = await publishPresence(nextStatus);

    if (!ok) {
      setStatus(currentStatus);
      onError?.();
      return 'failed';
    }

    onStatusUpdated?.(nextStatus);
    return 'updated';
  } catch {
    setStatus(currentStatus);
    onError?.();
    return 'failed';
  } finally {
    setSaving(false);
  }
}
