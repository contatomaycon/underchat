import 'reflect-metadata';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EPermissionsRoles } from '@core/common/enums/EPermissions';
import type { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import type { IChat } from '@core/common/interfaces/IChat';
import type { ChatService } from '@core/services/chat.service';
import type { ChatUserService } from '@core/services/chatUser.service';
import { ChatPinnerUseCase } from '@core/useCases/chat/ChatPinner.useCase';

jest.mock('@core/services/chat.service', () => ({
  ChatService: class ChatService {},
}));

jest.mock('@core/services/chatUser.service', () => ({
  ChatUserService: class ChatUserService {},
}));

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

function buildChat(status: EChatStatus = EChatStatus.in_chat): IChat {
  return {
    chat_id: 'chat-1',
    status,
    account: { id: 'account-1', name: 'Account' },
    user: { id: 'user-1', name: 'User' },
    secondary_users: [],
    worker: { id: 'worker-1', name: 'Worker' },
    sector: null,
    summary: null,
    contact: null,
    photo: null,
    name: 'Contact',
    phone: '5511999999999',
    date: new Date().toISOString(),
  } as unknown as IChat;
}

function buildUseCase(chat: IChat | null = buildChat()) {
  const chatUserService = {
    pinChat: jest.fn(async () => true),
  } as unknown as ChatUserService & {
    pinChat: jest.Mock;
  };
  const chatService = {
    findChatByChatId: jest.fn(async () => chat),
  } as unknown as ChatService & {
    findChatByChatId: jest.Mock;
  };

  return {
    useCase: new ChatPinnerUseCase(chatService, chatUserService),
    chatUserService,
    chatService,
  };
}

describe('ChatPinnerUseCase', () => {
  it('pins a chat that exists, is open and readable', async () => {
    const { useCase, chatUserService, chatService } = buildUseCase();

    await expect(
      useCase.execute(
        t,
        'account-1',
        'user-1',
        [buildAction(EGeneralPermissions.full_access)],
        [],
        [],
        'chat-1'
      )
    ).resolves.toBe(true);

    expect(chatService.findChatByChatId).toHaveBeenCalledWith(
      'account-1',
      'chat-1'
    );
    expect(chatUserService.pinChat).toHaveBeenCalledWith('user-1', 'chat-1');
  });

  it('rejects a chat that does not exist', async () => {
    const { useCase, chatUserService } = buildUseCase(null);

    await expect(
      useCase.execute(t, 'account-1', 'user-1', [], [], [], 'chat-1')
    ).rejects.toThrow('chat_pin_not_found');

    expect(chatUserService.pinChat).not.toHaveBeenCalled();
  });

  it('rejects a closed chat', async () => {
    const { useCase, chatUserService } = buildUseCase(
      buildChat(EChatStatus.closed)
    );

    await expect(
      useCase.execute(
        t,
        'account-1',
        'user-1',
        [buildAction(EGeneralPermissions.full_access)],
        [],
        [],
        'chat-1'
      )
    ).rejects.toThrow('chat_pin_invalid_status');

    expect(chatUserService.pinChat).not.toHaveBeenCalled();
  });

  it('rejects a chat without read permission', async () => {
    const chat = {
      ...buildChat(EChatStatus.in_chat),
      user: { id: 'another-user', name: 'Other' },
      secondary_users: [],
      sector: { id: 'sector-2', name: 'Sector' },
    } as unknown as IChat;
    const { useCase, chatUserService } = buildUseCase(chat);

    await expect(
      useCase.execute(t, 'account-1', 'user-1', [], ['sector-1'], [], 'chat-1')
    ).rejects.toThrow('chat_access_denied');

    expect(chatUserService.pinChat).not.toHaveBeenCalled();
  });
});
