import 'reflect-metadata';

const mockWithLock = jest.fn(
  async (_redis: unknown, _key: string, callback: () => Promise<unknown>) =>
    callback()
);

jest.mock('@core/common/functions/withLock', () => ({
  withLock: mockWithLock,
}));

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
}));

import { EChatStatus } from '@core/common/enums/EChatStatus';
import type { IChat } from '@core/common/interfaces/IChat';
import { ChatLifecycleService } from '@core/services/chatLifecycle.service';

interface TestPatchOptions {
  eventEpochMillis: number;
  eventId: string;
  statusSource: string;
  enforceExpectedStatusRevision?: boolean;
  enforceExpectedStartedAt?: boolean;
}

describe('ChatLifecycleService', () => {
  const makeChat = (overrides: Partial<IChat> = {}): IChat => ({
    chat_id: 'chat-1',
    account: { id: 'account-1', name: 'Account' },
    worker: { id: 'worker-1', name: 'Worker' },
    name: 'Contact',
    phone: '5511999999999',
    status: EChatStatus.in_chat,
    date: '2026-07-09T12:00:00.000Z',
    started_at: '2026-07-09T11:00:00.000Z',
    user: { id: 'user-1', name: 'Operator' },
    summary: {
      last_message: 'Last message',
      last_message_id: 'message-1',
      last_date: '2026-07-09T11:59:00.000Z',
      unread_count: 2,
    },
    forward_to_output_chatbot: true,
    ...overrides,
  });

  const makeService = () => {
    const chatService = {
      findChatByChatId: jest.fn<Promise<IChat | null>, [string, string]>(),
      applyChatPatch: jest.fn<
        Promise<boolean>,
        [string, Record<string, unknown>, TestPatchOptions]
      >(async () => true),
      invalidateChatCache: jest.fn<Promise<void>, [IChat]>(
        async () => undefined
      ),
    };
    const workerConfigService = {
      viewChatbots: jest.fn<
        Promise<{ enabled: boolean; output_chatbot_id: string | null }>,
        [string]
      >(async () => ({ enabled: false, output_chatbot_id: null })),
    };
    const chatUserService = {
      clearPinnedChatsByChatId: jest.fn<Promise<boolean>, [string]>(
        async () => true
      ),
    };
    const centrifugoService = {
      publishSubImmediate: jest.fn<
        Promise<Record<string, never>>,
        [string, IChat]
      >(async () => ({})),
    };
    const service = new ChatLifecycleService(
      {} as never,
      chatService as never,
      workerConfigService as never,
      chatUserService as never,
      centrifugoService as never
    );

    return {
      service,
      chatService,
      workerConfigService,
      chatUserService,
      centrifugoService,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('confirms a closed transition before publishing and preserves assignment fields', async () => {
    const currentChat = makeChat();
    const { service, chatService, chatUserService, centrifugoService } =
      makeService();
    let confirmedChat = currentChat;

    chatService.findChatByChatId.mockImplementation(async () => confirmedChat);
    chatService.applyChatPatch.mockImplementation(
      async (
        _chatId: string,
        patch: Record<string, unknown>,
        options: TestPatchOptions
      ) => {
        confirmedChat = makeChat({
          ...patch,
          meta: {
            status_epoch: options.eventEpochMillis,
            status_event_id: options.eventId,
            status_source: options.statusSource,
          },
          summary: {
            ...(currentChat.summary ?? {
              last_message: null,
              last_date: null,
              unread_count: 0,
            }),
            unread_count: 0,
          },
        });
        return true;
      }
    );

    const result = await service.finishChat({
      chat: currentChat,
      source: 'chatbot',
      expectedStatuses: [EChatStatus.in_chat],
      respectOutputChatbot: false,
    });

    expect(result).toEqual(
      expect.objectContaining({
        outcome: 'applied',
        targetStatus: EChatStatus.closed,
        ownedBySource: true,
        statusEventId: expect.any(String),
      })
    );
    expect(result.chat.user).toEqual(currentChat.user);
    expect(result.chat.started_at).toBe(currentChat.started_at);
    expect(result.chat.summary?.unread_count).toBe(0);
    expect(chatService.applyChatPatch).toHaveBeenCalledWith(
      currentChat.chat_id,
      expect.objectContaining({
        status: EChatStatus.closed,
        closed_at: expect.any(String),
      }),
      expect.objectContaining({
        allowCreate: false,
        refresh: true,
        expectedCurrentStatuses: [EChatStatus.in_chat],
        allowHumanToAutomation: false,
        clearUnreadCount: true,
        statusSource: 'chatbot',
        enforceExpectedStatusRevision: true,
        enforceExpectedStartedAt: true,
        enforceExpectedLastMessageId: true,
        enforceExpectedSummaryRevision: true,
        expectedStatusEventId: null,
        expectedStatusEpoch: null,
        expectedStartedAt: currentChat.started_at,
        expectedLastMessageId: 'message-1',
        expectedSummaryRevision: 0,
      })
    );
    expect(chatService.applyChatPatch.mock.calls[0][1]).not.toHaveProperty(
      'user'
    );
    expect(chatService.applyChatPatch.mock.calls[0][1]).not.toHaveProperty(
      'started_at'
    );
    expect(chatUserService.clearPinnedChatsByChatId).toHaveBeenCalledWith(
      currentChat.chat_id
    );
    expect(centrifugoService.publishSubImmediate).toHaveBeenCalledTimes(2);
    const lastPublishOrder = Math.max(
      ...centrifugoService.publishSubImmediate.mock.invocationCallOrder
    );
    expect(lastPublishOrder).toBeLessThan(
      chatService.invalidateChatCache.mock.invocationCallOrder[0]
    );
    expect(lastPublishOrder).toBeLessThan(
      chatUserService.clearPinnedChatsByChatId.mock.invocationCallOrder[0]
    );
  });

  it('atomically routes human attendance to an enabled output chatbot', async () => {
    const currentChat = makeChat();
    const {
      service,
      chatService,
      workerConfigService,
      chatUserService,
      centrifugoService,
    } = makeService();
    let confirmedChat = currentChat;

    workerConfigService.viewChatbots.mockResolvedValue({
      enabled: true,
      output_chatbot_id: 'chatbot-output-1',
    });
    chatService.findChatByChatId.mockImplementation(async () => confirmedChat);
    chatService.applyChatPatch.mockImplementation(
      async (
        _chatId: string,
        patch: Record<string, unknown>,
        options: TestPatchOptions
      ) => {
        confirmedChat = makeChat({
          ...patch,
          meta: {
            status_epoch: options.eventEpochMillis,
            status_event_id: options.eventId,
            status_source: options.statusSource,
          },
        });
        return true;
      }
    );

    const result = await service.finishChat({
      chat: currentChat,
      source: 'attendance_inactivity',
      expectedStatuses: [EChatStatus.in_chat],
      respectOutputChatbot: true,
    });

    expect(result.outcome).toBe('applied');
    expect(result.targetStatus).toBe(EChatStatus.ura_output);
    expect(result.chat.forward_to_output_chatbot).toBe(false);
    expect(chatService.applyChatPatch).toHaveBeenCalledWith(
      currentChat.chat_id,
      {
        status: EChatStatus.ura_output,
        forward_to_output_chatbot: false,
      },
      expect.objectContaining({
        expectedCurrentStatuses: [EChatStatus.in_chat],
        allowHumanToAutomation: true,
        clearUnreadCount: false,
      })
    );
    expect(chatUserService.clearPinnedChatsByChatId).not.toHaveBeenCalled();
    expect(centrifugoService.publishSubImmediate).toHaveBeenCalledTimes(2);
  });

  it('does not treat an Elasticsearch noop boolean as proof of transition', async () => {
    const currentChat = makeChat();
    const { service, chatService, centrifugoService } = makeService();
    chatService.findChatByChatId.mockResolvedValue(currentChat);
    chatService.applyChatPatch.mockResolvedValue(true);

    const result = await service.finishChat({
      chat: currentChat,
      source: 'chatbot',
      expectedStatuses: [EChatStatus.in_chat],
      respectOutputChatbot: false,
    });

    expect(result.outcome).toBe('retryable_failure');
    expect(result.ownedBySource).toBe(false);
    expect(centrifugoService.publishSubImmediate).not.toHaveBeenCalled();
  });

  it('reports a status mismatch without overwriting a concurrent transition', async () => {
    const queuedChat = makeChat({ status: EChatStatus.queue });
    const { service, chatService, centrifugoService } = makeService();
    chatService.findChatByChatId.mockResolvedValue(queuedChat);

    const result = await service.finishChat({
      chat: queuedChat,
      source: 'outside_hours',
      expectedStatuses: [EChatStatus.in_chat],
      respectOutputChatbot: false,
    });

    expect(result.outcome).toBe('status_mismatch');
    expect(chatService.applyChatPatch).not.toHaveBeenCalled();
    expect(centrifugoService.publishSubImmediate).not.toHaveBeenCalled();
  });

  it('rejects an ABA transition when the status is equal but revision changed', async () => {
    const staleChat = makeChat({
      meta: {
        status_epoch: 1,
        status_event_id: 'session-old',
        status_source: 'chat_service',
      },
    });
    const reopenedChat = makeChat({
      meta: {
        status_epoch: 2,
        status_event_id: 'session-new',
        status_source: 'chat_service',
      },
    });
    const { service, chatService, centrifugoService } = makeService();
    chatService.findChatByChatId.mockResolvedValue(reopenedChat);

    const result = await service.finishChat({
      chat: staleChat,
      source: 'attendance_inactivity',
      expectedStatuses: [EChatStatus.in_chat],
      respectOutputChatbot: false,
      statusEventId: 'close-old-session',
    });

    expect(result.outcome).toBe('status_mismatch');
    expect(chatService.applyChatPatch).not.toHaveBeenCalled();
    expect(centrifugoService.publishSubImmediate).not.toHaveBeenCalled();
  });

  it('rejects a transition when a newer message appears before the lock is acquired', async () => {
    const inputChat = makeChat({
      summary: {
        ...(makeChat().summary as NonNullable<IChat['summary']>),
        last_message_id: 'message-before-finalization',
      },
    });
    const currentChat = makeChat({
      summary: {
        ...(makeChat().summary as NonNullable<IChat['summary']>),
        last_message_id: 'new-human-message',
      },
    });
    const { service, chatService, centrifugoService } = makeService();
    chatService.findChatByChatId.mockResolvedValue(currentChat);

    const result = await service.finishChat({
      chat: inputChat,
      source: 'chatbot',
      expectedStatuses: [EChatStatus.in_chat],
      respectOutputChatbot: false,
    });

    expect(result.outcome).toBe('status_mismatch');
    expect(chatService.applyChatPatch).not.toHaveBeenCalled();
    expect(centrifugoService.publishSubImmediate).not.toHaveBeenCalled();
  });

  it('does not own a closed event from another attempt with the same source', async () => {
    const closedChat = makeChat({
      status: EChatStatus.closed,
      meta: {
        status_epoch: 3,
        status_event_id: 'close-new-session',
        status_source: 'chatbot',
      },
    });
    const { service, chatService, centrifugoService } = makeService();
    chatService.findChatByChatId.mockResolvedValue(closedChat);

    const result = await service.finishChat({
      chat: closedChat,
      source: 'chatbot',
      expectedStatuses: [EChatStatus.ura],
      respectOutputChatbot: false,
      statusEventId: 'close-old-session',
    });

    expect(result.outcome).toBe('already_at_target');
    expect(result.ownedBySource).toBe(false);
    expect(centrifugoService.publishSubImmediate).not.toHaveBeenCalled();
  });

  it('resumes internal effects for an owned idempotent retry', async () => {
    const closedChat = makeChat({
      status: EChatStatus.closed,
      closed_at: '2026-07-09T12:10:00.000Z',
      meta: {
        status_epoch: 1783599000000,
        status_event_id: 'status-event-1',
        status_source: 'chatbot',
      },
    });
    const { service, chatService, chatUserService, centrifugoService } =
      makeService();
    chatService.findChatByChatId.mockResolvedValue(closedChat);

    const result = await service.finishChat({
      chat: closedChat,
      source: 'chatbot',
      expectedStatuses: [EChatStatus.in_chat],
      respectOutputChatbot: false,
    });

    expect(result).toEqual(
      expect.objectContaining({
        outcome: 'already_at_target',
        statusEventId: 'status-event-1',
        ownedBySource: true,
      })
    );
    expect(chatService.applyChatPatch).not.toHaveBeenCalled();
    expect(chatService.invalidateChatCache).toHaveBeenCalledWith(closedChat);
    expect(chatUserService.clearPinnedChatsByChatId).toHaveBeenCalledWith(
      closedChat.chat_id
    );
    expect(centrifugoService.publishSubImmediate).toHaveBeenCalledTimes(2);
  });

  it('returns a retryable failure if publication fails after persistence', async () => {
    const currentChat = makeChat();
    const { service, chatService, centrifugoService } = makeService();
    let confirmedChat = currentChat;
    chatService.findChatByChatId.mockImplementation(async () => confirmedChat);
    chatService.applyChatPatch.mockImplementation(
      async (
        _chatId: string,
        patch: Record<string, unknown>,
        options: TestPatchOptions
      ) => {
        confirmedChat = makeChat({
          ...patch,
          meta: {
            status_epoch: options.eventEpochMillis,
            status_event_id: options.eventId,
            status_source: options.statusSource,
          },
        });
        return true;
      }
    );
    centrifugoService.publishSubImmediate.mockRejectedValue(
      new Error('centrifugo unavailable')
    );

    const result = await service.finishChat({
      chat: currentChat,
      source: 'chatbot',
      expectedStatuses: [EChatStatus.in_chat],
      respectOutputChatbot: false,
    });

    expect(result.outcome).toBe('retryable_failure');
    expect(result.chat.status).toBe(EChatStatus.closed);
    expect(result.ownedBySource).toBe(true);
  });
});
