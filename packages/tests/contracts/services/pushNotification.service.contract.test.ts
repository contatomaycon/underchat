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
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { IChat } from '@core/common/interfaces/IChat';
import { IInternalChatMessage } from '@core/common/interfaces/internalChat/IInternalChatMessage';
import { PushNotificationService } from '@core/services/pushNotification.service';
import webPush from 'web-push';

const accountId = 'account-1';
const conversationId = 'conversation-1';
const messageId = 'message-1';
const authorUserId = 'author-1';
const memberUserId = 'member-1';
const actorUserId = 'actor-1';
const targetUserId = 'target-1';

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

const makeChat = (overrides: Partial<IChat> = {}): IChat => {
  const base: IChat = {
    chat_id: 'chat-1',
    account: {
      id: accountId,
      name: 'Account',
    },
    worker: {
      id: 'worker-1',
      name: 'WhatsApp',
    },
    sector: {
      id: 'sector-1',
      name: 'Suporte',
    },
    user: {
      id: targetUserId,
      name: 'Target',
      photo: null,
    },
    secondary_users: [],
    contact: {
      id: 'contact-1',
      name: 'Contact',
      phone: '5511999999999',
      photo: null,
    },
    photo: null,
    name: 'Contact',
    phone: '5511999999999',
    status: EChatStatus.in_chat,
    date: '2026-05-02T10:00:00.000Z',
    summary: {
      last_message: 'Oi',
      last_date: '2026-05-02T10:00:00.000Z',
      unread_count: 1,
    },
    started_at: '2026-05-02T10:00:00.000Z',
    closed_at: null,
    protocol_ura: null,
    protocol_start: null,
    protocol_transfer: null,
    label: null,
    forward_to_output_chatbot: null,
  };

  return {
    ...base,
    ...overrides,
  };
};

function makeService(eligibleUserIds: string[] = [memberUserId]) {
  const usersWithNotificationsListerRepository = {
    listInternalChatUsersWithNotifications: jest
      .fn()
      .mockResolvedValue(eligibleUserIds),
    listUsersWithTransferNotifications: jest.fn().mockResolvedValue([]),
    listUsersWithNotifications: jest.fn().mockResolvedValue([]),
  };

  const service = new PushNotificationService(
    { listByUserId: jest.fn() } as never,
    { deleteByEndpoint: jest.fn() } as never,
    usersWithNotificationsListerRepository as never,
    { listUserSectors: jest.fn() } as never,
    { listChannelsWithNamesByUserAndAccount: jest.fn() } as never,
    {
      viewPermissionByUserId: jest
        .fn()
        .mockResolvedValue([EGeneralPermissions.full_access]),
    } as never
  );

  const sendNotificationToUser = jest
    .spyOn(service, 'sendNotificationToUser')
    .mockResolvedValue({ sent: 1, failed: 0, queued: 0 });

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

describe('PushNotificationService delivery routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function makeRoutingService(input: {
    subscriptions: unknown[];
    nativeConfigured?: boolean;
  }) {
    const queue = {
      enqueue: jest.fn(async () => 'job-1'),
      isProviderConfigured: jest.fn((provider: string) =>
        provider === 'fcm' || provider === 'apns'
          ? input.nativeConfigured === true
          : true
      ),
    };

    const service = new PushNotificationService(
      {
        listByUserId: jest.fn().mockResolvedValue(input.subscriptions),
      } as never,
      { deleteByEndpoint: jest.fn() } as never,
      {
        listInternalChatUsersWithNotifications: jest.fn().mockResolvedValue([]),
        listUsersWithTransferNotifications: jest.fn().mockResolvedValue([]),
        listUsersWithNotifications: jest.fn().mockResolvedValue([]),
      } as never,
      { listUserSectors: jest.fn() } as never,
      { listChannelsWithNamesByUserAndAccount: jest.fn() } as never,
      { viewPermissionByUserId: jest.fn().mockResolvedValue([]) } as never,
      queue as never
    );

    return { service, queue };
  }

  it('prefers fcm over expo for android when native provider is configured', async () => {
    const { service, queue } = makeRoutingService({
      nativeConfigured: true,
      subscriptions: [
        {
          provider: 'expo',
          platform: 'android',
          endpoint: 'ExpoPushToken[android]',
        },
        {
          provider: 'fcm',
          platform: 'android',
          endpoint: 'fcm-token',
        },
      ],
    });

    await expect(
      service.sendNotificationToUser('user-1', {
        title: 'Title',
        body: 'Body',
      })
    ).resolves.toEqual({ sent: 0, failed: 0, queued: 1 });

    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'fcm',
        endpoint: 'fcm-token',
        fallbackExpoEndpoint: 'ExpoPushToken[android]',
      })
    );
  });

  it('falls back to expo when native provider is not configured', async () => {
    const { service, queue } = makeRoutingService({
      nativeConfigured: false,
      subscriptions: [
        {
          provider: 'expo',
          platform: 'ios',
          endpoint: 'ExpoPushToken[ios]',
        },
        {
          provider: 'apns',
          platform: 'ios',
          endpoint: 'apns-token',
        },
      ],
    });

    await expect(
      service.sendNotificationToUser('user-1', {
        title: 'Title',
        body: 'Body',
      })
    ).resolves.toEqual({ sent: 0, failed: 0, queued: 1 });

    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'expo',
        endpoint: 'ExpoPushToken[ios]',
      })
    );
  });

  it('sends webpush directly without queueing it', async () => {
    const { service, queue } = makeRoutingService({
      subscriptions: [
        {
          provider: 'webpush',
          endpoint: 'https://push.endpoint',
          p256dh: 'p256dh',
          auth: 'auth',
        },
      ],
    });
    (service as unknown as { vapidKeys: unknown }).vapidKeys = {
      publicKey: 'public',
      privateKey: 'private',
    };
    (webPush.sendNotification as jest.Mock).mockResolvedValue(undefined);

    await expect(
      service.sendNotificationToUser('user-1', {
        title: 'Title',
        body: 'Body',
      })
    ).resolves.toEqual({ sent: 1, failed: 0, queued: 0 });

    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(webPush.sendNotification).toHaveBeenCalledTimes(1);
  });
});

describe('PushNotificationService chat transfer notifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('excludes the actor, filters transfer preferences and sends a transfer payload', async () => {
    const {
      service,
      usersWithNotificationsListerRepository,
      sendNotificationToUser,
    } = makeService();
    usersWithNotificationsListerRepository.listUsersWithTransferNotifications.mockResolvedValue(
      [targetUserId]
    );
    const chat = makeChat();

    await service.sendNotificationForChatTransfer({
      chat,
      actorUserId,
      candidateUserIds: [actorUserId, targetUserId, targetUserId],
      targetUserName: 'Target',
      targetSectorName: 'Suporte',
      targetWorkerName: 'WhatsApp',
    });

    expect(
      usersWithNotificationsListerRepository.listUsersWithTransferNotifications
    ).toHaveBeenCalledWith(accountId, [targetUserId]);
    expect(sendNotificationToUser).toHaveBeenCalledWith(
      targetUserId,
      expect.objectContaining({
        title: 'Contact',
        body: 'Atendimento transferido para Target - Suporte - WhatsApp',
        tag: 'chat-transfer-chat-1',
        data: expect.objectContaining({
          chatId: 'chat-1',
          notificationType: 'chat_transfer',
          transferTarget: {
            userName: 'Target',
            sectorName: 'Suporte',
            workerName: 'WhatsApp',
          },
        }),
      })
    );
  });

  it('does not query transfer preferences when only the actor is a candidate', async () => {
    const {
      service,
      usersWithNotificationsListerRepository,
      sendNotificationToUser,
    } = makeService();

    await service.sendNotificationForChatTransfer({
      chat: makeChat(),
      actorUserId,
      candidateUserIds: [actorUserId],
    });

    expect(
      usersWithNotificationsListerRepository.listUsersWithTransferNotifications
    ).not.toHaveBeenCalled();
    expect(sendNotificationToUser).not.toHaveBeenCalled();
  });
});
