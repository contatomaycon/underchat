import 'reflect-metadata';

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
  proto: {},
}));

jest.mock('@core/common/functions/withLock', () => ({
  withLock: jest.fn(async (_redis, _key, fn: () => Promise<unknown>) => fn()),
}));

// This contract does not exercise document extraction. Mocking the service
// keeps the native canvas binding pulled by pdf-parse out of the Jest process.
jest.mock('@core/services/promptDocumentExtractor.service', () => ({
  PromptDocumentExtractorService: class PromptDocumentExtractorService {},
}));

jest.mock('uuid', () => {
  const v5 = Object.assign(
    jest.fn((value: string) => `uuid-v5-${value}`),
    { URL: 'uuid-v5-url-namespace' }
  );

  return {
    v5,
    v7: jest.fn(() => 'status-event-1'),
  };
});

import { ChatbotFlowRunnerService } from '@core/services/chatbotFlowRunner.service';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { EContactIgnore } from '@core/common/enums/EContactIgnore';
import type { IChat } from '@core/common/interfaces/IChat';
import type { IInactivityData } from '@core/common/interfaces/IInactivityData';
import type { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';
import type { ListChatbotFlowResponse } from '@core/schema/chatbot/listChatbotFlow/response.schema';

interface RedisOperation {
  command: 'set' | 'zadd' | 'del' | 'zrem';
  args: unknown[];
}

interface RedisTransaction {
  set: (...args: unknown[]) => RedisTransaction;
  zadd: (...args: unknown[]) => RedisTransaction;
  del: (...args: unknown[]) => RedisTransaction;
  zrem: (...args: unknown[]) => RedisTransaction;
  exec: () => Promise<Array<[null, string]>>;
}

interface LifecycleMockResult {
  outcome:
    'applied' | 'already_at_target' | 'status_mismatch' | 'retryable_failure';
  targetStatus: EChatStatus;
  chat: IChat;
  statusEventId: string;
  ownedBySource: boolean;
}

const makeChat = (status: EChatStatus = EChatStatus.ura): IChat =>
  ({
    chat_id: 'chat-1',
    status,
    name: 'Client',
    account: { id: 'account-1', name: 'Account' },
    worker: { id: 'worker-1', name: 'Worker' },
    user: null,
    sector: null,
    contact: null,
    date: '2026-07-09T12:00:00.000Z',
  }) as unknown as IChat;

const makeFinishFlow = (): ListChatbotFlowResponse =>
  ({
    chatbot_flow_id: 'flow-1',
    chatbot_id: 'chatbot-1',
    account_id: 'account-1',
    nodes: [
      {
        id: 'finish-node',
        type: 'finish',
        position: { x: 0, y: 0 },
        data: {},
      },
    ],
    edges: [],
    created_at: '2026-07-09T12:00:00.000Z',
    updated_at: '2026-07-09T12:00:00.000Z',
  }) as ListChatbotFlowResponse;

const makeHarness = () => {
  const transactions: RedisOperation[][] = [];
  const createTransaction = (): RedisTransaction => {
    const operations: RedisOperation[] = [];
    const transaction = {} as RedisTransaction;

    transaction.set = (...args: unknown[]): RedisTransaction => {
      operations.push({ command: 'set', args });
      return transaction;
    };
    transaction.zadd = (...args: unknown[]): RedisTransaction => {
      operations.push({ command: 'zadd', args });
      return transaction;
    };
    transaction.del = (...args: unknown[]): RedisTransaction => {
      operations.push({ command: 'del', args });
      return transaction;
    };
    transaction.zrem = (...args: unknown[]): RedisTransaction => {
      operations.push({ command: 'zrem', args });
      return transaction;
    };
    transaction.exec = async (): Promise<Array<[null, string]>> => {
      transactions.push([...operations]);
      return operations.map(() => [null, 'OK']);
    };

    return transaction;
  };

  const redis = {
    get: jest.fn<Promise<string | null>, [string]>(async () => null),
    set: jest.fn(async () => 'OK'),
    del: jest.fn(async () => 1),
    zadd: jest.fn(async () => 1),
    zrem: jest.fn(async () => 1),
    zrangebyscore: jest.fn<Promise<string[]>, unknown[]>(async () => []),
    zscore: jest.fn<Promise<string | null>, unknown[]>(async () => '0'),
    zscan: jest.fn(async () => ['0', []]),
    scan: jest.fn(async () => ['0', []]),
    persist: jest.fn(async () => 1),
    multi: jest.fn(createTransaction),
    pipeline: jest.fn(() => ({
      exists: jest.fn().mockReturnThis(),
      persist: jest.fn().mockReturnThis(),
      exec: jest.fn(async () => []),
    })),
  };
  const chatbotService = {
    findChatbotFlowByChatbotId: jest.fn<
      Promise<ListChatbotFlowResponse | null>,
      unknown[]
    >(async () => null),
    findChatbotFlowConfigurationsByChatbotId: jest.fn<
      Promise<unknown>,
      unknown[]
    >(async () => null),
  };
  const chat = makeChat();
  const closedChat = {
    ...chat,
    status: EChatStatus.closed,
    closed_at: '2026-07-09T12:01:00.000Z',
    meta: {
      status_epoch: 1,
      status_event_id: 'status-event-1',
      status_source: 'chatbot',
    },
  } as IChat;
  const chatService = {
    findChatByChatId: jest.fn<Promise<IChat | null>, unknown[]>(
      async () => chat
    ),
  };
  const lifecycleEvents: string[] = [];
  const chatLifecycleService = {
    finishChat: jest.fn<Promise<LifecycleMockResult>, unknown[]>(async () => {
      lifecycleEvents.push('finish');
      return {
        outcome: 'applied',
        targetStatus: EChatStatus.closed,
        chat: closedChat,
        statusEventId: 'status-event-1',
        ownedBySource: true,
      };
    }),
  };
  const chatMessageService = {
    sendMessage: jest.fn(async () => {
      lifecycleEvents.push('send');
      return true;
    }),
  };
  const contactService = {
    getContactByPhone: jest.fn(async () => null),
    updateContactById: jest.fn<Promise<boolean>, unknown[]>(async () => true),
  };
  const centrifugoService = {
    publishSub: jest.fn(async () => ({})),
  };
  const officialWhatsappConversationWindowService = {
    resolveAuthoritativeForChat: jest.fn(async () => ({
      state: 'open',
      can_send_freeform: true,
    })),
  };

  const dependencies = [
    redis as never,
    chatbotService as never,
    chatService as never,
    chatLifecycleService as never,
    chatMessageService as never,
    contactService as never,
    {} as never,
    centrifugoService as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  ] satisfies ConstructorParameters<typeof ChatbotFlowRunnerService>;

  const service = new ChatbotFlowRunnerService(...dependencies);
  (
    service as unknown as {
      officialWhatsappConversationWindowService: typeof officialWhatsappConversationWindowService;
    }
  ).officialWhatsappConversationWindowService =
    officialWhatsappConversationWindowService;

  return {
    service,
    redis,
    chatbotService,
    chatService,
    chatLifecycleService,
    chatMessageService,
    contactService,
    centrifugoService,
    officialWhatsappConversationWindowService,
    chat,
    closedChat,
    lifecycleEvents,
    transactions,
  };
};

const translate = ((key: string): string => key) as never;

describe('ChatbotFlowRunnerService automatic closure contract', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('confirms and publishes the closed state before sending the final message', async () => {
    const {
      service,
      chat,
      closedChat,
      chatService,
      chatLifecycleService,
      chatMessageService,
      lifecycleEvents,
      transactions,
    } = makeHarness();
    chatService.findChatByChatId
      .mockResolvedValueOnce(chat)
      .mockResolvedValueOnce(closedChat);

    const result = await (
      service as unknown as {
        sendFinishMessage: (
          t: never,
          createChat: IChat,
          message: string,
          enabled: boolean
        ) => Promise<boolean>;
      }
    ).sendFinishMessage(translate, chat, 'Atendimento finalizado', true);

    expect(result).toBe(true);
    expect(lifecycleEvents).toEqual(['finish', 'send']);
    expect(chatLifecycleService.finishChat).toHaveBeenCalledWith({
      chat,
      source: 'chatbot',
      expectedStatuses: expect.arrayContaining([
        EChatStatus.ura,
        EChatStatus.ura_output,
      ]),
      respectOutputChatbot: false,
      statusEventId: 'status-event-1',
    });
    expect(chatMessageService.sendMessage).toHaveBeenCalledWith(
      translate,
      expect.objectContaining({
        chat: closedChat,
        accountId: 'account-1',
        messageId: 'status-event-1',
        message: 'Atendimento finalizado',
      })
    );
    expect(transactions.at(-1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: 'del' }),
        expect.objectContaining({ command: 'zrem' }),
      ])
    );
  });

  it('does not send or clear runtime state when closing was not confirmed', async () => {
    const {
      service,
      chat,
      chatLifecycleService,
      chatMessageService,
      transactions,
    } = makeHarness();
    chatLifecycleService.finishChat.mockResolvedValueOnce({
      outcome: 'retryable_failure',
      targetStatus: EChatStatus.closed,
      chat,
      statusEventId: 'status-event-1',
      ownedBySource: false,
    });

    const result = await (
      service as unknown as {
        sendFinishMessage: (
          t: never,
          createChat: IChat,
          message: string,
          enabled: boolean
        ) => Promise<boolean>;
      }
    ).sendFinishMessage(translate, chat, 'Atendimento finalizado', true);

    expect(result).toBe(false);
    expect(chatMessageService.sendMessage).not.toHaveBeenCalled();
    expect(transactions).toHaveLength(1);
    expect(transactions.at(-1)?.map(({ command }) => command)).toEqual([
      'set',
      'zadd',
    ]);
    expect(JSON.parse(String(transactions.at(-1)?.[0].args[1]))).toEqual(
      expect.objectContaining({
        phase: 'transition_pending',
        statusEventId: 'status-event-1',
      })
    );
  });

  it('propagates a failed finish result from current and next finish nodes', async () => {
    const { service, chat } = makeHarness();
    const runner = service as unknown as {
      canRunAutomation: jest.Mock;
      sendFinishMessage: jest.Mock;
      processNextNode: (
        t: never,
        createChat: IChat,
        flow: ListChatbotFlowResponse,
        nodeId: string
      ) => Promise<boolean>;
      processFlowNode: (
        t: never,
        data: IUpsertMessage,
        createChat: IChat,
        flow: ListChatbotFlowResponse,
        nodeId: string,
        chatbotId: string
      ) => Promise<boolean>;
    };
    runner.canRunAutomation = jest.fn(async () => true);
    runner.sendFinishMessage = jest.fn(async () => false);
    const flow = makeFinishFlow();

    await expect(
      runner.processNextNode(translate, chat, flow, 'finish-node')
    ).rejects.toThrow('chatbot automatic finish was not confirmed');
    await expect(
      runner.processFlowNode(
        translate,
        { type: EMessageType.text } as IUpsertMessage,
        chat,
        flow,
        'finish-node',
        'chatbot-1'
      )
    ).rejects.toThrow('chatbot automatic finish was not confirmed');
    expect(runner.sendFinishMessage).toHaveBeenCalledTimes(2);
  });

  it('keeps a finishing inactivity item scheduled when closure returns false', async () => {
    const { service, chat, transactions } = makeHarness();
    const runner = service as unknown as {
      sendFinishMessage: jest.Mock;
      processInactivityAlert: (
        t: never,
        cacheKey: string,
        data: IInactivityData,
        alert: { quantity: number; time: number; action: string },
        createChat: IChat
      ) => Promise<boolean>;
    };
    runner.sendFinishMessage = jest.fn(async () => false);
    const inactivityData = {
      lastInteraction: Date.now() - 60_000,
      alertCount: 1,
      lastAlertTime: Date.now() - 60_000,
      chatbotId: 'chatbot-1',
      accountId: 'account-1',
      workerId: 'worker-1',
      chatId: 'chat-1',
      trackingId: 'tracking-1',
      retryCount: 0,
      stage: 'waiting',
    } satisfies IInactivityData;

    await expect(
      runner.processInactivityAlert(
        translate,
        'inactivity-key',
        inactivityData,
        { quantity: 1, time: 1, action: 'finish' },
        chat
      )
    ).resolves.toBe(false);

    expect(inactivityData.stage).toBe('finishing');
    expect(transactions).toHaveLength(1);
    expect(transactions[0].map(({ command }) => command)).toEqual([
      'set',
      'zadd',
    ]);
  });

  it('restarts the full inactivity interval when activity appears during finalization', async () => {
    const { service, chat, transactions } = makeHarness();
    const now = 1_800_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const inactivityData = {
      lastInteraction: now - 60_000,
      alertCount: 1,
      lastAlertTime: now - 60_000,
      chatbotId: 'chatbot-1',
      accountId: 'account-1',
      workerId: 'worker-1',
      chatId: 'chat-1',
      trackingId: 'tracking-before-activity',
      retryCount: 1,
      stage: 'finishing',
      expectedLastMessageId: 'message-before-finalization',
    } satisfies IInactivityData;
    const chatWithNewActivity = {
      ...chat,
      summary: {
        last_message: 'Nova mensagem',
        last_message_id: 'message-after-finalization',
        last_date: new Date(now).toISOString(),
        unread_count: 1,
      },
    } as IChat;

    await expect(
      (
        service as unknown as {
          restartFinishingInactivityAfterNewActivity: (
            cacheKey: string,
            data: IInactivityData,
            currentChat: IChat,
            timeMinutes: number
          ) => Promise<boolean>;
        }
      ).restartFinishingInactivityAfterNewActivity(
        'underchat:chatbot-inactivity:account-1:worker-1:chat-1',
        inactivityData,
        chatWithNewActivity,
        2
      )
    ).resolves.toBe(true);

    expect(inactivityData).toEqual(
      expect.objectContaining({
        alertCount: 0,
        lastAlertTime: null,
        lastInteraction: now,
        retryCount: 0,
        stage: 'waiting',
      })
    );
    expect(transactions.at(-1)?.[0].args).toEqual([
      'underchat:chatbot-inactivity:account-1:worker-1:chat-1',
      expect.any(String),
    ]);
    expect(transactions.at(-1)?.[1].args[1]).toBe(now + 120_000);
  });

  it('persists the inactivity payload and score atomically without a fixed TTL', async () => {
    const { service, chat, transactions } = makeHarness();
    const now = 1_800_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);

    await (
      service as unknown as {
        scheduleInactivityCheck: (
          createChat: IChat,
          minutes: number,
          chatbotId: string
        ) => Promise<void>;
      }
    ).scheduleInactivityCheck(chat, 60 * 24 * 3, 'chatbot-1');

    expect(transactions).toHaveLength(1);
    expect(transactions[0].map(({ command }) => command)).toEqual([
      'set',
      'zadd',
    ]);
    const setOperation = transactions[0][0];
    expect(setOperation.args).toHaveLength(2);
    expect(JSON.parse(String(setOperation.args[1]))).toEqual(
      expect.objectContaining({
        trackingId: 'status-event-1',
        retryCount: 0,
        stage: 'waiting',
      })
    );
    expect(transactions[0][1].args[1]).toBe(now + 60 * 24 * 3 * 60 * 1000);
  });

  it.each(['awaiting_contact_reply', 'send_uncertain', 'closed'] as const)(
    'removes a due inactivity without side effects while the official window is %s',
    async (state) => {
      const {
        service,
        redis,
        chatbotService,
        chat,
        chatLifecycleService,
        chatMessageService,
        officialWhatsappConversationWindowService,
        transactions,
      } = makeHarness();
      const now = 1_800_000_000_000;
      jest.spyOn(Date, 'now').mockReturnValue(now);
      (
        service as unknown as { hasReconciledInactivitySchedule: boolean }
      ).hasReconciledInactivitySchedule = true;
      chat.worker.is_official = true;

      const inactivityCacheKey =
        'underchat:chatbot-inactivity:account-1:worker-1:chat-1';
      const inactivityData: IInactivityData = {
        lastInteraction: now - 60_000,
        alertCount: 0,
        lastAlertTime: null,
        chatbotId: 'chatbot-1',
        accountId: 'account-1',
        workerId: 'worker-1',
        chatId: 'chat-1',
        trackingId: 'tracking-1',
        retryCount: 0,
        stage: 'waiting',
      };

      redis.zrangebyscore
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([inactivityCacheKey]);
      redis.get.mockImplementation(async (key: string) =>
        key === inactivityCacheKey ? JSON.stringify(inactivityData) : null
      );
      chatbotService.findChatbotFlowByChatbotId.mockResolvedValueOnce(
        makeFinishFlow()
      );
      chatbotService.findChatbotFlowConfigurationsByChatbotId.mockResolvedValueOnce(
        {
          configurations: {
            inactivity_alert: {
              status: 'active',
              quantity: 1,
              time: 1,
              action: 'finish',
            },
          },
        }
      );
      officialWhatsappConversationWindowService.resolveAuthoritativeForChat.mockResolvedValueOnce(
        {
          state,
          can_send_freeform: false,
        }
      );
      const runner = service as unknown as {
        processInactivityAlert: jest.Mock;
      };
      runner.processInactivityAlert = jest.fn(async () => true);

      await service.processScheduledInactivityChecks(translate);

      expect(runner.processInactivityAlert).not.toHaveBeenCalled();
      expect(chatLifecycleService.finishChat).not.toHaveBeenCalled();
      expect(chatMessageService.sendMessage).not.toHaveBeenCalled();
      expect(transactions.at(-1)).toEqual([
        expect.objectContaining({
          command: 'del',
          args: [inactivityCacheKey],
        }),
        expect.objectContaining({ command: 'zrem' }),
      ]);
    }
  );

  it.each([
    ['open official window', true],
    ['non-official channel', false],
  ] as const)(
    'keeps processing due inactivity for an %s',
    async (_label, official) => {
      const {
        service,
        redis,
        chatbotService,
        chat,
        officialWhatsappConversationWindowService,
      } = makeHarness();
      const now = 1_800_000_000_000;
      jest.spyOn(Date, 'now').mockReturnValue(now);
      (
        service as unknown as { hasReconciledInactivitySchedule: boolean }
      ).hasReconciledInactivitySchedule = true;
      chat.worker.is_official = official;

      const inactivityCacheKey =
        'underchat:chatbot-inactivity:account-1:worker-1:chat-1';
      const inactivityData: IInactivityData = {
        lastInteraction: now - 60_000,
        alertCount: 0,
        lastAlertTime: null,
        chatbotId: 'chatbot-1',
        accountId: 'account-1',
        workerId: 'worker-1',
        chatId: 'chat-1',
        trackingId: 'tracking-1',
        retryCount: 0,
        stage: 'waiting',
      };

      redis.zrangebyscore
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([inactivityCacheKey]);
      redis.get.mockImplementation(async (key: string) =>
        key === inactivityCacheKey ? JSON.stringify(inactivityData) : null
      );
      chatbotService.findChatbotFlowByChatbotId.mockResolvedValueOnce(
        makeFinishFlow()
      );
      chatbotService.findChatbotFlowConfigurationsByChatbotId.mockResolvedValueOnce(
        {
          configurations: {
            inactivity_alert: {
              status: 'active',
              quantity: 1,
              time: 1,
              action: 'finish',
            },
          },
        }
      );
      const runner = service as unknown as {
        processInactivityAlert: jest.Mock;
      };
      runner.processInactivityAlert = jest.fn(async () => true);

      await service.processScheduledInactivityChecks(translate);

      expect(runner.processInactivityAlert).toHaveBeenCalledTimes(1);
      expect(
        officialWhatsappConversationWindowService.resolveAuthoritativeForChat
      ).toHaveBeenCalledTimes(official ? 1 : 0);
    }
  );

  it('requeues a due inactivity without side effects when the official window lookup fails', async () => {
    const {
      service,
      redis,
      chatbotService,
      chat,
      chatLifecycleService,
      chatMessageService,
      officialWhatsappConversationWindowService,
      transactions,
    } = makeHarness();
    const now = 1_800_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (
      service as unknown as { hasReconciledInactivitySchedule: boolean }
    ).hasReconciledInactivitySchedule = true;
    chat.worker.is_official = true;

    const inactivityCacheKey =
      'underchat:chatbot-inactivity:account-1:worker-1:chat-1';
    const inactivityData: IInactivityData = {
      lastInteraction: now - 60_000,
      alertCount: 0,
      lastAlertTime: null,
      chatbotId: 'chatbot-1',
      accountId: 'account-1',
      workerId: 'worker-1',
      chatId: 'chat-1',
      trackingId: 'tracking-1',
      retryCount: 0,
      stage: 'waiting',
    };

    redis.zrangebyscore
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([inactivityCacheKey]);
    redis.get.mockImplementation(async (key: string) =>
      key === inactivityCacheKey ? JSON.stringify(inactivityData) : null
    );
    chatbotService.findChatbotFlowByChatbotId.mockResolvedValueOnce(
      makeFinishFlow()
    );
    chatbotService.findChatbotFlowConfigurationsByChatbotId.mockResolvedValueOnce(
      {
        configurations: {
          inactivity_alert: {
            status: 'active',
            quantity: 1,
            time: 1,
            action: 'finish',
          },
        },
      }
    );
    officialWhatsappConversationWindowService.resolveAuthoritativeForChat.mockRejectedValueOnce(
      new Error('temporary official window failure')
    );

    await service.processScheduledInactivityChecks(translate);

    expect(chatLifecycleService.finishChat).not.toHaveBeenCalled();
    expect(chatMessageService.sendMessage).not.toHaveBeenCalled();
    expect(transactions.at(-1)?.map(({ command }) => command)).toEqual([
      'set',
      'zadd',
    ]);
    expect(JSON.parse(String(transactions.at(-1)?.[0].args[1]))).toEqual(
      expect.objectContaining({ retryCount: 1, alertCount: 0 })
    );
    expect(transactions.at(-1)?.[1].args[1]).toBe(now + 30_000);
  });

  it('discards a pending inactivity finish before closing an official chat that is awaiting a reply', async () => {
    const {
      service,
      chat,
      chatLifecycleService,
      chatMessageService,
      officialWhatsappConversationWindowService,
      transactions,
    } = makeHarness();
    chat.worker.is_official = true;
    officialWhatsappConversationWindowService.resolveAuthoritativeForChat.mockResolvedValueOnce(
      {
        state: 'awaiting_contact_reply',
        can_send_freeform: false,
      }
    );

    await (
      service as unknown as {
        executePendingFinishEffect: (
          t: never,
          effect: unknown,
          ids: { accountId: string; workerId: string; chatId: string }
        ) => Promise<void>;
      }
    ).executePendingFinishEffect(
      translate,
      {
        accountId: 'account-1',
        workerId: 'worker-1',
        chatId: 'chat-1',
        source: 'chatbot',
        phase: 'transition_pending',
        expectedStatus: EChatStatus.ura,
        expectedStartedAt: null,
        customMessage: 'Atendimento finalizado',
        messageEnabled: true,
        retryCount: 0,
      },
      { accountId: 'account-1', workerId: 'worker-1', chatId: 'chat-1' }
    );

    expect(chatLifecycleService.finishChat).not.toHaveBeenCalled();
    expect(chatMessageService.sendMessage).not.toHaveBeenCalled();
    expect(transactions.at(-1)).toEqual([
      expect.objectContaining({
        command: 'del',
        args: ['underchat:chatbot-finish:account-1:worker-1:chat-1'],
      }),
      expect.objectContaining({ command: 'zrem' }),
    ]);
  });

  it('discards a pending inactivity redirect while an official chat cannot send freeform messages', async () => {
    const {
      service,
      chat,
      officialWhatsappConversationWindowService,
      transactions,
    } = makeHarness();
    chat.worker.is_official = true;
    officialWhatsappConversationWindowService.resolveAuthoritativeForChat.mockResolvedValueOnce(
      {
        state: 'send_uncertain',
        can_send_freeform: false,
      }
    );
    const cacheKey = 'underchat:chatbot-inactivity-redirect:account-1:chat-1';

    await (
      service as unknown as {
        executeInactivityRedirectEffect: (
          t: never,
          cacheKey: string,
          effect: unknown,
          ids: { accountId: string; chatId: string }
        ) => Promise<void>;
      }
    ).executeInactivityRedirectEffect(
      translate,
      cacheKey,
      {
        accountId: 'account-1',
        chatId: 'chat-1',
        sourceWorkerId: 'worker-1',
        sourceChatbotId: 'chatbot-1',
        targetWorkerId: 'worker-2',
        targetChatbotId: 'chatbot-2',
        operationId: 'operation-1',
        eventEpochMillis: Date.now(),
        phase: 'transition_pending',
        expectedStatus: EChatStatus.ura,
        expectedLastMessageId: null,
        expectedSummaryRevision: 0,
        retryCount: 0,
      },
      { accountId: 'account-1', chatId: 'chat-1' }
    );

    expect(transactions.at(-1)).toEqual([
      expect.objectContaining({ command: 'del', args: [cacheKey] }),
      expect.objectContaining({ command: 'zrem' }),
    ]);
  });

  it('does not recover an orphaned inactivity while an official contact reply is pending', async () => {
    const {
      service,
      chat,
      chatbotService,
      officialWhatsappConversationWindowService,
      transactions,
    } = makeHarness();
    chat.worker.is_official = true;
    officialWhatsappConversationWindowService.resolveAuthoritativeForChat.mockResolvedValueOnce(
      {
        state: 'awaiting_contact_reply',
        can_send_freeform: false,
      }
    );
    const inactivityCacheKey =
      'underchat:chatbot-inactivity:account-1:worker-1:chat-1';

    const recovered = await (
      service as unknown as {
        recoverMissingInactivityPayloadWithLock: (
          cacheKey: string,
          ids: { accountId: string; workerId: string; chatId: string }
        ) => Promise<boolean>;
      }
    ).recoverMissingInactivityPayloadWithLock(inactivityCacheKey, {
      accountId: 'account-1',
      workerId: 'worker-1',
      chatId: 'chat-1',
    });

    expect(recovered).toBe(false);
    expect(
      chatbotService.findChatbotFlowConfigurationsByChatbotId
    ).not.toHaveBeenCalled();
    expect(transactions).toHaveLength(0);
  });

  it('removes an unscheduled inactivity payload instead of reconciling it while the official window is blocked', async () => {
    const {
      service,
      redis,
      chat,
      chatbotService,
      officialWhatsappConversationWindowService,
      transactions,
    } = makeHarness();
    const now = 1_800_000_000_000;
    chat.worker.is_official = true;
    const inactivityCacheKey =
      'underchat:chatbot-inactivity:account-1:worker-1:chat-1';
    const inactivityData: IInactivityData = {
      lastInteraction: now - 60_000,
      alertCount: 0,
      lastAlertTime: null,
      chatbotId: 'chatbot-1',
      accountId: 'account-1',
      workerId: 'worker-1',
      chatId: 'chat-1',
      trackingId: 'tracking-1',
      retryCount: 0,
      stage: 'waiting',
    };
    redis.zscore.mockResolvedValueOnce(null);
    redis.get.mockImplementation(async (key: string) =>
      key === inactivityCacheKey ? JSON.stringify(inactivityData) : null
    );
    chatbotService.findChatbotFlowConfigurationsByChatbotId.mockResolvedValueOnce(
      {
        configurations: {
          inactivity_alert: { status: 'active', time: 1 },
        },
      }
    );
    officialWhatsappConversationWindowService.resolveAuthoritativeForChat.mockResolvedValueOnce(
      {
        state: 'closed',
        can_send_freeform: false,
      }
    );

    await (
      service as unknown as {
        reconcileUnscheduledInactivityPayload: (
          cacheKey: string
        ) => Promise<void>;
      }
    ).reconcileUnscheduledInactivityPayload(inactivityCacheKey);

    expect(transactions.at(-1)).toEqual([
      expect.objectContaining({
        command: 'del',
        args: [inactivityCacheKey],
      }),
      expect.objectContaining({ command: 'zrem' }),
    ]);
  });

  it('retries one failed due item without removing it early and continues the batch', async () => {
    const { service, redis, chatbotService, transactions } = makeHarness();
    const now = 1_800_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (
      service as unknown as { hasReconciledInactivitySchedule: boolean }
    ).hasReconciledInactivitySchedule = true;

    const makePayload = (suffix: string): IInactivityData => ({
      lastInteraction: now - 60_000,
      alertCount: 0,
      lastAlertTime: null,
      chatbotId: `chatbot-${suffix}`,
      accountId: 'account-1',
      workerId: 'worker-1',
      chatId: `chat-${suffix}`,
      trackingId: `tracking-${suffix}`,
      retryCount: 0,
      stage: 'waiting',
    });
    const firstKey = 'underchat:chatbot-inactivity:account-1:worker-1:chat-1';
    const secondKey = 'underchat:chatbot-inactivity:account-1:worker-1:chat-2';
    const payloads = new Map([
      [firstKey, makePayload('1')],
      [secondKey, makePayload('2')],
    ]);
    redis.zrangebyscore
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([firstKey, secondKey]);
    redis.get.mockImplementation(async (key: string) =>
      JSON.stringify(payloads.get(key))
    );
    chatbotService.findChatbotFlowByChatbotId
      .mockRejectedValueOnce(new Error('temporary flow read failure'))
      .mockResolvedValueOnce(null);

    await service.processScheduledInactivityChecks(translate);

    expect(chatbotService.findChatbotFlowByChatbotId).toHaveBeenCalledTimes(2);
    expect(redis.zrem).not.toHaveBeenCalled();
    expect(transactions).toHaveLength(2);
    expect(transactions[0].map(({ command }) => command)).toEqual([
      'set',
      'zadd',
    ]);
    expect(JSON.parse(String(transactions[0][0].args[1]))).toEqual(
      expect.objectContaining({ retryCount: 1, alertCount: 0 })
    );
    expect(transactions[0][1].args[1]).toBe(now + 30_000);
    expect(transactions[1].map(({ command }) => command)).toEqual([
      'del',
      'zrem',
    ]);
    expect(transactions[1][1].args).toContain(secondKey);
  });

  it('keeps a failed final message in the outbox and retries the same event id', async () => {
    const {
      service,
      redis,
      chat,
      closedChat,
      chatService,
      chatMessageService,
      transactions,
    } = makeHarness();
    chatService.findChatByChatId
      .mockResolvedValueOnce(chat)
      .mockResolvedValueOnce(closedChat);
    chatMessageService.sendMessage.mockResolvedValueOnce(false);

    const result = await (
      service as unknown as {
        sendFinishMessage: (
          t: never,
          createChat: IChat,
          message: string,
          enabled: boolean
        ) => Promise<boolean>;
      }
    ).sendFinishMessage(translate, chat, 'Atendimento finalizado', true);

    expect(result).toBe(true);
    const pendingKey = 'underchat:chatbot-finish:account-1:worker-1:chat-1';
    const effectSet = transactions
      .flat()
      .find(
        ({ command, args }) =>
          command === 'set' &&
          args[0] === pendingKey &&
          String(args[1]).includes('effects_pending')
      );
    if (!effectSet) {
      throw new Error('effects_pending payload was not persisted');
    }
    const effectPayload = String(effectSet.args[1]);
    const runtimeCleanup = transactions.find((operations) =>
      operations.some(
        ({ command, args }) => command === 'del' && args.length > 1
      )
    );
    expect(runtimeCleanup).toBeDefined();
    expect(runtimeCleanup?.flatMap(({ args }) => args) ?? []).not.toContain(
      pendingKey
    );

    redis.zrangebyscore.mockResolvedValueOnce([pendingKey]);
    redis.get.mockResolvedValueOnce(effectPayload);
    chatService.findChatByChatId.mockResolvedValue(closedChat);

    await (
      service as unknown as {
        processScheduledFinishEffects: (t: never) => Promise<void>;
      }
    ).processScheduledFinishEffects(translate);

    expect(chatMessageService.sendMessage).toHaveBeenCalledTimes(2);
    expect(chatMessageService.sendMessage).toHaveBeenLastCalledWith(
      translate,
      expect.objectContaining({ messageId: 'status-event-1' })
    );
    expect(transactions.at(-1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: 'del', args: [pendingKey] }),
        expect.objectContaining({ command: 'zrem' }),
      ])
    );
  });

  it('retries a lifecycle transition from the outbox after a retryable failure', async () => {
    const {
      service,
      redis,
      chat,
      closedChat,
      chatService,
      chatLifecycleService,
      chatMessageService,
      transactions,
    } = makeHarness();
    chatService.findChatByChatId.mockResolvedValueOnce(chat);
    chatLifecycleService.finishChat.mockResolvedValueOnce({
      outcome: 'retryable_failure',
      targetStatus: EChatStatus.closed,
      chat,
      statusEventId: 'status-event-1',
      ownedBySource: false,
    });

    const firstResult = await (
      service as unknown as {
        sendFinishMessage: (
          t: never,
          createChat: IChat,
          message: string,
          enabled: boolean
        ) => Promise<boolean>;
      }
    ).sendFinishMessage(translate, chat, 'Atendimento finalizado', true);
    expect(firstResult).toBe(false);

    const pendingKey = 'underchat:chatbot-finish:account-1:worker-1:chat-1';
    const transitionPayload = String(transactions[0][0].args[1]);
    redis.zrangebyscore.mockResolvedValueOnce([pendingKey]);
    redis.get
      .mockResolvedValueOnce(transitionPayload)
      .mockResolvedValueOnce(transitionPayload);
    chatService.findChatByChatId
      .mockResolvedValueOnce(chat)
      .mockResolvedValueOnce(closedChat);

    await (
      service as unknown as {
        processScheduledFinishEffects: (t: never) => Promise<void>;
      }
    ).processScheduledFinishEffects(translate);

    expect(chatLifecycleService.finishChat).toHaveBeenCalledTimes(2);
    expect(chatMessageService.sendMessage).toHaveBeenCalledWith(
      translate,
      expect.objectContaining({ messageId: 'status-event-1' })
    );
  });

  it('acks a stale transition job without closing a reopened automation session', async () => {
    const {
      service,
      chat,
      chatService,
      chatLifecycleService,
      chatMessageService,
      transactions,
    } = makeHarness();
    const reopenedChat = {
      ...chat,
      meta: {
        status_epoch: 3,
        status_event_id: 'new-session-event',
        status_source: 'chat_service',
      },
    } as IChat;
    chatService.findChatByChatId.mockResolvedValueOnce(reopenedChat);

    await (
      service as unknown as {
        executePendingFinishEffect: (
          t: never,
          effect: unknown,
          ids: { accountId: string; workerId: string; chatId: string }
        ) => Promise<void>;
      }
    ).executePendingFinishEffect(
      translate,
      {
        accountId: 'account-1',
        workerId: 'worker-1',
        chatId: 'chat-1',
        source: 'chatbot',
        phase: 'transition_pending',
        statusEventId: 'target-close-event',
        expectedStatus: EChatStatus.ura,
        expectedStatusEventId: 'old-session-event',
        expectedStatusEpoch: 2,
        expectedStartedAt: null,
        customMessage: 'Atendimento finalizado',
        messageEnabled: true,
        retryCount: 0,
      },
      { accountId: 'account-1', workerId: 'worker-1', chatId: 'chat-1' }
    );

    expect(chatLifecycleService.finishChat).not.toHaveBeenCalled();
    expect(chatMessageService.sendMessage).not.toHaveBeenCalled();
    expect(transactions.at(-1)?.map(({ command }) => command)).toEqual([
      'del',
      'zrem',
    ]);
  });

  it('discards a pending finish when a newer message was persisted', async () => {
    const {
      service,
      chat,
      chatService,
      chatLifecycleService,
      chatMessageService,
      transactions,
    } = makeHarness();
    const chatWithNewActivity = {
      ...chat,
      summary: {
        last_message: 'Nova mensagem',
        last_message_id: 'message-after-finish-attempt',
        last_date: '2026-07-09T12:02:00.000Z',
        unread_count: 1,
      },
    } as IChat;
    chatService.findChatByChatId.mockResolvedValueOnce(chatWithNewActivity);

    await (
      service as unknown as {
        executePendingFinishEffect: (
          t: never,
          effect: unknown,
          ids: { accountId: string; workerId: string; chatId: string }
        ) => Promise<void>;
      }
    ).executePendingFinishEffect(
      translate,
      {
        accountId: 'account-1',
        workerId: 'worker-1',
        chatId: 'chat-1',
        source: 'chatbot',
        phase: 'transition_pending',
        statusEventId: 'target-close-event',
        expectedStatus: EChatStatus.ura,
        expectedStartedAt: null,
        expectedLastMessageId: 'message-before-finish-attempt',
        customMessage: 'Atendimento finalizado',
        messageEnabled: true,
        retryCount: 0,
      },
      { accountId: 'account-1', workerId: 'worker-1', chatId: 'chat-1' }
    );

    expect(chatLifecycleService.finishChat).not.toHaveBeenCalled();
    expect(chatMessageService.sendMessage).not.toHaveBeenCalled();
    expect(transactions.at(-1)).toEqual([
      expect.objectContaining({
        command: 'del',
        args: ['underchat:chatbot-finish:account-1:worker-1:chat-1'],
      }),
      expect.objectContaining({ command: 'zrem' }),
    ]);
  });

  it('does not rebase a pending finish onto activity persisted after its ownership check', async () => {
    const { service, chat, chatService, chatLifecycleService } = makeHarness();
    const chatWithNewActivity = {
      ...chat,
      summary: {
        last_message: 'Nova mensagem',
        last_message_id: 'message-after-ownership-check',
        last_date: '2026-07-09T12:02:00.000Z',
        unread_count: 1,
      },
    } as IChat;
    chatService.findChatByChatId.mockResolvedValueOnce(chat);
    chatLifecycleService.finishChat.mockResolvedValueOnce({
      outcome: 'status_mismatch',
      targetStatus: EChatStatus.closed,
      chat: chatWithNewActivity,
      statusEventId: 'target-close-event',
      ownedBySource: false,
    });

    await expect(
      (
        service as unknown as {
          executePendingFinishEffect: (
            t: never,
            effect: unknown,
            ids: { accountId: string; workerId: string; chatId: string }
          ) => Promise<void>;
        }
      ).executePendingFinishEffect(
        translate,
        {
          accountId: 'account-1',
          workerId: 'worker-1',
          chatId: 'chat-1',
          source: 'chatbot',
          phase: 'transition_pending',
          statusEventId: 'target-close-event',
          expectedStatus: EChatStatus.ura,
          expectedStartedAt: null,
          expectedLastMessageId: null,
          customMessage: 'Atendimento finalizado',
          messageEnabled: true,
          retryCount: 0,
        },
        { accountId: 'account-1', workerId: 'worker-1', chatId: 'chat-1' }
      )
    ).rejects.toThrow('chatbot finish transition was not confirmed');

    expect(chatService.findChatByChatId).toHaveBeenCalledTimes(1);
    expect(chatLifecycleService.finishChat).toHaveBeenCalledWith(
      expect.objectContaining({ chat })
    );
  });

  it('acks the original outbox key when the chat worker changed', async () => {
    const {
      service,
      chat,
      chatService,
      chatLifecycleService,
      chatMessageService,
      transactions,
    } = makeHarness();
    const migratedChat = {
      ...chat,
      worker: { id: 'worker-2', name: 'Worker 2' },
    } as IChat;
    const migratedClosedChat = {
      ...migratedChat,
      status: EChatStatus.closed,
      closed_at: '2026-07-09T12:03:00.000Z',
      meta: {
        status_epoch: 2,
        status_event_id: 'status-event-1',
        status_source: 'chatbot',
      },
    } as IChat;
    chatService.findChatByChatId
      .mockResolvedValueOnce(migratedChat)
      .mockResolvedValueOnce(migratedChat)
      .mockResolvedValue(migratedClosedChat);
    chatLifecycleService.finishChat.mockResolvedValueOnce({
      outcome: 'applied',
      targetStatus: EChatStatus.closed,
      chat: migratedClosedChat,
      statusEventId: 'status-event-1',
      ownedBySource: true,
    });
    chatMessageService.sendMessage.mockResolvedValueOnce(false);
    const originalCacheKey =
      'underchat:chatbot-finish:account-1:worker-1:chat-1';

    await (
      service as unknown as {
        executePendingFinishEffect: (
          t: never,
          effect: unknown,
          ids: { accountId: string; workerId: string; chatId: string },
          sourceCacheKey: string
        ) => Promise<void>;
      }
    ).executePendingFinishEffect(
      translate,
      {
        accountId: 'account-1',
        workerId: 'worker-1',
        chatId: 'chat-1',
        source: 'chatbot',
        phase: 'transition_pending',
        statusEventId: 'status-event-1',
        expectedStatus: EChatStatus.ura,
        expectedStartedAt: null,
        expectedLastMessageId: null,
        customMessage: 'Atendimento finalizado',
        messageEnabled: true,
        retryCount: 0,
      },
      { accountId: 'account-1', workerId: 'worker-1', chatId: 'chat-1' },
      originalCacheKey
    );

    expect(chatLifecycleService.finishChat).toHaveBeenCalledTimes(1);
    expect(transactions).toContainEqual([
      expect.objectContaining({ command: 'del', args: [originalCacheKey] }),
      expect.objectContaining({ command: 'zrem' }),
    ]);
    expect(
      transactions.some((operations) =>
        operations.some(
          ({ command, args }) =>
            command === 'set' &&
            args[0] === 'underchat:chatbot-finish:account-1:worker-2:chat-1'
        )
      )
    ).toBe(true);
  });

  it('moves pending effects when the worker changes during the lifecycle transition', async () => {
    const {
      service,
      chat,
      chatService,
      chatLifecycleService,
      chatMessageService,
      transactions,
    } = makeHarness();
    const closedOnNewWorker = {
      ...chat,
      worker: { id: 'worker-2', name: 'Worker 2' },
      status: EChatStatus.closed,
      closed_at: '2026-07-09T12:04:00.000Z',
      meta: {
        status_epoch: 3,
        status_event_id: 'status-event-1',
        status_source: 'chatbot',
      },
    } as IChat;
    chatService.findChatByChatId
      .mockResolvedValueOnce(chat)
      .mockResolvedValue(closedOnNewWorker);
    chatLifecycleService.finishChat.mockResolvedValueOnce({
      outcome: 'applied',
      targetStatus: EChatStatus.closed,
      chat: closedOnNewWorker,
      statusEventId: 'status-event-1',
      ownedBySource: true,
    });
    chatMessageService.sendMessage.mockResolvedValueOnce(false);
    const oldKey = 'underchat:chatbot-finish:account-1:worker-1:chat-1';
    const newKey = 'underchat:chatbot-finish:account-1:worker-2:chat-1';

    await expect(
      (
        service as unknown as {
          sendFinishMessage: (
            t: never,
            createChat: IChat,
            message: string,
            enabled: boolean
          ) => Promise<boolean>;
        }
      ).sendFinishMessage(translate, chat, 'Atendimento finalizado', true)
    ).resolves.toBe(true);

    expect(transactions).toContainEqual([
      expect.objectContaining({ command: 'del', args: [oldKey] }),
      expect.objectContaining({ command: 'zrem' }),
    ]);
    expect(
      transactions.some((operations) =>
        operations.some(
          ({ command, args }) => command === 'set' && args[0] === newKey
        )
      )
    ).toBe(true);
    expect(
      transactions.some((operations) =>
        operations.some(
          ({ command, args }) => command === 'del' && args[0] === newKey
        )
      )
    ).toBe(false);
  });

  it('does not leave a finish outbox job when the final message is disabled', async () => {
    const {
      service,
      chat,
      closedChat,
      chatService,
      chatMessageService,
      transactions,
    } = makeHarness();
    chatService.findChatByChatId.mockResolvedValueOnce(chat);

    await (
      service as unknown as {
        sendFinishMessage: (
          t: never,
          createChat: IChat,
          message: string,
          enabled: boolean
        ) => Promise<boolean>;
      }
    ).sendFinishMessage(translate, chat, 'Atendimento finalizado', false);

    expect(chatMessageService.sendMessage).not.toHaveBeenCalled();
    expect(transactions.at(-1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'del',
          args: ['underchat:chatbot-finish:account-1:worker-1:chat-1'],
        }),
      ])
    );
    expect(closedChat.status).toBe(EChatStatus.closed);
  });

  it('publishes a redirect only after its transfer message is persisted', async () => {
    const { service, chat } = makeHarness();
    const events: string[] = [];
    const redirectedUser = {
      id: 'user-1',
      name: 'Attendant',
      photo: null,
    };
    let messageResult = true;
    const runner = service as unknown as {
      resolveRedirectWorker: jest.Mock;
      processUserRedirect: jest.Mock;
      replaceVariables: jest.Mock;
      sendMessageWithStatusGuard: jest.Mock;
      updateAndPublishChat: jest.Mock;
      processRedirectNode: (
        t: never,
        createChat: IChat,
        flow: ListChatbotFlowResponse,
        nodeId: string,
        customMessages: {
          transfer_message_user: string;
          transfer_message_user_enabled: boolean;
        }
      ) => Promise<boolean>;
    };
    runner.resolveRedirectWorker = jest.fn(async () => chat.worker);
    runner.processUserRedirect = jest.fn(async () => redirectedUser);
    runner.replaceVariables = jest.fn(async () => 'Transferindo');
    runner.sendMessageWithStatusGuard = jest.fn(async () => {
      events.push('message');
      return messageResult;
    });
    runner.updateAndPublishChat = jest.fn(async () => {
      events.push('redirect');
      return chat;
    });
    const flow = {
      nodes: [
        {
          id: 'redirect-node',
          type: 'redirect',
          data: { redirectType: 'user', selectedUser: 'user-1' },
        },
      ],
      edges: [],
    } as unknown as ListChatbotFlowResponse;
    const customMessages = {
      transfer_message_user: 'Transferindo',
      transfer_message_user_enabled: true,
    };

    await expect(
      runner.processRedirectNode(
        translate,
        chat,
        flow,
        'redirect-node',
        customMessages
      )
    ).resolves.toBe(true);

    messageResult = false;
    await expect(
      runner.processRedirectNode(
        translate,
        chat,
        flow,
        'redirect-node',
        customMessages
      )
    ).resolves.toBe(false);

    expect(events).toEqual(['message', 'redirect', 'message']);
    expect(runner.updateAndPublishChat).toHaveBeenCalledTimes(1);
  });

  it('propagates the guarded send result for generated voice messages', async () => {
    const { service, chat } = makeHarness();
    const runner = service as unknown as {
      voiceIaService: { viewVoiceIa: jest.Mock };
      voiceIaIntegrationService: { generateSpeechAndUpload: jest.Mock };
      sendMessageWithStatusGuard: jest.Mock;
      trySendAsVoiceMessage: (
        t: never,
        createChat: IChat,
        aiAgent: { voice_ia_id: string },
        text: string
      ) => Promise<boolean>;
    };
    runner.voiceIaService = {
      viewVoiceIa: jest.fn(async () => ({ api_key: 'voice-key' })),
    };
    runner.voiceIaIntegrationService = {
      generateSpeechAndUpload: jest.fn(async () => ({
        url: 'https://example.test/audio.ogg',
        mimetype: 'audio/ogg',
      })),
    };
    runner.sendMessageWithStatusGuard = jest.fn(async () => false);

    await expect(
      runner.trySendAsVoiceMessage(
        translate,
        chat,
        { voice_ia_id: 'voice-1' },
        'Mensagem falada'
      )
    ).resolves.toBe(false);

    expect(runner.sendMessageWithStatusGuard).toHaveBeenCalledWith(
      translate,
      expect.objectContaining({
        type: EMessageType.audio,
        audioUrl: 'https://example.test/audio.ogg',
      })
    );
  });

  it('reuses deterministic ids for prepared official messages in the same bootstrap execution', () => {
    const { service, chat } = makeHarness();
    const runner = service as unknown as {
      executionMessageContextByChatId: Map<
        string,
        { executionId: string; nextMessageIndex: number }
      >;
      buildPreparedOfficialMessage: (
        createChat: IChat,
        type: EMessageType,
        message: string,
        content: Record<string, never>
      ) => { message_id: string; hash: string };
    };
    const resetExecution = (): void => {
      runner.executionMessageContextByChatId.set(chat.chat_id, {
        executionId: 'bootstrap-event-1',
        nextMessageIndex: 0,
      });
    };

    resetExecution();
    const firstAttempt = runner.buildPreparedOfficialMessage(
      chat,
      EMessageType.official_template,
      'template-name',
      {}
    );
    resetExecution();
    const retryAttempt = runner.buildPreparedOfficialMessage(
      chat,
      EMessageType.official_template,
      'template-name',
      {}
    );

    expect(retryAttempt.message_id).toBe(firstAttempt.message_id);
    expect(retryAttempt.hash).toBe(firstAttempt.hash);
    expect(firstAttempt.message_id).toContain(
      'chatbot-execution:bootstrap-event-1:message:0'
    );
  });

  it('scopes recurring contact mutations by the durable chatbot execution occurrence', async () => {
    const { service, chat, contactService } = makeHarness();
    const contactChat = {
      ...chat,
      contact: {
        id: 'contact-1',
        name: 'Maycon',
        phone: '999999999',
      },
    } as IChat;
    const runner = service as unknown as {
      executionMessageContextByChatId: Map<
        string,
        { executionId: string; nextMessageIndex: number }
      >;
      updateContactData: (
        createChat: IChat,
        updateData: { name: string },
        currentFlowId: string,
        data: IUpsertMessage
      ) => Promise<void>;
    };
    const makeData = (id: string): IUpsertMessage =>
      ({
        account_id: 'account-1',
        worker_id: 'worker-1',
        type: EMessageType.text,
        has_quoted: false,
        message: {
          key: { id, fromMe: false },
          message: { conversation: 'Maycon' },
        },
      }) as IUpsertMessage;

    await runner.updateContactData(
      contactChat,
      { name: 'Maycon' },
      'data-node-1',
      makeData('provider-message-1')
    );
    await runner.updateContactData(
      contactChat,
      { name: 'Maycon' },
      'data-node-1',
      makeData('provider-message-1')
    );
    await runner.updateContactData(
      contactChat,
      { name: 'Maycon' },
      'data-node-1',
      makeData('provider-message-2')
    );

    const providerKeys = contactService.updateContactById.mock.calls.map(
      (call: unknown[]) =>
        (call[3] as { idempotencyKey: string }).idempotencyKey
    );
    expect(providerKeys[0]).toBe(providerKeys[1]);
    expect(providerKeys[0]).toContain('message:provider-message-1');
    expect(providerKeys[2]).toContain('message:provider-message-2');
    expect(providerKeys[2]).not.toBe(providerKeys[0]);

    runner.executionMessageContextByChatId.set(contactChat.chat_id, {
      executionId: 'bootstrap-occurrence-1',
      nextMessageIndex: 0,
    });
    await runner.updateContactData(
      contactChat,
      { name: 'Maycon' },
      'data-node-1',
      makeData('unstable-synthetic-message')
    );
    const executionKey = (
      contactService.updateContactById.mock.calls.at(-1)?.[3] as {
        idempotencyKey: string;
      }
    ).idempotencyKey;
    expect(executionKey).toContain('execution:bootstrap-occurrence-1');
    expect(executionKey).not.toContain('unstable-synthetic-message');
  });

  it('keeps repeated satisfaction choices distinct across provider events', () => {
    const { service, chat } = makeHarness();
    const runner = service as unknown as {
      buildSatisfactionWebhookIdempotencyKey: (
        chatId: string,
        currentFlowId: string,
        selectedOptionId: string,
        data: IUpsertMessage
      ) => string;
    };
    const makeData = (id: string): IUpsertMessage =>
      ({
        account_id: 'account-1',
        worker_id: 'worker-1',
        source_provider: 'official_whatsapp',
        type: EMessageType.text,
        has_quoted: false,
        message: {
          key: {
            id,
            remoteJid: '5561999999999@s.whatsapp.net',
            fromMe: false,
          },
          message: { conversation: '5' },
          messageTimestamp: 1783719000,
        },
      }) as IUpsertMessage;

    const firstAttempt = runner.buildSatisfactionWebhookIdempotencyKey(
      chat.chat_id,
      'satisfaction-node',
      'option-5',
      makeData('provider-satisfaction-1')
    );
    const retryAttempt = runner.buildSatisfactionWebhookIdempotencyKey(
      chat.chat_id,
      'satisfaction-node',
      'option-5',
      makeData('provider-satisfaction-1')
    );
    const laterSameChoice = runner.buildSatisfactionWebhookIdempotencyKey(
      chat.chat_id,
      'satisfaction-node',
      'option-5',
      makeData('provider-satisfaction-2')
    );

    expect(retryAttempt).toBe(firstAttempt);
    expect(firstAttempt).toContain('message:provider-satisfaction-1');
    expect(laterSameChoice).toContain('message:provider-satisfaction-2');
    expect(laterSameChoice).not.toBe(firstAttempt);
  });

  it('only propagates contact tag failures during synchronous bootstrap', async () => {
    const { service, chat } = makeHarness();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const tagError = new Error('contact tag write failed');
    const runner = service as unknown as {
      synchronousEffectsByChatId: Set<string>;
      updateContactTag: jest.Mock;
      processTagNode: (
        t: never,
        createChat: IChat,
        flow: ListChatbotFlowResponse,
        nodeId: string
      ) => Promise<boolean>;
    };
    runner.updateContactTag = jest.fn(async () => {
      throw tagError;
    });
    const flow = {
      nodes: [
        {
          id: 'tag-node',
          type: 'tag',
          data: { tagType: 'contact', selectedTag: ['label-1'] },
        },
      ],
      edges: [],
    } as unknown as ListChatbotFlowResponse;

    await expect(
      runner.processTagNode(translate, chat, flow, 'tag-node')
    ).resolves.toBe(true);

    runner.synchronousEffectsByChatId.add(chat.chat_id);
    await expect(
      runner.processTagNode(translate, chat, flow, 'tag-node')
    ).rejects.toBe(tagError);

    expect(errorSpy).toHaveBeenCalledTimes(2);
  });

  it('closes and publishes outside-hours state before its outbox message', async () => {
    const {
      service,
      chatService,
      chatLifecycleService,
      chatMessageService,
      lifecycleEvents,
    } = makeHarness();
    const queueChat = makeChat(EChatStatus.queue);
    const outsideClosedChat = {
      ...queueChat,
      status: EChatStatus.closed,
      closed_at: '2026-07-09T12:01:00.000Z',
      meta: {
        status_epoch: 1,
        status_event_id: 'status-event-1',
        status_source: 'outside_hours',
      },
    } as IChat;
    chatService.findChatByChatId
      .mockResolvedValueOnce(queueChat)
      .mockResolvedValueOnce(outsideClosedChat)
      .mockResolvedValueOnce(outsideClosedChat);
    chatLifecycleService.finishChat.mockImplementationOnce(async () => {
      lifecycleEvents.push('finish');
      return {
        outcome: 'applied',
        targetStatus: EChatStatus.closed,
        chat: outsideClosedChat,
        statusEventId: 'status-event-1',
        ownedBySource: true,
      };
    });

    await expect(
      service.finishOutsideHoursChat(
        translate,
        queueChat,
        'Estamos fora do horário'
      )
    ).resolves.toBe(true);

    expect(lifecycleEvents).toEqual(['finish', 'send']);
    expect(chatLifecycleService.finishChat).toHaveBeenCalledWith({
      chat: queueChat,
      source: 'outside_hours',
      expectedStatuses: [EChatStatus.queue],
      respectOutputChatbot: false,
      statusEventId: 'status-event-1',
    });
    expect(chatMessageService.sendMessage).toHaveBeenCalledWith(
      translate,
      expect.objectContaining({
        chat: outsideClosedChat,
        messageId: 'status-event-1',
        type: EMessageType.text,
        typeUser: ETypeUserChat.system,
        securityKeyScopes: [],
        message: 'Estamos fora do horário',
      })
    );
  });

  it('moves outside-hours effects when the worker changes during closure', async () => {
    const {
      service,
      chatService,
      chatLifecycleService,
      chatMessageService,
      transactions,
    } = makeHarness();
    const queueChat = makeChat(EChatStatus.queue);
    const closedOnNewWorker = {
      ...queueChat,
      worker: { id: 'worker-2', name: 'Worker 2' },
      status: EChatStatus.closed,
      closed_at: '2026-07-09T12:05:00.000Z',
      meta: {
        status_epoch: 4,
        status_event_id: 'status-event-1',
        status_source: 'outside_hours',
      },
    } as IChat;
    chatService.findChatByChatId
      .mockResolvedValueOnce(queueChat)
      .mockResolvedValue(closedOnNewWorker);
    chatLifecycleService.finishChat.mockResolvedValueOnce({
      outcome: 'applied',
      targetStatus: EChatStatus.closed,
      chat: closedOnNewWorker,
      statusEventId: 'status-event-1',
      ownedBySource: true,
    });
    chatMessageService.sendMessage.mockResolvedValueOnce(false);
    const oldKey = 'underchat:chatbot-finish:account-1:worker-1:chat-1';
    const newKey = 'underchat:chatbot-finish:account-1:worker-2:chat-1';

    await expect(
      service.finishOutsideHoursChat(
        translate,
        queueChat,
        'Estamos fora do horário'
      )
    ).resolves.toBe(true);

    expect(transactions).toContainEqual([
      expect.objectContaining({ command: 'del', args: [oldKey] }),
      expect.objectContaining({ command: 'zrem' }),
    ]);
    expect(
      transactions.some((operations) =>
        operations.some(
          ({ command, args }) => command === 'set' && args[0] === newKey
        )
      )
    ).toBe(true);
    expect(
      transactions.some((operations) =>
        operations.some(
          ({ command, args }) => command === 'del' && args[0] === newKey
        )
      )
    ).toBe(false);
  });

  it('keeps an outside-hours transition queued on a retryable lifecycle failure', async () => {
    const {
      service,
      chatService,
      chatLifecycleService,
      chatMessageService,
      transactions,
    } = makeHarness();
    const queueChat = makeChat(EChatStatus.queue);
    chatService.findChatByChatId.mockResolvedValueOnce(queueChat);
    chatLifecycleService.finishChat.mockResolvedValueOnce({
      outcome: 'retryable_failure',
      targetStatus: EChatStatus.closed,
      chat: queueChat,
      statusEventId: 'status-event-1',
      ownedBySource: false,
    });

    await expect(
      service.finishOutsideHoursChat(
        translate,
        queueChat,
        'Estamos fora do horário'
      )
    ).resolves.toBe(true);

    expect(chatMessageService.sendMessage).not.toHaveBeenCalled();
    expect(JSON.parse(String(transactions.at(-1)?.[0].args[1]))).toEqual(
      expect.objectContaining({
        source: 'outside_hours',
        phase: 'transition_pending',
        statusEventId: 'status-event-1',
      })
    );
  });

  it('backs off a retryable outside-hours transition processed by the scheduler', async () => {
    const now = 1_720_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const { service, redis, chatService, chatLifecycleService, transactions } =
      makeHarness();
    const queueChat = makeChat(EChatStatus.queue);
    const retryableResult: LifecycleMockResult = {
      outcome: 'retryable_failure',
      targetStatus: EChatStatus.closed,
      chat: queueChat,
      statusEventId: 'status-event-1',
      ownedBySource: false,
    };
    chatService.findChatByChatId.mockResolvedValue(queueChat);
    chatLifecycleService.finishChat
      .mockResolvedValueOnce(retryableResult)
      .mockResolvedValueOnce(retryableResult);

    await expect(
      service.finishOutsideHoursChat(
        translate,
        queueChat,
        'Estamos fora do horário'
      )
    ).resolves.toBe(true);

    const pendingKey = 'underchat:chatbot-finish:account-1:worker-1:chat-1';
    const transitionPayload = String(transactions[0][0].args[1]);
    redis.zrangebyscore.mockResolvedValueOnce([pendingKey]);
    redis.get.mockResolvedValue(transitionPayload);

    await (
      service as unknown as {
        processScheduledFinishEffects: (t: never) => Promise<void>;
      }
    ).processScheduledFinishEffects(translate);

    const requeued = transactions.at(-1);
    expect(JSON.parse(String(requeued?.[0].args[1]))).toEqual(
      expect.objectContaining({
        source: 'outside_hours',
        phase: 'transition_pending',
        retryCount: 1,
      })
    );
    expect(requeued?.[1].args[1]).toBe(now + 30_000);
  });

  it('closes outside-hours chats without messaging contacts that ignore automation', async () => {
    const { service, chatService, chatLifecycleService, chatMessageService } =
      makeHarness();
    const queueChat = {
      ...makeChat(EChatStatus.queue),
      contact: { id: 'contact-1', ignore: EContactIgnore.ignore_automation },
    } as IChat;
    const outsideClosedChat = {
      ...queueChat,
      status: EChatStatus.closed,
      meta: {
        status_epoch: 1,
        status_event_id: 'status-event-1',
        status_source: 'outside_hours',
      },
    } as IChat;
    chatService.findChatByChatId.mockResolvedValueOnce(queueChat);
    chatLifecycleService.finishChat.mockResolvedValueOnce({
      outcome: 'applied',
      targetStatus: EChatStatus.closed,
      chat: outsideClosedChat,
      statusEventId: 'status-event-1',
      ownedBySource: true,
    });

    await expect(
      service.finishOutsideHoursChat(
        translate,
        queueChat,
        'Estamos fora do horário'
      )
    ).resolves.toBe(false);

    expect(chatMessageService.sendMessage).not.toHaveBeenCalled();
  });

  it('does not send outside-hours effects for a close owned by another source', async () => {
    const { service, chatService, chatLifecycleService, chatMessageService } =
      makeHarness();
    const queueChat = makeChat(EChatStatus.queue);
    const otherClosedChat = {
      ...queueChat,
      status: EChatStatus.closed,
      meta: {
        status_epoch: 2,
        status_event_id: 'manual-close-event',
        status_source: 'chat_service',
      },
    } as IChat;
    chatService.findChatByChatId.mockResolvedValueOnce(queueChat);
    chatLifecycleService.finishChat.mockResolvedValueOnce({
      outcome: 'already_at_target',
      targetStatus: EChatStatus.closed,
      chat: otherClosedChat,
      statusEventId: 'manual-close-event',
      ownedBySource: false,
    });

    await expect(
      service.finishOutsideHoursChat(
        translate,
        queueChat,
        'Estamos fora do horário'
      )
    ).resolves.toBe(true);

    expect(chatMessageService.sendMessage).not.toHaveBeenCalled();
  });

  it('does not execute automation effects when the chat is absent from persistence', async () => {
    const {
      service,
      chat,
      chatService,
      chatbotService,
      chatMessageService,
      centrifugoService,
    } = makeHarness();
    chatService.findChatByChatId.mockResolvedValue(null);
    const runner = service as unknown as {
      execute: ChatbotFlowRunnerService['execute'];
      processRedirectNode: jest.Mock;
    };
    runner.processRedirectNode = jest.fn(async () => true);
    const data = {
      account_id: chat.account.id,
      worker_id: chat.worker.id,
      type: EMessageType.text,
      message: {
        key: { id: 'message-missing-chat', fromMe: false },
        message: { conversation: 'olá' },
      },
    } as unknown as IUpsertMessage;

    await expect(
      runner.execute(translate, data, chat, 'chatbot-1')
    ).resolves.toBeNull();

    expect(chatbotService.findChatbotFlowByChatbotId).not.toHaveBeenCalled();
    expect(chatMessageService.sendMessage).not.toHaveBeenCalled();
    expect(runner.processRedirectNode).not.toHaveBeenCalled();
    expect(centrifugoService.publishSub).not.toHaveBeenCalled();
  });

  it('stops a delayed Kafka-triggered flow when its assignment is revoked', async () => {
    const {
      service,
      chat,
      chatService,
      chatbotService,
      chatMessageService,
      centrifugoService,
    } = makeHarness();
    let assignmentActive = true;
    const assertActive = jest.fn(() => {
      if (!assignmentActive) {
        throw new Error('Kafka consumer assignment was revoked');
      }
    });
    chatService.findChatByChatId.mockImplementationOnce(async () => {
      await Promise.resolve();
      assignmentActive = false;
      return chat;
    });
    const data = {
      account_id: chat.account.id,
      worker_id: chat.worker.id,
      type: EMessageType.text,
      message: {
        key: { id: 'message-revoked', fromMe: false },
        message: { conversation: 'olá' },
      },
    } as unknown as IUpsertMessage;

    await expect(
      service.execute(translate, data, chat, 'chatbot-1', undefined, {
        assertActive,
      })
    ).rejects.toThrow('Kafka consumer assignment was revoked');

    expect(assertActive).toHaveBeenCalledTimes(2);
    expect(
      chatbotService.findChatbotFlowConfigurationsByChatbotId
    ).not.toHaveBeenCalled();
    expect(chatMessageService.sendMessage).not.toHaveBeenCalled();
    expect(centrifugoService.publishSub).not.toHaveBeenCalled();
  });

  it('makes a failed finish trigger observable instead of silently succeeding', async () => {
    const { service, chat, chatService, chatbotService } = makeHarness();
    chatService.findChatByChatId.mockResolvedValue(chat);
    chatbotService.findChatbotFlowConfigurationsByChatbotId.mockResolvedValue({
      configurations: {
        finish_triggers: ['encerrar'],
        messages: {
          service_finished_message: 'Atendimento finalizado',
          service_finished_message_enabled: true,
        },
      },
    });
    const runner = service as unknown as {
      canTriggerChatbotEvent: jest.Mock;
      sendFinishMessage: jest.Mock;
      execute: ChatbotFlowRunnerService['execute'];
    };
    runner.canTriggerChatbotEvent = jest.fn(async () => true);
    runner.sendFinishMessage = jest.fn(async () => false);
    const data = {
      account_id: 'account-1',
      worker_id: 'worker-1',
      type: EMessageType.text,
      message: {
        key: { id: 'message-1', fromMe: false },
        message: { conversation: 'quero encerrar agora' },
      },
    } as unknown as IUpsertMessage;

    await expect(
      runner.execute(translate, data, chat, 'chatbot-1')
    ).rejects.toThrow('chatbot automatic finish was not confirmed');
  });

  it('persists an AI debounce for scheduler recovery with a seven-day payload TTL', async () => {
    const { service, chat, transactions } = makeHarness();
    const expiresAt = Date.now() + 3_000;
    const payload = {
      expiresAt,
      messages: ['primeira', 'segunda'],
      flowId: 'flow-1',
      chatbotId: 'chatbot-1',
      selectedAiAgentId: 'agent-1',
      lastMessageType: EMessageType.text,
      trackingId: 'delivery-event-1',
      retryCount: 0,
    };

    await (
      service as unknown as {
        setAiAgentDebounce: (
          createChat: IChat,
          value: typeof payload
        ) => Promise<void>;
      }
    ).setAiAgentDebounce(chat, payload);

    expect(transactions).toHaveLength(1);
    expect(transactions[0].map(({ command }) => command)).toEqual([
      'set',
      'zadd',
      'zrem',
    ]);
    expect(transactions[0][0].args).toEqual([
      'chatbot:ai-agent:debounce:account-1:worker-1:chat-1',
      JSON.stringify(payload),
      'EX',
      604800,
    ]);
    expect(transactions[0][1].args).toEqual([
      'underchat:chatbot-ai-agent-debounce-schedule',
      expiresAt,
      'chatbot:ai-agent:debounce:account-1:worker-1:chat-1',
    ]);
  });

  it('reuses the durable debounce event id as the outbound AI message id', async () => {
    const { service, chat } = makeHarness();
    const runner = service as unknown as {
      sendMessageWithStatusGuard: jest.Mock;
      storeLastAgentResponse: jest.Mock;
      shouldUpdateConversationSummary: jest.Mock;
      sendAiAgentResponse: (
        t: never,
        createChat: IChat,
        aiResponse: string,
        currentNode: ListChatbotFlowResponse['nodes'][number],
        selectedAiAgentId: string,
        conversationSummaryKey: string,
        userText: string,
        aiAgent: {
          base_url: string;
          api_key: string;
          model: string;
          ai_agent_type_id: string;
          voice_ia_id: null;
        },
        shouldStoreLastAgentResponse: boolean,
        recentMessages: Array<{
          role: 'user' | 'assistant';
          content: string;
        }>,
        inputMessageType: EMessageType,
        deliveryMessageId: string
      ) => Promise<boolean>;
    };
    runner.sendMessageWithStatusGuard = jest.fn(async () => true);
    runner.storeLastAgentResponse = jest.fn(async () => undefined);
    runner.shouldUpdateConversationSummary = jest.fn(async () => false);

    await expect(
      runner.sendAiAgentResponse(
        translate,
        chat,
        'Resposta confirmada',
        {
          id: 'ai-node',
          type: 'ai-agent',
          position: { x: 0, y: 0 },
          data: {},
        } as unknown as ListChatbotFlowResponse['nodes'][number],
        'agent-1',
        'summary-key',
        'Pergunta',
        {
          base_url: 'https://example.com/v1',
          api_key: 'test-key',
          model: 'test-model',
          ai_agent_type_id: 'provider-1',
          voice_ia_id: null,
        },
        true,
        [],
        EMessageType.text,
        'delivery-event-1'
      )
    ).resolves.toBe(true);

    expect(runner.sendMessageWithStatusGuard).toHaveBeenCalledWith(
      translate,
      expect.objectContaining({
        messageId: 'delivery-event-1',
        message: 'Resposta confirmada',
      })
    );
  });

  it('commits a chatbot inactivity redirect to a durable pending effect', async () => {
    const { service, chat, transactions } = makeHarness();
    const chatbotTransferService = {
      resolveTarget: jest.fn(async () => ({
        chatbotId: 'chatbot-target',
        status: EChatStatus.ura,
      })),
      transfer: jest.fn(),
    };
    const runner = service as unknown as {
      chatbotTransferService: typeof chatbotTransferService;
      queueInactivityChatbotRedirect: (
        t: never,
        createChat: IChat,
        data: IInactivityData,
        workerId: string,
        chatbotId: string
      ) => Promise<boolean>;
    };
    runner.chatbotTransferService = chatbotTransferService;

    await expect(
      runner.queueInactivityChatbotRedirect(
        translate,
        chat,
        {
          lastInteraction: Date.now(),
          alertCount: 1,
          lastAlertTime: Date.now(),
          chatbotId: 'chatbot-source',
          accountId: 'account-1',
          workerId: 'worker-1',
          chatId: 'chat-1',
          trackingId: 'tracking-1',
        },
        'worker-2',
        'chatbot-target'
      )
    ).resolves.toBe(true);

    expect(chatbotTransferService.resolveTarget).toHaveBeenCalled();
    expect(chatbotTransferService.transfer).not.toHaveBeenCalled();
    const effect = JSON.parse(String(transactions.at(-1)?.[0].args[1]));
    expect(effect).toEqual(
      expect.objectContaining({
        sourceWorkerId: 'worker-1',
        sourceChatbotId: 'chatbot-source',
        targetWorkerId: 'worker-2',
        targetChatbotId: 'chatbot-target',
        phase: 'transition_pending',
        retryCount: 0,
      })
    );
    expect(transactions.at(-1)?.map(({ command }) => command)).toEqual([
      'set',
      'zadd',
    ]);
  });

  it('persists the bootstrap phase after applying the chatbot transition', async () => {
    const { service, chat, transactions } = makeHarness();
    const transitionedChat = {
      ...chat,
      worker: { id: 'worker-2', name: 'Destino' },
      status: EChatStatus.ura,
      summary: null,
      meta: {
        assignment_event_id: 'operation-1',
        assignment_epoch: 100,
      },
    } as IChat;
    const chatbotTransferService = {
      resolveTarget: jest.fn(),
      transfer: jest.fn(async () => ({
        chat: transitionedChat,
        target: { chatbotId: 'chatbot-target' },
        transitioned: true,
      })),
    };
    const runner = service as unknown as {
      chatbotTransferService: typeof chatbotTransferService;
      clearChatbotRuntimeStateByIds: jest.Mock;
      executeInactivityRedirectEffect: (
        t: never,
        cacheKey: string,
        effect: Record<string, unknown>,
        ids: { accountId: string; chatId: string }
      ) => Promise<void>;
    };
    runner.chatbotTransferService = chatbotTransferService;
    runner.clearChatbotRuntimeStateByIds = jest.fn(async () => undefined);

    await runner.executeInactivityRedirectEffect(
      translate,
      'underchat:chatbot-inactivity-redirect:account-1:chat-1',
      {
        accountId: 'account-1',
        chatId: 'chat-1',
        sourceWorkerId: 'worker-1',
        sourceChatbotId: 'chatbot-source',
        targetWorkerId: 'worker-2',
        targetChatbotId: 'chatbot-target',
        operationId: 'operation-1',
        eventEpochMillis: 100,
        phase: 'transition_pending',
        expectedStatus: EChatStatus.ura,
        expectedStatusEventId: null,
        expectedStatusEpoch: null,
        expectedAssignmentEventId: null,
        expectedAssignmentEpoch: null,
        expectedLastMessageId: null,
        expectedSummaryRevision: 0,
        retryCount: 0,
      },
      { accountId: 'account-1', chatId: 'chat-1' }
    );

    expect(chatbotTransferService.transfer).toHaveBeenCalledTimes(1);
    expect(runner.clearChatbotRuntimeStateByIds).toHaveBeenCalledTimes(2);
    const bootstrapEffect = JSON.parse(
      String(transactions.at(-1)?.[0].args[1])
    );
    expect(bootstrapEffect).toEqual(
      expect.objectContaining({
        phase: 'bootstrap_pending',
        expectedAssignmentEventId: 'operation-1',
        postTransitionLastMessageId: null,
      })
    );
  });

  it('does not clear or bootstrap runtime changed by concurrent activity', async () => {
    const { service, chat, transactions } = makeHarness();
    const chatbotTransferService = {
      resolveTarget: jest.fn(),
      transfer: jest.fn(async () => ({
        chat,
        target: { chatbotId: 'chatbot-target' },
        transitioned: true,
        concurrentActivity: true,
      })),
    };
    const runner = service as unknown as {
      chatbotTransferService: typeof chatbotTransferService;
      clearChatbotRuntimeStateByIds: jest.Mock;
      executeInactivityRedirectEffect: (
        t: never,
        cacheKey: string,
        effect: Record<string, unknown>,
        ids: { accountId: string; chatId: string }
      ) => Promise<void>;
    };
    runner.chatbotTransferService = chatbotTransferService;
    runner.clearChatbotRuntimeStateByIds = jest.fn(async () => undefined);

    await runner.executeInactivityRedirectEffect(
      translate,
      'underchat:chatbot-inactivity-redirect:account-1:chat-1',
      {
        accountId: 'account-1',
        chatId: 'chat-1',
        sourceWorkerId: 'worker-1',
        sourceChatbotId: 'chatbot-source',
        targetWorkerId: 'worker-2',
        targetChatbotId: 'chatbot-target',
        operationId: 'operation-1',
        eventEpochMillis: 100,
        phase: 'transition_pending',
        expectedStatus: EChatStatus.ura,
        expectedStatusEventId: null,
        expectedStatusEpoch: null,
        expectedAssignmentEventId: null,
        expectedAssignmentEpoch: null,
        expectedLastMessageId: null,
        expectedSummaryRevision: 0,
        retryCount: 0,
      },
      { accountId: 'account-1', chatId: 'chat-1' }
    );

    expect(runner.clearChatbotRuntimeStateByIds).not.toHaveBeenCalled();
    expect(transactions.at(-1)?.map(({ command }) => command)).toEqual([
      'del',
      'zrem',
    ]);
  });

  it('bootstraps once and removes the durable redirect effect', async () => {
    const { service, chat, transactions } = makeHarness();
    chat.worker = { id: 'worker-2', name: 'Destino' };
    chat.meta = { assignment_event_id: 'operation-1' };
    chat.summary = null;
    const chatbotTransferService = {
      resolveTarget: jest.fn(async () => ({
        chatbotId: 'chatbot-target',
        status: EChatStatus.ura,
      })),
      transfer: jest.fn(),
    };
    const runner = service as unknown as {
      chatbotTransferService: typeof chatbotTransferService;
      bootstrapTransferredChatbot: jest.Mock;
      executeInactivityRedirectEffect: (
        t: never,
        cacheKey: string,
        effect: Record<string, unknown>,
        ids: { accountId: string; chatId: string }
      ) => Promise<void>;
    };
    runner.chatbotTransferService = chatbotTransferService;
    runner.bootstrapTransferredChatbot = jest.fn(async () => undefined);

    await runner.executeInactivityRedirectEffect(
      translate,
      'underchat:chatbot-inactivity-redirect:account-1:chat-1',
      {
        accountId: 'account-1',
        chatId: 'chat-1',
        sourceWorkerId: 'worker-1',
        sourceChatbotId: 'chatbot-source',
        targetWorkerId: 'worker-2',
        targetChatbotId: 'chatbot-target',
        operationId: 'operation-1',
        eventEpochMillis: 100,
        phase: 'bootstrap_pending',
        expectedStatus: EChatStatus.ura,
        expectedAssignmentEventId: 'operation-1',
        postTransitionLastMessageId: null,
        retryCount: 0,
      },
      { accountId: 'account-1', chatId: 'chat-1' }
    );

    expect(runner.bootstrapTransferredChatbot).toHaveBeenCalledWith(
      translate,
      chat,
      'chatbot-target',
      'operation-1',
      ['worker-1'],
      true,
      {
        expectedAssignmentEventId: 'operation-1',
        expectedLastMessageId: null,
      }
    );
    expect(transactions.at(-1)?.map(({ command }) => command)).toEqual([
      'del',
      'zrem',
    ]);
  });
});
