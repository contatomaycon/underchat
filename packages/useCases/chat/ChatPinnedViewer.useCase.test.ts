import 'reflect-metadata';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EPermissionsRoles } from '@core/common/enums/EPermissions';
import type { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import type { IChat } from '@core/common/interfaces/IChat';
import type { ChatService } from '@core/services/chat.service';
import type { ChatUserService } from '@core/services/chatUser.service';
import { ChatPinnedViewerUseCase } from './ChatPinnedViewer.useCase';

jest.mock('@core/services/chat.service', () => ({
  ChatService: class ChatService {},
}));

jest.mock('@core/services/chatUser.service', () => ({
  ChatUserService: class ChatUserService {},
}));

function buildAction(actionName: EPermissionsRoles): IJwtGroupHierarchy {
  return {
    account_id: 'account-1',
    permission_role_id: 'role-1',
    role_name: 'Role',
    module_name: 'chat',
    action_name: actionName,
  };
}

function buildChat(
  chatId: string,
  status: EChatStatus = EChatStatus.queue
): IChat {
  return {
    chat_id: chatId,
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

function buildUseCase(chatsById: Record<string, IChat | null>) {
  const chatUserService = {
    listPinnedChatsByUserId: jest.fn(async () => [
      {
        chat_user_pinned_chat_id: 'pin-2',
        user_id: 'user-1',
        chat_id: 'chat-2',
        pinned_at: '2026-06-27T12:00:00.000Z',
      },
      {
        chat_user_pinned_chat_id: 'pin-1',
        user_id: 'user-1',
        chat_id: 'chat-1',
        pinned_at: '2026-06-27T11:00:00.000Z',
      },
    ]),
    clearPinnedChatsByUserIdAndChatIds: jest.fn(async () => true),
  } as unknown as ChatUserService & {
    listPinnedChatsByUserId: jest.Mock;
    clearPinnedChatsByUserIdAndChatIds: jest.Mock;
  };
  const chatService = {
    findChatByChatId: jest.fn(async (_accountId: string, chatId: string) => {
      return chatsById[chatId] ?? null;
    }),
  } as unknown as ChatService & {
    findChatByChatId: jest.Mock;
  };

  return {
    useCase: new ChatPinnedViewerUseCase(chatService, chatUserService),
    chatUserService,
    chatService,
  };
}

describe('ChatPinnedViewerUseCase', () => {
  it('returns pinned chats when they are open and readable', async () => {
    const { useCase, chatUserService } = buildUseCase({
      'chat-1': buildChat('chat-1'),
      'chat-2': buildChat('chat-2'),
    });

    await expect(
      useCase.execute(
        'account-1',
        'user-1',
        [buildAction(EGeneralPermissions.full_access)],
        [],
        []
      )
    ).resolves.toEqual([
      expect.objectContaining({ chat_id: 'chat-2' }),
      expect.objectContaining({ chat_id: 'chat-1' }),
    ]);

    expect(
      chatUserService.clearPinnedChatsByUserIdAndChatIds
    ).not.toHaveBeenCalled();
  });

  it('returns valid chats and clears stale pins', async () => {
    const { useCase, chatUserService } = buildUseCase({
      'chat-1': buildChat('chat-1', EChatStatus.closed),
      'chat-2': buildChat('chat-2'),
    });

    await expect(
      useCase.execute(
        'account-1',
        'user-1',
        [buildAction(EGeneralPermissions.full_access)],
        [],
        []
      )
    ).resolves.toEqual([expect.objectContaining({ chat_id: 'chat-2' })]);

    expect(
      chatUserService.clearPinnedChatsByUserIdAndChatIds
    ).toHaveBeenCalledWith('user-1', ['chat-1']);
  });

  it('clears a pin when the chat no longer exists', async () => {
    const { useCase, chatUserService } = buildUseCase({
      'chat-1': null,
      'chat-2': buildChat('chat-2'),
    });

    await expect(
      useCase.execute(
        'account-1',
        'user-1',
        [buildAction(EGeneralPermissions.full_access)],
        [],
        []
      )
    ).resolves.toEqual([expect.objectContaining({ chat_id: 'chat-2' })]);

    expect(
      chatUserService.clearPinnedChatsByUserIdAndChatIds
    ).toHaveBeenCalledWith('user-1', ['chat-1']);
  });

  it('clears a pin when the user cannot read the chat', async () => {
    const deniedChat = {
      ...buildChat('chat-1', EChatStatus.in_chat),
      user: { id: 'another-user', name: 'Other' },
      secondary_users: [],
      sector: { id: 'sector-2', name: 'Sector' },
    } as unknown as IChat;
    const { useCase, chatUserService } = buildUseCase({
      'chat-1': deniedChat,
      'chat-2': buildChat('chat-2'),
    });

    await expect(
      useCase.execute('account-1', 'user-1', [], ['sector-1'], [])
    ).resolves.toEqual([expect.objectContaining({ chat_id: 'chat-2' })]);

    expect(
      chatUserService.clearPinnedChatsByUserIdAndChatIds
    ).toHaveBeenCalledWith('user-1', ['chat-1']);
  });
});
