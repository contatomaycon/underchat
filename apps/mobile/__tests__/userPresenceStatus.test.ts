import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  changeUserPresenceStatus,
  type UserPresenceStatus,
} from '../utils/userPresenceStatus';

function createStatusChangeHarness() {
  return {
    publishPresence:
      jest.fn<(status: UserPresenceStatus) => Promise<boolean>>(),
    updateChatUser: jest.fn(),
    setStatus: jest.fn<(status: UserPresenceStatus) => void>(),
    setSaving: jest.fn<(saving: boolean) => void>(),
    onStatusUpdated: jest.fn(),
    onError: jest.fn(),
  };
}

describe('changeUserPresenceStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('publishes presence and confirms the optimistic status', async () => {
    const harness = createStatusChangeHarness();
    harness.publishPresence.mockResolvedValue(true);

    await expect(
      changeUserPresenceStatus({
        currentStatus: 'online',
        nextStatus: 'away',
        canUpdateOwnStatus: true,
        isSaving: false,
        publishPresence: harness.publishPresence,
        setStatus: harness.setStatus,
        setSaving: harness.setSaving,
        onStatusUpdated: harness.onStatusUpdated,
        onError: harness.onError,
      })
    ).resolves.toBe('updated');

    expect(harness.publishPresence).toHaveBeenCalledWith('away');
    expect(harness.updateChatUser).not.toHaveBeenCalled();
    expect(harness.setStatus).toHaveBeenCalledWith('away');
    expect(harness.setSaving).toHaveBeenNthCalledWith(1, true);
    expect(harness.setSaving).toHaveBeenNthCalledWith(2, false);
    expect(harness.onStatusUpdated).toHaveBeenCalledWith('away');
    expect(harness.onError).not.toHaveBeenCalled();
  });

  it('rolls back and reports an error when presence publish fails', async () => {
    const harness = createStatusChangeHarness();
    harness.publishPresence.mockResolvedValue(false);

    await expect(
      changeUserPresenceStatus({
        currentStatus: 'online',
        nextStatus: 'busy',
        canUpdateOwnStatus: true,
        isSaving: false,
        publishPresence: harness.publishPresence,
        setStatus: harness.setStatus,
        setSaving: harness.setSaving,
        onStatusUpdated: harness.onStatusUpdated,
        onError: harness.onError,
      })
    ).resolves.toBe('failed');

    expect(harness.setStatus).toHaveBeenNthCalledWith(1, 'busy');
    expect(harness.setStatus).toHaveBeenNthCalledWith(2, 'online');
    expect(harness.setSaving).toHaveBeenNthCalledWith(1, true);
    expect(harness.setSaving).toHaveBeenNthCalledWith(2, false);
    expect(harness.onStatusUpdated).not.toHaveBeenCalled();
    expect(harness.onError).toHaveBeenCalledTimes(1);
  });

  it('skips when status cannot be changed', async () => {
    const harness = createStatusChangeHarness();

    await expect(
      changeUserPresenceStatus({
        currentStatus: 'online',
        nextStatus: 'away',
        canUpdateOwnStatus: false,
        isSaving: false,
        publishPresence: harness.publishPresence,
        setStatus: harness.setStatus,
        setSaving: harness.setSaving,
      })
    ).resolves.toBe('skipped');

    await expect(
      changeUserPresenceStatus({
        currentStatus: 'online',
        nextStatus: 'online',
        canUpdateOwnStatus: true,
        isSaving: false,
        publishPresence: harness.publishPresence,
        setStatus: harness.setStatus,
        setSaving: harness.setSaving,
      })
    ).resolves.toBe('skipped');

    await expect(
      changeUserPresenceStatus({
        currentStatus: 'online',
        nextStatus: 'away',
        canUpdateOwnStatus: true,
        isSaving: true,
        publishPresence: harness.publishPresence,
        setStatus: harness.setStatus,
        setSaving: harness.setSaving,
      })
    ).resolves.toBe('skipped');

    expect(harness.publishPresence).not.toHaveBeenCalled();
    expect(harness.setStatus).not.toHaveBeenCalled();
    expect(harness.setSaving).not.toHaveBeenCalled();
  });
});
