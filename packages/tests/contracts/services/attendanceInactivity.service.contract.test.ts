import 'reflect-metadata';

jest.mock('file-type', () => ({
  fileTypeFromBuffer: jest.fn(async () => null),
}));

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
}));

jest.mock('@core/common/functions/withLock', () => ({
  withLock: jest.fn(
    async (_redis: unknown, _key: string, fn: () => Promise<unknown>) => fn()
  ),
}));

import { AttendanceInactivityService } from '@core/services/attendanceInactivity.service';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';

function createRedisFake() {
  const values = new Map<string, string>();
  const scores = new Map<string, number>();
  const redis: any = {};

  redis.get = jest.fn(async (key: string) => values.get(key) ?? null);
  redis.set = jest.fn(
    async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && values.has(key)) {
        return null;
      }
      values.set(key, value);
      return 'OK';
    }
  );
  redis.del = jest.fn(async (key: string) => (values.delete(key) ? 1 : 0));
  redis.zadd = jest.fn(
    async (_scheduleKey: string, score: number, member: string) => {
      scores.set(member, Number(score));
      return 1;
    }
  );
  redis.zrem = jest.fn(async (_scheduleKey: string, member: string) =>
    scores.delete(member) ? 1 : 0
  );
  redis.zscore = jest.fn(async (_scheduleKey: string, member: string) => {
    const score = scores.get(member);
    return score === undefined ? null : String(score);
  });
  redis.zrangebyscore = jest.fn(
    async (
      _scheduleKey: string,
      _min: number,
      max: number,
      ..._args: unknown[]
    ) =>
      [...scores.entries()]
        .filter(([, score]) => score <= Number(max))
        .sort((left, right) => left[1] - right[1])
        .slice(0, 100)
        .map(([member]) => member)
  );
  redis.zscan = jest.fn(async () => [
    '0',
    [...scores.entries()].flatMap(([member, score]) => [member, String(score)]),
  ]);
  redis.scan = jest.fn(async () => [
    '0',
    [...values.keys()].filter((key) =>
      key.startsWith('underchat:attendance-inactivity:')
    ),
  ]);
  redis.persist = jest.fn(async (key: string) => (values.has(key) ? 1 : 0));
  redis.eval = jest.fn(
    async (_script: string, _keyCount: number, key: string, value: string) => {
      if (values.get(key) !== value) {
        return 0;
      }
      values.delete(key);
      return 1;
    }
  );
  redis.multi = jest.fn(() => {
    const commands: Array<{ name: string; args: unknown[] }> = [];
    const transaction: any = {};

    for (const name of ['set', 'del', 'zadd', 'zrem']) {
      transaction[name] = (...args: unknown[]) => {
        commands.push({ name, args });
        return transaction;
      };
    }

    transaction.exec = jest.fn(async () => {
      const results: Array<[null, unknown]> = [];
      for (const command of commands) {
        results.push([null, await redis[command.name](...command.args)]);
      }
      return results;
    });

    return transaction;
  });

  return { redis, values, scores };
}

function readPayload(values: Map<string, string>, key: string): any {
  const payload = values.get(key);
  if (!payload) {
    throw new Error(`missing test payload: ${key}`);
  }

  return JSON.parse(payload);
}

function createChat(status = EChatStatus.in_chat): any {
  return {
    chat_id: 'chat-1',
    account: { id: 'account-1' },
    worker: { id: 'worker-1' },
    status,
    name: 'Contato',
    phone: '5511999999999',
    date: new Date().toISOString(),
    message_key: { remote_jid: '5511999999999@s.whatsapp.net' },
    forward_to_output_chatbot: true,
  };
}

function createService(options?: {
  chat?: any;
  quantity?: number;
  time?: number;
  outputChatbot?: boolean;
}) {
  const redisState = createRedisFake();
  let currentChat = options?.chat ?? createChat();
  const config = {
    enabled: true,
    quantity: options?.quantity ?? 1,
    time: options?.time ?? 1,
    action: 'finish' as const,
    inactivity_message_enabled: true,
    inactivity_message: 'Aviso de inatividade',
  };
  const chatService = {
    findChatByChatId: jest.fn(async () => currentChat),
    findMessageByMessageId: jest.fn(async () => null),
    findLastHumanMessageByChatId: jest.fn<
      Promise<{
        message_id?: string;
        date?: string;
        type_user: ETypeUserChat;
      }>,
      unknown[]
    >(async () => ({ type_user: ETypeUserChat.operator })),
    findLastAttendanceActivityByChatId: jest.fn<
      Promise<{
        message_id?: string;
        date?: string;
        type_user: ETypeUserChat;
      } | null>,
      unknown[]
    >(async () => null),
    getOrCreateChatProtocol: jest.fn(async () => null),
    getLatestProtocolByType: jest.fn(() => null),
  };
  const chatMessageService = {
    sendMessage: jest.fn<Promise<boolean>, [unknown, Record<string, unknown>]>(
      async () => true
    ),
  };
  const workerConfigService = {
    viewAttendanceInactivityAlert: jest.fn(async () => config),
    viewChatbots: jest.fn(async () => ({
      enabled: options?.outputChatbot ?? false,
      output_chatbot_id: options?.outputChatbot ? 'chatbot-output-1' : null,
    })),
  };
  const workerService = {
    viewWorkerConfigFieldsByWorkerId: jest.fn(async () => ({
      send_message_on_finish_attendance: null,
    })),
  };
  const chatbotFlowRunnerService = {
    clearFlowCacheForChat: jest.fn(async () => undefined),
    execute: jest.fn<Promise<string | null>, unknown[]>(
      async () => 'flow-node-1'
    ),
  };
  const chatLifecycleService = {
    finishChat: jest.fn(async () => {
      currentChat = {
        ...currentChat,
        status: EChatStatus.closed,
        closed_at: new Date().toISOString(),
        meta: {
          status_event_id: 'status-event-1',
          status_source: 'attendance_inactivity',
        },
      };
      return {
        outcome: 'applied',
        targetStatus: EChatStatus.closed,
        chat: currentChat,
        statusEventId: 'status-event-1',
        ownedBySource: true,
      };
    }),
  };

  const service = new AttendanceInactivityService(
    redisState.redis,
    chatService as never,
    chatMessageService as never,
    workerConfigService as never,
    workerService as never,
    chatbotFlowRunnerService as never,
    chatLifecycleService as never
  );

  return {
    service,
    ...redisState,
    chatService,
    chatMessageService,
    workerConfigService,
    workerService,
    chatbotFlowRunnerService,
    chatLifecycleService,
    getCurrentChat: () => currentChat,
    setCurrentChat: (chat: any) => {
      currentChat = chat;
    },
  };
}

const translate = ((key: string) => key) as never;

describe('AttendanceInactivityService reliable scheduler', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-09T12:00:00.000Z'));
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('stores payload and schedule atomically without the legacy TTL', async () => {
    const { service, redis, values, scores } = createService();
    const chat = createChat();

    await service.resetOnOperatorMessage(chat);

    const cacheKey =
      'underchat:attendance-inactivity:account-1:worker-1:chat-1';
    const payload = readPayload(values, cacheKey);

    expect(payload).toEqual(
      expect.objectContaining({
        tracking_id: expect.any(String),
        retry_count: 0,
        stage: 'waiting_alert',
        lastHumanInteractor: 'operator',
      })
    );
    expect(scores.get(cacheKey)).toBe(Date.now() + 60_000);
    expect(redis.set).toHaveBeenCalledWith(cacheKey, expect.any(String));
    expect(redis.set).not.toHaveBeenCalledWith(
      cacheKey,
      expect.any(String),
      'EX',
      expect.anything()
    );
  });

  it('revalidates stale chats inside reset and start locks', async () => {
    const state = createService();
    const { service, values, scores, workerConfigService } = state;
    const staleInChat = createChat(EChatStatus.in_chat);
    const cacheKey =
      'underchat:attendance-inactivity:account-1:worker-1:chat-1';
    state.setCurrentChat({ ...staleInChat, status: EChatStatus.closed });

    values.set(cacheKey, '{"legacy":true}');
    scores.set(cacheKey, Date.now());
    await service.resetOnOperatorMessage(staleInChat);

    expect(values.has(cacheKey)).toBe(false);
    expect(scores.has(cacheKey)).toBe(false);

    values.set(cacheKey, '{"legacy":true}');
    scores.set(cacheKey, Date.now());
    await service.startTrackingOnInChatEntry(staleInChat);

    expect(values.has(cacheKey)).toBe(false);
    expect(scores.has(cacheKey)).toBe(false);
    expect(
      workerConfigService.viewAttendanceInactivityAlert
    ).not.toHaveBeenCalled();
  });

  it('waits one full interval after the last alert before closing', async () => {
    const { service, chatMessageService, chatLifecycleService, values } =
      createService();
    const chat = createChat();
    const cacheKey =
      'underchat:attendance-inactivity:account-1:worker-1:chat-1';

    await service.resetOnOperatorMessage(chat);
    jest.advanceTimersByTime(60_000);
    await service.processScheduledInactivityChecks(translate);

    expect(chatLifecycleService.finishChat).not.toHaveBeenCalled();
    expect(chatMessageService.sendMessage).toHaveBeenCalledTimes(1);
    const alertOptions = chatMessageService.sendMessage.mock.calls[0]?.[1];
    expect(alertOptions).toEqual(
      expect.objectContaining({
        messageId: expect.any(String),
      })
    );
    expect(alertOptions?.hash).toBe(alertOptions?.messageId);
    expect(readPayload(values, cacheKey)).toEqual(
      expect.objectContaining({ alertCount: 1, stage: 'waiting_close' })
    );

    await service.processScheduledInactivityChecks(translate);
    expect(chatLifecycleService.finishChat).not.toHaveBeenCalled();

    jest.advanceTimersByTime(60_000);
    await service.processScheduledInactivityChecks(translate);

    expect(chatLifecycleService.finishChat).toHaveBeenCalledWith({
      chat: expect.objectContaining({ status: EChatStatus.in_chat }),
      source: 'attendance_inactivity',
      expectedStatuses: [EChatStatus.in_chat],
      respectOutputChatbot: true,
      statusEventId: expect.any(String),
    });
    expect(values.has(cacheKey)).toBe(false);
    expect(chatMessageService.sendMessage).toHaveBeenCalledTimes(2);
    const auditOptions = chatMessageService.sendMessage.mock.calls[1]?.[1];
    expect(auditOptions).toEqual(
      expect.objectContaining({
        type: 'annotation',
        messageId: expect.any(String),
      })
    );
    expect(auditOptions?.hash).toBe(auditOptions?.messageId);
  });

  it('retains and resumes output chatbot bootstrap without repeating alerts', async () => {
    const state = createService({ outputChatbot: true });
    const { service, values, scores, chatbotFlowRunnerService } = state;
    const cacheKey =
      'underchat:attendance-inactivity:account-1:worker-1:chat-1';
    const now = Date.now();
    const trackedData = {
      lastInteraction: now - 120_000,
      alertCount: 1,
      lastAlertTime: now - 60_000,
      lastHumanInteractor: 'operator',
      accountId: 'account-1',
      workerId: 'worker-1',
      chatId: 'chat-1',
      tracking_id: 'tracking-1',
      retry_count: 0,
      stage: 'waiting_close',
    };
    values.set(cacheKey, JSON.stringify(trackedData));
    scores.set(cacheKey, now);

    state.chatLifecycleService.finishChat.mockImplementation(async () => {
      const outputChat = {
        ...state.getCurrentChat(),
        status: EChatStatus.ura_output,
        forward_to_output_chatbot: false,
        meta: {
          status_event_id: 'output-event-1',
          status_source: 'attendance_inactivity',
        },
      };
      state.setCurrentChat(outputChat);
      return {
        outcome: 'applied',
        targetStatus: EChatStatus.ura_output,
        chat: outputChat,
        statusEventId: 'output-event-1',
        ownedBySource: true,
      };
    });
    chatbotFlowRunnerService.execute.mockResolvedValueOnce(null);

    await service.processScheduledInactivityChecks(translate);

    expect(readPayload(values, cacheKey)).toEqual(
      expect.objectContaining({
        stage: 'bootstrapping_output',
        retry_count: 1,
        alertCount: 1,
      })
    );
    expect(scores.get(cacheKey)).toBe(now + 30_000);

    state.chatLifecycleService.finishChat.mockResolvedValue({
      outcome: 'already_at_target',
      targetStatus: EChatStatus.ura_output,
      chat: state.getCurrentChat(),
      statusEventId: 'output-event-1',
      ownedBySource: true,
    });
    jest.advanceTimersByTime(30_000);
    await service.processScheduledInactivityChecks(translate);

    expect(chatbotFlowRunnerService.execute).toHaveBeenCalledTimes(2);
    expect(values.has(cacheKey)).toBe(false);
  });

  it('isolates item failures and retries with exponential backoff', async () => {
    const state = createService({ quantity: 2 });
    const { service, values, scores, chatService, chatMessageService } = state;
    const now = Date.now();
    const firstKey =
      'underchat:attendance-inactivity:account-1:worker-1:chat-1';
    const secondKey =
      'underchat:attendance-inactivity:account-2:worker-2:chat-2';
    const makePayload = (
      accountId: string,
      workerId: string,
      chatId: string
    ) => ({
      lastInteraction: now - 60_000,
      alertCount: 0,
      lastAlertTime: null,
      lastHumanInteractor: 'operator',
      accountId,
      workerId,
      chatId,
      tracking_id: `tracking-${chatId}`,
      retry_count: 0,
      stage: 'waiting_alert',
    });
    values.set(
      firstKey,
      JSON.stringify(makePayload('account-1', 'worker-1', 'chat-1'))
    );
    values.set(
      secondKey,
      JSON.stringify(makePayload('account-2', 'worker-2', 'chat-2'))
    );
    scores.set(firstKey, now);
    scores.set(secondKey, now);
    chatService.findChatByChatId
      .mockRejectedValueOnce(new Error('Elasticsearch unavailable'))
      .mockResolvedValueOnce({
        ...createChat(),
        chat_id: 'chat-2',
        account: { id: 'account-2' },
        worker: { id: 'worker-2' },
      });

    await service.processScheduledInactivityChecks(translate);

    expect(readPayload(values, firstKey)).toEqual(
      expect.objectContaining({ retry_count: 1, alertCount: 0 })
    );
    expect(scores.get(firstKey)).toBe(now + 30_000);
    expect(readPayload(values, secondKey)).toEqual(
      expect.objectContaining({ retry_count: 0, alertCount: 1 })
    );
    expect(chatMessageService.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('does not overwrite fresh tracking while requeueing a failed attempt', async () => {
    const { service, values, scores } = createService();
    const cacheKey =
      'underchat:attendance-inactivity:account-1:worker-1:chat-1';
    const now = Date.now();
    const failedData = {
      lastInteraction: now - 120_000,
      alertCount: 0,
      lastAlertTime: null,
      accountId: 'account-1',
      workerId: 'worker-1',
      chatId: 'chat-1',
      tracking_id: 'tracking-old',
      retry_count: 0,
      stage: 'waiting_alert',
    };
    values.set(
      cacheKey,
      JSON.stringify({
        ...failedData,
        lastInteraction: now,
        tracking_id: 'tracking-new',
      })
    );
    scores.set(cacheKey, now + 60_000);

    await (service as any).rescheduleFailedCheck(
      cacheKey,
      failedData,
      new Error('stale failure')
    );

    expect(readPayload(values, cacheKey)).toEqual(
      expect.objectContaining({
        tracking_id: 'tracking-new',
        retry_count: 0,
        lastInteraction: now,
      })
    );
    expect(scores.get(cacheKey)).toBe(now + 60_000);
  });

  it('rearms instead of closing when a human message was persisted before reset', async () => {
    const state = createService();
    const { service, values, scores, chatService, chatLifecycleService } =
      state;
    (service as any).scheduleReconciled = true;
    const cacheKey =
      'underchat:attendance-inactivity:account-1:worker-1:chat-1';
    const now = Date.now();
    values.set(
      cacheKey,
      JSON.stringify({
        lastInteraction: now - 120_000,
        alertCount: 1,
        lastAlertTime: now - 60_000,
        lastHumanInteractor: 'operator',
        accountId: 'account-1',
        workerId: 'worker-1',
        chatId: 'chat-1',
        tracking_id: 'tracking-old',
        retry_count: 0,
        stage: 'waiting_close',
        last_human_message_id: 'message-old',
      })
    );
    scores.set(cacheKey, now);
    chatService.findLastAttendanceActivityByChatId.mockResolvedValueOnce({
      message_id: 'message-new',
      date: new Date(now).toISOString(),
      type_user: ETypeUserChat.client,
    });

    await service.processScheduledInactivityChecks(translate);

    expect(chatLifecycleService.finishChat).not.toHaveBeenCalled();
    expect(readPayload(values, cacheKey)).toEqual(
      expect.objectContaining({
        alertCount: 0,
        last_human_message_id: 'message-new',
        lastHumanInteractor: 'client',
      })
    );
    expect(scores.get(cacheKey)).toBe(now + 60_000);
  });

  it('acks a pre-transition finalizer from an older reopened session', async () => {
    const reopenedChat = {
      ...createChat(EChatStatus.in_chat),
      meta: {
        status_epoch: 2,
        status_event_id: 'session-new',
        status_source: 'chat_service',
      },
    };
    const state = createService({ chat: reopenedChat });
    const { service, values, scores, chatLifecycleService } = state;
    (service as any).scheduleReconciled = true;
    const cacheKey =
      'underchat:attendance-inactivity:account-1:worker-1:chat-1';
    const now = Date.now();
    values.set(
      cacheKey,
      JSON.stringify({
        lastInteraction: now - 120_000,
        alertCount: 1,
        lastAlertTime: now - 60_000,
        lastHumanInteractor: 'operator',
        accountId: 'account-1',
        workerId: 'worker-1',
        chatId: 'chat-1',
        tracking_id: 'tracking-old',
        retry_count: 0,
        stage: 'finishing',
        target_status_event_id: 'close-old',
        expected_status_event_id: 'session-old',
        expected_status_epoch: 1,
        expected_started_at: null,
      })
    );
    scores.set(cacheKey, now);

    await service.processScheduledInactivityChecks(translate);

    expect(chatLifecycleService.finishChat).not.toHaveBeenCalled();
    expect(values.has(cacheKey)).toBe(false);
    expect(scores.has(cacheKey)).toBe(false);
  });

  it('does not bootstrap the same output status event twice', async () => {
    const outputChat = {
      ...createChat(EChatStatus.ura_output),
      meta: {
        status_event_id: 'output-event-1',
        status_source: 'attendance_inactivity',
      },
    };
    const { service, chatbotFlowRunnerService } = createService({
      chat: outputChat,
      outputChatbot: true,
    });

    await (service as any).bootstrapOutputChatbotIfNeeded(
      translate,
      outputChat,
      'output-event-1'
    );
    await (service as any).bootstrapOutputChatbotIfNeeded(
      translate,
      outputChat,
      'output-event-1'
    );

    expect(chatbotFlowRunnerService.execute).toHaveBeenCalledTimes(1);
    expect(chatbotFlowRunnerService.execute).toHaveBeenCalledWith(
      translate,
      expect.any(Object),
      outputChat,
      'chatbot-output-1',
      undefined,
      { requireHandled: true, executionId: 'output-event-1' }
    );
  });

  it('rearms an eligible legacy member whose payload expired', async () => {
    const { service, values, scores, redis } = createService({ time: 2 });
    const cacheKey =
      'underchat:attendance-inactivity:account-1:worker-1:chat-1';
    scores.set(cacheKey, Date.now() - 1);

    await service.reconcileScheduledInactivityChecks();

    expect(redis.persist).not.toHaveBeenCalledWith(cacheKey);
    expect(readPayload(values, cacheKey)).toEqual(
      expect.objectContaining({
        alertCount: 0,
        retry_count: 0,
        stage: 'waiting_alert',
      })
    );
    expect(scores.get(cacheKey)).toBe(Date.now() + 120_000);
  });

  it('rearms an eligible payload missing from the schedule only once', async () => {
    const { service, values, scores, redis } = createService({ time: 2 });
    const cacheKey =
      'underchat:attendance-inactivity:account-1:worker-1:chat-1';
    values.set(
      cacheKey,
      JSON.stringify({
        lastInteraction: Date.now() - 60_000,
        alertCount: 0,
        lastAlertTime: null,
        lastHumanInteractor: 'operator',
        accountId: 'account-1',
        workerId: 'worker-1',
        chatId: 'chat-1',
      })
    );

    await service.reconcileScheduledInactivityChecks();
    const firstScheduledTime = scores.get(cacheKey);

    expect(redis.persist).toHaveBeenCalledWith(cacheKey);
    expect(firstScheduledTime).toBe(Date.now() + 120_000);
    expect(readPayload(values, cacheKey)).toEqual(
      expect.objectContaining({
        tracking_id: expect.any(String),
        retry_count: 0,
        stage: 'waiting_alert',
      })
    );

    jest.advanceTimersByTime(30_000);
    await service.reconcileScheduledInactivityChecks();

    expect(scores.get(cacheKey)).toBe(firstScheduledTime);
  });

  it('removes invalid and inapplicable payloads missing from the schedule', async () => {
    const state = createService({ chat: createChat(EChatStatus.closed) });
    const { service, values, scores } = state;
    const inapplicableKey =
      'underchat:attendance-inactivity:account-1:worker-1:chat-1';
    const invalidKey =
      'underchat:attendance-inactivity:account-2:worker-2:chat-2';
    values.set(
      inapplicableKey,
      JSON.stringify({
        lastInteraction: Date.now() - 60_000,
        alertCount: 0,
        lastAlertTime: null,
        accountId: 'account-1',
        workerId: 'worker-1',
        chatId: 'chat-1',
      })
    );
    values.set(invalidKey, '{invalid-json');

    await service.reconcileScheduledInactivityChecks();

    expect(values.has(inapplicableKey)).toBe(false);
    expect(values.has(invalidKey)).toBe(false);
    expect(scores.has(inapplicableKey)).toBe(false);
    expect(scores.has(invalidKey)).toBe(false);
  });

  it.each([
    {
      caseName: 'chat was reopened',
      currentSnapshot: {
        ...createChat(EChatStatus.in_chat),
        meta: {
          status_event_id: 'status-event-1',
          status_source: 'attendance_inactivity',
        },
      },
    },
    {
      caseName: 'status event ownership was lost',
      currentSnapshot: {
        ...createChat(EChatStatus.closed),
        meta: { status_source: 'attendance_inactivity' },
      },
    },
  ])(
    'suppresses finish effects when $caseName before ownership check',
    async ({ currentSnapshot }) => {
      const state = createService();
      const { service, values, scores, chatMessageService } = state;
      const cacheKey =
        'underchat:attendance-inactivity:account-1:worker-1:chat-1';
      const now = Date.now();
      values.set(
        cacheKey,
        JSON.stringify({
          lastInteraction: now - 120_000,
          alertCount: 1,
          lastAlertTime: now - 60_000,
          lastHumanInteractor: 'operator',
          accountId: 'account-1',
          workerId: 'worker-1',
          chatId: 'chat-1',
          tracking_id: 'tracking-1',
          retry_count: 0,
          stage: 'waiting_close',
        })
      );
      scores.set(cacheKey, now);

      state.chatLifecycleService.finishChat.mockImplementation(async () => {
        const closedSnapshot = {
          ...createChat(EChatStatus.closed),
          meta: {
            status_event_id: 'status-event-1',
            status_source: 'attendance_inactivity',
          },
        };
        state.setCurrentChat(currentSnapshot);
        return {
          outcome: 'applied',
          targetStatus: EChatStatus.closed,
          chat: closedSnapshot,
          statusEventId: 'status-event-1',
          ownedBySource: true,
        };
      });

      await service.processScheduledInactivityChecks(translate);

      expect(chatMessageService.sendMessage).not.toHaveBeenCalled();
      expect(values.has(cacheKey)).toBe(false);
      expect(scores.has(cacheKey)).toBe(false);
    }
  );

  it('keeps tracking and suppresses final messages when lifecycle fails', async () => {
    const state = createService();
    const { service, values, scores, chatMessageService } = state;
    const cacheKey =
      'underchat:attendance-inactivity:account-1:worker-1:chat-1';
    const now = Date.now();
    values.set(
      cacheKey,
      JSON.stringify({
        lastInteraction: now - 120_000,
        alertCount: 1,
        lastAlertTime: now - 60_000,
        lastHumanInteractor: 'operator',
        accountId: 'account-1',
        workerId: 'worker-1',
        chatId: 'chat-1',
        tracking_id: 'tracking-1',
        retry_count: 0,
        stage: 'waiting_close',
      })
    );
    scores.set(cacheKey, now);
    state.chatLifecycleService.finishChat.mockResolvedValue({
      outcome: 'retryable_failure',
      targetStatus: EChatStatus.closed,
      chat: state.getCurrentChat(),
      statusEventId: '',
      ownedBySource: false,
    });

    await service.processScheduledInactivityChecks(translate);

    expect(values.has(cacheKey)).toBe(true);
    expect(readPayload(values, cacheKey)).toEqual(
      expect.objectContaining({ stage: 'finishing', retry_count: 1 })
    );
    expect(scores.get(cacheKey)).toBe(now + 30_000);
    expect(chatMessageService.sendMessage).not.toHaveBeenCalled();
  });
});
