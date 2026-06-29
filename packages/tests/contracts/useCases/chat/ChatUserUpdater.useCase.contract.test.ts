import 'reflect-metadata';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { EPermissionsRoles } from '@core/common/enums/EPermissions';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import type { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import type { ChatUserService } from '@core/services/chatUser.service';
import type { PresenceService } from '@core/services/presence.service';
import { ChatUserUpdaterUseCase } from '@core/useCases/chat/ChatUserUpdater.useCase';

const t = ((key: string) => key) as never;

function buildAction(actionName: EPermissionsRoles): IJwtGroupHierarchy {
  return {
    account_id: 'account-1',
    permission_role_id: 'role-1',
    role_name: 'Role',
    module_name: 'chat',
    action_name: actionName,
  };
}

function buildUseCase(updateResult = true) {
  const chatUserService = {
    updateChatUser: jest.fn(async () => updateResult),
  } as unknown as ChatUserService & {
    updateChatUser: jest.Mock;
  };
  const presenceService = {
    setUserOnline: jest.fn(async () => undefined),
    setUserAway: jest.fn(async () => undefined),
    setUserBusy: jest.fn(async () => undefined),
    setUserDoNotDisturb: jest.fn(async () => undefined),
    setUserOffline: jest.fn(async () => undefined),
  } as unknown as PresenceService & {
    setUserOnline: jest.Mock;
    setUserAway: jest.Mock;
    setUserBusy: jest.Mock;
    setUserDoNotDisturb: jest.Mock;
    setUserOffline: jest.Mock;
  };

  return {
    useCase: new ChatUserUpdaterUseCase(chatUserService, presenceService),
    chatUserService,
    presenceService,
  };
}

describe('ChatUserUpdaterUseCase', () => {
  it('updates presence for status-only payloads', async () => {
    const { useCase, chatUserService, presenceService } = buildUseCase();

    await expect(
      useCase.execute(
        t,
        'user-1',
        [buildAction(EChatPermissions.chat_user_status_update)],
        { status: EChatUserStatus.away }
      )
    ).resolves.toBe(true);

    expect(chatUserService.updateChatUser).toHaveBeenCalledWith('user-1', {
      status: EChatUserStatus.away,
    });
    expect(presenceService.setUserAway).toHaveBeenCalledWith('user-1');
  });

  it('allows online/offline without explicit status permission', async () => {
    const { useCase, presenceService } = buildUseCase();

    await expect(
      useCase.execute(t, 'user-1', [], { status: EChatUserStatus.online })
    ).resolves.toBe(true);

    expect(presenceService.setUserOnline).toHaveBeenCalledWith('user-1');
  });

  it('rejects restricted statuses without permission', async () => {
    const { useCase, chatUserService, presenceService } = buildUseCase();

    await expect(
      useCase.execute(t, 'user-1', [], { status: EChatUserStatus.busy })
    ).rejects.toThrow('chat_update_user_invalid_status');

    expect(chatUserService.updateChatUser).not.toHaveBeenCalled();
    expect(presenceService.setUserBusy).not.toHaveBeenCalled();
  });
});
