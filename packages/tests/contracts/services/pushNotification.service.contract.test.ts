import 'reflect-metadata';

jest.mock('web-push', () => ({
  __esModule: true,
  default: {
    setVapidDetails: jest.fn(),
    sendNotification: jest.fn(),
  },
}));

jest.mock('@core/services/permission.service', () => ({
  PermissionService: class PermissionService {},
}));

import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { EInternalChatConversationType } from '@core/common/enums/internalChat/EInternalChatConversationType';
import { IInternalChatMessage } from '@core/common/interfaces/internalChat/IInternalChatMessage';
import { PushNotificationService } from '@core/services/pushNotification.service';

const accountId = 'account-1';
const conversationId = 'conversation-1';
const messageId = 'message-1';
const authorUserId = 'author-1';
const memberUserId = 'member-1';

const makeInternalMessage = (
  overrides: Partial<IInternalChatMessage> = {}
): IInternalChatMessage => {
  const base: IInternalChatMessage = {
    message_id: messageId,
    conversation_id: conversationId,
    account_id: accountId,
    type_user: ETypeUserChat.operator,
    user: {
      id: authorUserId,
      name: 'Author',
      photo: null,
    },
    content: {
      type: EMessageType.text,
      message: 'hello',
    },
    date: '2026-05-02T10:00:00.000Z',
    deleted: false,
    hash: 'hash-1',
  };

  return {
    ...base,
    ...overrides,
    user: overrides.user === undefined ? base.user : overrides.user,
    content: {
      ...base.content,
      ...(overrides.content ?? {}),
    },
  };
};

function makeService(eligibleUserIds: string[] = [memberUserId]) {
  const usersWithNotificationsListerRepository = {
    listInternalChatUsersWithNotifications: jest
      .fn()
      .mockResolvedValue(eligibleUserIds),
  };

  const service = new PushNotificationService(
    { listByUserId: jest.fn() } as never,
    { deleteByEndpoint: jest.fn() } as never,
    usersWithNotificationsListerRepository as never,
    { listUserSectors: jest.fn() } as never,
    { listChannelsWithNamesByUserAndAccount: jest.fn() } as never,
    { viewPermissionByUserId: jest.fn() } as never
  );

  const sendNotificationToUser = jest
    .spyOn(service, 'sendNotificationToUser')
    .mockResolvedValue({ sent: 1, failed: 0 });

  return {
    service,
    usersWithNotificationsListerRepository,
    sendNotificationToUser,
  };
}

describe('PushNotificationService internal chat notifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('excludes the sender, filters by internal chat preferences and sends the internal payload', async () => {
    const {
      service,
      usersWithNotificationsListerRepository,
      sendNotificationToUser,
    } = makeService([memberUserId]);
    const message = makeInternalMessage();

    await service.sendNotificationForInternalChatMessage({
      message,
      conversationType: EInternalChatConversationType.group,
      participantUserIds: [authorUserId, memberUserId, 'member-2'],
      conversationName: 'Squad',
      conversationPhoto: 'https://example.com/group.png',
    });

    expect(
      usersWithNotificationsListerRepository.listInternalChatUsersWithNotifications
    ).toHaveBeenCalledWith(
      accountId,
      [memberUserId, 'member-2'],
      EInternalChatConversationType.group
    );
    expect(sendNotificationToUser).toHaveBeenCalledWith(
      memberUserId,
      expect.objectContaining({
        title: 'Squad',
        body: 'Author: hello',
        icon: 'https://example.com/group.png',
        tag: `internal-chat-${conversationId}`,
        data: {
          notificationType: 'internal_chat_message',
          internalChatConversationId: conversationId,
          internalChatMessageId: messageId,
          internalChatConversationType: EInternalChatConversationType.group,
        },
      })
    );
  });

  it('does not notify deleted or system internal messages', async () => {
    const {
      service,
      usersWithNotificationsListerRepository,
      sendNotificationToUser,
    } = makeService();

    await service.sendNotificationForInternalChatMessage({
      message: makeInternalMessage({ deleted: true }),
      conversationType: EInternalChatConversationType.direct,
      participantUserIds: [memberUserId],
    });

    await service.sendNotificationForInternalChatMessage({
      message: makeInternalMessage({
        type_user: ETypeUserChat.system,
        user: null,
        content: {
          type: EMessageType.system,
          message: 'internal_chat_system_group_created',
        },
      }),
      conversationType: EInternalChatConversationType.group,
      participantUserIds: [memberUserId],
    });

    expect(
      usersWithNotificationsListerRepository.listInternalChatUsersWithNotifications
    ).not.toHaveBeenCalled();
    expect(sendNotificationToUser).not.toHaveBeenCalled();
  });
});
