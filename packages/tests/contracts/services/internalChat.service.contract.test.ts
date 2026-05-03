import 'reflect-metadata';

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'uuid-v7'),
}));

jest.mock(
  '@core/repositories/internalChat/InternalChatConversation.repository',
  () => ({
    InternalChatConversationRepository: class InternalChatConversationRepository {},
  })
);

jest.mock(
  '@core/repositories/internalChat/InternalChatUser.repository',
  () => ({
    InternalChatUserRepository: class InternalChatUserRepository {},
  })
);

jest.mock(
  '@core/repositories/internalChat/InternalChatMessage.repository',
  () => ({
    InternalChatMessageRepository: class InternalChatMessageRepository {},
  })
);

jest.mock('@core/services/streamProducer.service', () => ({
  StreamProducerService: class StreamProducerService {},
}));

jest.mock('@core/services/kafkaServiceQueue.service', () => ({
  KafkaServiceQueueService: class KafkaServiceQueueService {},
}));

jest.mock('@core/services/storage.service', () => ({
  StorageService: class StorageService {},
}));

jest.mock('@core/services/centrifugo.service', () => ({
  CentrifugoService: class CentrifugoService {},
}));

jest.mock('@core/services/chatContact.service', () => ({
  ChatContactService: class ChatContactService {},
}));

import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { EInternalChatConversationType } from '@core/common/enums/internalChat/EInternalChatConversationType';
import { EInternalChatConversationParticipantRole } from '@core/common/enums/internalChat/EInternalChatConversationParticipantRole';
import { IInternalChatMessage } from '@core/common/interfaces/internalChat/IInternalChatMessage';
import { InternalChatService } from '@core/services/internalChat.service';

const accountId = 'account-1';
const conversationId = 'conversation-1';
const messageId = 'message-1';
const authorUserId = 'author-1';
const leaderUserId = 'leader-1';
const memberUserId = 'member-1';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const makeMessage = (
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
      message: 'original',
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

const makeGroupConversation = () => ({
  conversation_id: conversationId,
  account_id: accountId,
  type: EInternalChatConversationType.group,
  name: 'Group',
  photo: null,
  leader_user_id: leaderUserId,
  last_message_id: null,
  last_message_preview: null,
  last_message_at: null,
  created_at: '2026-05-02T09:00:00.000Z',
  updated_at: '2026-05-02T09:00:00.000Z',
});

const makeService = (options?: {
  message?: IInternalChatMessage;
  listMessages?: IInternalChatMessage[];
  isParticipant?: boolean;
}) => {
  const storedMessage = options?.message ?? makeMessage();
  const listMessages = options?.listMessages ?? [storedMessage];

  const conversationRepository = {
    isUserParticipant: jest
      .fn()
      .mockResolvedValue(options?.isParticipant ?? true),
    getConversationById: jest.fn().mockResolvedValue(makeGroupConversation()),
  };

  const messageRepository = {
    getMessageById: jest.fn().mockResolvedValue(clone(storedMessage)),
    updateMessage: jest.fn().mockResolvedValue(true),
    listMessages: jest.fn().mockResolvedValue({
      results: listMessages.map((message) => clone(message)),
      total: listMessages.length,
    }),
  };

  const centrifugoService = {
    publishSub: jest.fn().mockResolvedValue(undefined),
  };

  const service = new InternalChatService(
    conversationRepository as never,
    {} as never,
    messageRepository as never,
    {} as never,
    {} as never,
    {} as never,
    centrifugoService as never,
    {} as never
  );

  return {
    service,
    conversationRepository,
    messageRepository,
    centrifugoService,
  };
};

describe('InternalChatService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows the author to edit a text message and publishes a sanitized payload', async () => {
    const { service, messageRepository, centrifugoService } = makeService({
      message: makeMessage({
        content: {
          type: EMessageType.text,
          message: 'old text',
        },
      }),
    });

    await expect(
      service.editMessage(accountId, authorUserId, conversationId, messageId, {
        message: 'new text',
      })
    ).resolves.toBe(true);

    const updatedMessage = messageRepository.updateMessage.mock
      .calls[0][0] as IInternalChatMessage;

    expect(updatedMessage.content.message).toBe('new text');
    expect(updatedMessage.content.version).toEqual([
      expect.objectContaining({
        type: EMessageType.text,
        message: 'old text',
      }),
    ]);

    const realtimePayload = centrifugoService.publishSub.mock
      .calls[0][1] as IInternalChatMessage;

    expect(realtimePayload.content.message).toBe('new text');
    expect(realtimePayload.content.history_available).toBe(true);
    expect(realtimePayload.content.version).toBeUndefined();
  });

  it('denies group leaders editing messages from another author', async () => {
    const { service, messageRepository } = makeService();

    await expect(
      service.editMessage(accountId, leaderUserId, conversationId, messageId, {
        message: 'leader update',
      })
    ).rejects.toThrow('chat_access_denied');

    expect(messageRepository.updateMessage).not.toHaveBeenCalled();
  });

  it('denies group leaders deleting messages from another author', async () => {
    const { service, messageRepository } = makeService();

    await expect(
      service.deleteMessage(accountId, leaderUserId, conversationId, messageId)
    ).rejects.toThrow('chat_access_denied');

    expect(messageRepository.updateMessage).not.toHaveBeenCalled();
  });

  it('denies regular participants mutating messages from another author', async () => {
    const { service, messageRepository } = makeService();

    await expect(
      service.deleteMessage(accountId, memberUserId, conversationId, messageId)
    ).rejects.toThrow('chat_access_denied');

    expect(messageRepository.updateMessage).not.toHaveBeenCalled();
  });

  it('allows the author to delete a message and removes sensitive deleted content from realtime', async () => {
    const { service, messageRepository, centrifugoService } = makeService({
      message: makeMessage({
        content: {
          type: EMessageType.image,
          message: 'private caption',
          image: {
            url: 'https://example.com/private.jpg',
          } as never,
        },
      }),
    });

    await expect(
      service.deleteMessage(accountId, authorUserId, conversationId, messageId)
    ).resolves.toBe(true);

    const updatedMessage = messageRepository.updateMessage.mock
      .calls[0][0] as IInternalChatMessage;

    expect(updatedMessage.deleted).toBe(true);
    expect(updatedMessage.content.type).toBe(EMessageType.delete_message);
    expect(updatedMessage.content.version).toEqual([
      expect.objectContaining({
        type: EMessageType.image,
        message: 'private caption',
      }),
    ]);

    const realtimePayload = centrifugoService.publishSub.mock
      .calls[0][1] as IInternalChatMessage;

    expect(realtimePayload.content).toEqual({
      type: EMessageType.delete_message,
      message: null,
      reactions: null,
      history_available: true,
    });
  });

  it('allows authors and group leaders to view message history', async () => {
    const deletedMessage = makeMessage({
      deleted: true,
      content: {
        type: EMessageType.delete_message,
        message: null,
        version: [
          {
            type: EMessageType.text,
            message: 'deleted content',
            date: '2026-05-02T09:59:00.000Z',
          },
        ],
      },
    });

    const { service } = makeService({ message: deletedMessage });

    await expect(
      service.viewMessageHistory(
        accountId,
        authorUserId,
        conversationId,
        messageId
      )
    ).resolves.toEqual({
      results: [
        expect.objectContaining({
          kind: 'deleted_snapshot',
          message: 'deleted content',
          is_deleted_snapshot: true,
        }),
      ],
    });

    await expect(
      service.viewMessageHistory(
        accountId,
        leaderUserId,
        conversationId,
        messageId
      )
    ).resolves.toEqual({
      results: [
        expect.objectContaining({
          kind: 'deleted_snapshot',
          message: 'deleted content',
          is_deleted_snapshot: true,
        }),
      ],
    });
  });

  it('denies regular participants viewing history from another author', async () => {
    const { service } = makeService({
      message: makeMessage({
        content: {
          type: EMessageType.text,
          message: 'edited',
          version: [
            {
              type: EMessageType.text,
              message: 'original',
              date: '2026-05-02T09:59:00.000Z',
            },
          ],
        },
      }),
    });

    await expect(
      service.viewMessageHistory(
        accountId,
        memberUserId,
        conversationId,
        messageId
      )
    ).rejects.toThrow('chat_access_denied');
  });

  it('sanitizes listed messages and realtime messages without exposing history details', async () => {
    const editedMessage = makeMessage({
      message_id: 'edited-message',
      content: {
        type: EMessageType.text,
        message: 'edited',
        version: [
          {
            type: EMessageType.text,
            message: 'original',
            date: '2026-05-02T09:58:00.000Z',
          },
        ],
      },
    });
    const deletedMessage = makeMessage({
      message_id: 'deleted-message',
      deleted: true,
      content: {
        type: EMessageType.delete_message,
        message: null,
        image: {
          url: 'https://example.com/private.jpg',
        } as never,
        version: [
          {
            type: EMessageType.image,
            message: 'private caption',
            date: '2026-05-02T09:59:00.000Z',
          },
        ],
      },
    });

    const { service, centrifugoService } = makeService({
      listMessages: [editedMessage, deletedMessage],
    });

    const response = await service.listMessages(
      accountId,
      memberUserId,
      conversationId,
      { current_page: 1, per_page: 20 }
    );

    expect(response.results[0].content.history_available).toBe(true);
    expect(response.results[0].content.version).toBeUndefined();
    expect(response.results[1].content).toEqual({
      type: EMessageType.delete_message,
      message: null,
      reactions: null,
      history_available: true,
    });

    await service.publishMessageRealtime(deletedMessage);

    const realtimePayload = centrifugoService.publishSub.mock
      .calls[0][1] as IInternalChatMessage;

    expect(realtimePayload.content).toEqual({
      type: EMessageType.delete_message,
      message: null,
      reactions: null,
      history_available: true,
    });
  });
});
