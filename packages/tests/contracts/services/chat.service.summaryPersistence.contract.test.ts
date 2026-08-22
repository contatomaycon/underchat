import 'reflect-metadata';

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
}));

import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { ChatService } from '@core/services/chat.service';
import { KafkaConsumerDispatchRevokedError } from '@core/common/exceptions/KafkaConsumerDispatchRevokedError';

describe('ChatService summary persistence', () => {
  interface AtomicSummaryState {
    revision: number;
    last_date_epoch_millis?: number;
    last_message_id?: string | null;
    last_processed_message_id: string | null;
    unread_count: number;
  }

  interface AtomicSummaryUpdateInput {
    source: string;
    params: {
      baseline: AtomicSummaryState;
      increment_unread_count: boolean;
      clear_unread_count?: boolean;
      processed_message_id: string | null;
    };
  }

  const makeService = () => {
    const elasticDatabaseService = {
      updateWithScriptOCC: jest.fn(async (..._args: unknown[]) => 'not_found'),
    };
    const service = new ChatService(
      {} as never,
      elasticDatabaseService as never,
      {} as never,
      {} as never
    );

    return { service, elasticDatabaseService };
  };

  it('does not create a partial chat during an atomic summary update', async () => {
    const { service, elasticDatabaseService } = makeService();

    await expect(
      service.updateChatSummaryAtomically(
        'missing-chat',
        'Hello',
        '2026-07-10T12:00:00.000Z',
        1_783_684_800_000,
        'message-1',
        'message-1',
        true,
        ETypeUserChat.client,
        true
      )
    ).resolves.toBe(false);

    expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalledWith(
      EElasticIndex.chat,
      'missing-chat',
      expect.not.objectContaining({ upsert: expect.anything() }),
      expect.objectContaining({ upsert: false })
    );
  });

  it('starts the first inbound summary with one unread and does not duplicate it on retry', async () => {
    const { service, elasticDatabaseService } = makeService();
    let persistedSummary: AtomicSummaryState | null = null;

    elasticDatabaseService.updateWithScriptOCC.mockImplementation(
      async (...args: unknown[]) => {
        const input = args[2] as AtomicSummaryUpdateInput;
        expect(input.source).toContain(
          'lastProcessed != params.processed_message_id'
        );

        if (!persistedSummary) {
          persistedSummary = { ...input.params.baseline };
          return 'updated';
        }

        if (
          input.params.increment_unread_count &&
          persistedSummary.last_processed_message_id !==
            input.params.processed_message_id
        ) {
          persistedSummary.unread_count += 1;
          persistedSummary.last_processed_message_id =
            input.params.processed_message_id;
          return 'updated';
        }

        return 'noop';
      }
    );

    const updateSummary = () =>
      service.updateChatSummaryAtomically(
        'chat-1',
        'Hello',
        '2026-07-10T12:00:00.000Z',
        1_783_684_800_000,
        'message-1',
        'message-1',
        true,
        ETypeUserChat.client,
        true
      );

    await expect(updateSummary()).resolves.toBe(true);
    await expect(updateSummary()).resolves.toBe(true);

    expect(persistedSummary).toEqual(
      expect.objectContaining({
        last_processed_message_id: 'message-1',
        unread_count: 1,
      })
    );
    expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalledTimes(2);
    expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalledWith(
      EElasticIndex.chat,
      'chat-1',
      expect.objectContaining({
        params: expect.objectContaining({
          baseline: expect.objectContaining({ unread_count: 1 }),
        }),
      }),
      expect.objectContaining({ upsert: false })
    );
  });

  it('updates the visible operator message and clears unread with one revision increment', async () => {
    const { service, elasticDatabaseService } = makeService();
    const state: AtomicSummaryState = {
      revision: 9,
      last_date_epoch_millis: 1_000,
      last_message_id: 'inbound-1',
      last_processed_message_id: 'inbound-1',
      unread_count: 4,
    };

    elasticDatabaseService.updateWithScriptOCC.mockImplementation(
      async (...args: unknown[]) => {
        const input = args[2] as AtomicSummaryUpdateInput;
        expect(input.source).toContain('params.clear_unread_count == true');
        expect(input.params.clear_unread_count).toBe(true);

        state.last_date_epoch_millis = 2_000;
        state.last_message_id = 'operator-1';
        state.unread_count = 0;
        state.revision += 1;
        return 'updated';
      }
    );

    await expect(
      service.updateChatSummaryAtomically(
        'chat-1',
        'Resposta',
        '2026-07-10T12:00:00.000Z',
        2_000,
        'operator-1',
        'operator-1',
        false,
        ETypeUserChat.operator,
        true,
        true
      )
    ).resolves.toBe(true);

    expect(state).toEqual({
      revision: 10,
      last_date_epoch_millis: 2_000,
      last_message_id: 'operator-1',
      last_processed_message_id: 'inbound-1',
      unread_count: 0,
    });
  });

  it('guards a summary clear with operation id and the observed last message', async () => {
    const { service, elasticDatabaseService } = makeService();
    jest.spyOn(service, 'findChatByChatId').mockResolvedValue({
      chat_id: 'chat-1',
      account: { id: 'account-1', name: 'Account' },
      worker: { id: 'worker-1', name: 'Worker' },
      name: 'Contact',
      phone: '5511999999999',
      status: EChatStatus.in_chat,
      date: '2026-07-10T12:00:00.000Z',
      summary: {
        revision: 8,
        last_message: 'new message',
        last_date: '2026-07-10T12:00:00.000Z',
        last_message_id: 'message-2',
        unread_count: 1,
      },
    });
    elasticDatabaseService.updateWithScriptOCC.mockResolvedValue('updated');

    await expect(
      service.clearChatSummary('chat-1', 'account-1', {
        operationId: 'clear-operation-1',
        enforceExpectedSummaryRevision: true,
        expectedSummaryRevision: 7,
        enforceExpectedLastMessageId: true,
        expectedLastMessageId: 'message-1',
      })
    ).resolves.toBe(true);

    expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalledWith(
      EElasticIndex.chat,
      'chat-1',
      expect.objectContaining({
        source: expect.stringContaining(
          'expectedLastMessageId.equals(currentLastMessageId)'
        ),
        params: {
          operation_id: 'clear-operation-1',
          enforce_expected_summary_revision: true,
          expected_summary_revision: 7,
          enforce_expected_last_message_id: true,
          expected_last_message_id: 'message-1',
        },
      }),
      expect.objectContaining({ upsert: false, refresh: true })
    );
  });

  it('recovers an already-applied clear after an ambiguous Elasticsearch response', async () => {
    const { service, elasticDatabaseService } = makeService();
    const findChat = jest.spyOn(service, 'findChatByChatId').mockResolvedValue({
      chat_id: 'chat-1',
      account: { id: 'account-1', name: 'Account' },
      worker: { id: 'worker-1', name: 'Worker' },
      name: 'Contact',
      phone: '5511999999999',
      status: EChatStatus.in_chat,
      date: '2026-07-10T12:00:00.000Z',
      meta: {
        clear_summary_operation_ids: ['clear-operation-duplicate'],
      },
      summary: {
        revision: 8,
        last_message: 'new message',
        last_date: '2026-07-10T12:00:00.000Z',
        last_message_id: 'message-2',
        unread_count: 0,
      },
    });
    elasticDatabaseService.updateWithScriptOCC.mockResolvedValue('noop');

    await expect(
      service.clearChatSummary('chat-1', 'account-1', {
        operationId: 'clear-operation-duplicate',
        enforceExpectedSummaryRevision: true,
        expectedSummaryRevision: 8,
        enforceExpectedLastMessageId: true,
        expectedLastMessageId: 'message-2',
      })
    ).resolves.toBe(true);

    expect(findChat).toHaveBeenCalledTimes(2);
  });

  it('does not start the clear mutation when the assignment is revoked during the chat read', async () => {
    const { service, elasticDatabaseService } = makeService();
    let active = true;
    jest.spyOn(service, 'findChatByChatId').mockImplementation(async () => {
      active = false;
      return {
        chat_id: 'chat-1',
        account: { id: 'account-1', name: 'Account' },
        worker: { id: 'worker-1', name: 'Worker' },
        name: 'Contact',
        phone: '5511999999999',
        status: EChatStatus.in_chat,
        date: '2026-07-10T12:00:00.000Z',
      };
    });
    const assertActive = jest.fn(() => {
      if (!active) {
        throw new KafkaConsumerDispatchRevokedError();
      }
    });

    await expect(
      service.clearChatSummary('chat-1', 'account-1', {
        operationId: 'clear-operation-revoked',
        enforceExpectedSummaryRevision: true,
        expectedSummaryRevision: 0,
        enforceExpectedLastMessageId: true,
        expectedLastMessageId: null,
        assertActive,
      })
    ).rejects.toBeInstanceOf(KafkaConsumerDispatchRevokedError);

    expect(elasticDatabaseService.updateWithScriptOCC).not.toHaveBeenCalled();
  });

  it('fails closed before the mutation for an unguarded direct clear', async () => {
    const { service, elasticDatabaseService } = makeService();
    jest.spyOn(service, 'findChatByChatId').mockResolvedValue({
      chat_id: 'chat-1',
      account: { id: 'account-1', name: 'Account' },
      worker: { id: 'worker-1', name: 'Worker' },
      name: 'Contact',
      phone: '5511999999999',
      status: EChatStatus.in_chat,
      date: '2026-07-10T12:00:00.000Z',
      summary: {
        last_message: 'message',
        last_date: '2026-07-10T12:00:00.000Z',
        unread_count: 1,
      },
    });

    await expect(service.clearChatSummary('chat-1', 'account-1')).resolves.toBe(
      false
    );

    expect(elasticDatabaseService.updateWithScriptOCC).not.toHaveBeenCalled();
  });

  it('does not clear unread from a later-arriving message whose WhatsApp timestamp is older and leaves last_message_id unchanged', async () => {
    const { service, elasticDatabaseService } = makeService();
    const persistedSummary: AtomicSummaryState = {
      revision: 7,
      last_date_epoch_millis: 2_000,
      last_message_id: 'message-visible',
      last_processed_message_id: 'message-visible',
      unread_count: 1,
    };

    jest.spyOn(service, 'findChatByChatId').mockResolvedValue({
      chat_id: 'chat-1',
      account: { id: 'account-1', name: 'Account' },
      worker: { id: 'worker-1', name: 'Worker' },
      name: 'Contact',
      phone: '5511999999999',
      status: EChatStatus.in_chat,
      date: '2026-07-10T12:00:00.000Z',
      summary: {
        revision: 7,
        last_message: 'visible',
        last_date: '2026-07-10T12:00:00.000Z',
        last_date_epoch_millis: 2_000,
        last_message_id: 'message-visible',
        last_processed_message_id: 'message-visible',
        unread_count: 1,
      },
    });

    elasticDatabaseService.updateWithScriptOCC.mockImplementation(
      async (...args: unknown[]) => {
        const input = args[2] as {
          source: string;
          params: Record<string, unknown>;
        };

        if ('processed_message_id' in input.params) {
          expect(input.source).toContain(
            'summary.revision = summary.revision.longValue() + 1L'
          );
          expect(input.params.last_date_epoch_millis).toBe(1_000);
          expect(input.params.processed_message_id).toBe(
            'message-arrived-later'
          );

          // The older timestamp must not replace the visible last message, but
          // the distinct physical message still mutates unread/revision.
          persistedSummary.unread_count += 1;
          persistedSummary.last_processed_message_id = input.params
            .processed_message_id as string;
          persistedSummary.revision += 1;
          return 'updated';
        }

        expect(input.source).toContain(
          'expectedSummaryRevision.longValue() != currentSummaryRevision'
        );
        expect(input.source).toContain('summary.unread_count = 0');
        if (
          input.params.expected_summary_revision !== persistedSummary.revision
        ) {
          return 'noop';
        }

        persistedSummary.unread_count = 0;
        persistedSummary.revision += 1;
        return 'updated';
      }
    );

    await expect(
      service.updateChatSummaryAtomically(
        'chat-1',
        'older timestamp',
        '2026-07-10T11:59:59.000Z',
        1_000,
        'message-arrived-later',
        'message-arrived-later',
        true,
        ETypeUserChat.client,
        true
      )
    ).resolves.toBe(true);

    await expect(
      service.clearChatSummary('chat-1', 'account-1', {
        operationId: 'clear-created-at-revision-7',
        enforceExpectedSummaryRevision: true,
        expectedSummaryRevision: 7,
        enforceExpectedLastMessageId: true,
        expectedLastMessageId: 'message-visible',
      })
    ).resolves.toBe(false);

    expect(persistedSummary).toEqual({
      revision: 8,
      last_date_epoch_millis: 2_000,
      last_message_id: 'message-visible',
      last_processed_message_id: 'message-arrived-later',
      unread_count: 2,
    });
  });

  it('keeps the revision check and unread reset in one OCC script for multi-pod serialization', async () => {
    const { service, elasticDatabaseService } = makeService();
    jest.spyOn(service, 'findChatByChatId').mockResolvedValue({
      chat_id: 'chat-1',
      account: { id: 'account-1', name: 'Account' },
      worker: { id: 'worker-1', name: 'Worker' },
      name: 'Contact',
      phone: '5511999999999',
      status: EChatStatus.in_chat,
      date: '2026-07-10T12:00:00.000Z',
      summary: {
        revision: 11,
        last_message: 'message',
        last_date: '2026-07-10T12:00:00.000Z',
        last_message_id: 'message-11',
        unread_count: 3,
      },
    });
    elasticDatabaseService.updateWithScriptOCC.mockResolvedValue('updated');

    await expect(
      service.clearChatSummary('chat-1', 'account-1', {
        operationId: 'clear-revision-11',
        enforceExpectedSummaryRevision: true,
        expectedSummaryRevision: 11,
        enforceExpectedLastMessageId: true,
        expectedLastMessageId: 'message-11',
      })
    ).resolves.toBe(true);

    const call = elasticDatabaseService.updateWithScriptOCC.mock.calls[0];
    expect(call).toBeDefined();
    const [, , rawInput, options] = call ?? [];
    const input = rawInput as {
      source: string;
      params: Record<string, unknown>;
    };
    expect(input.source).toEqual(
      expect.stringContaining(
        'expectedSummaryRevision.longValue() != currentSummaryRevision'
      )
    );
    expect(input.source).toEqual(
      expect.stringContaining('summary.revision = currentSummaryRevision + 1L')
    );
    expect(input.params).toEqual(
      expect.objectContaining({
        operation_id: 'clear-revision-11',
        enforce_expected_summary_revision: true,
        expected_summary_revision: 11,
      })
    );
    expect(options).toEqual(
      expect.objectContaining({
        upsert: false,
        maxRetries: 5,
        refresh: true,
      })
    );
  });

  it('preserves a later inbound unread when the clear wins OCC serialization first', async () => {
    const { service, elasticDatabaseService } = makeService();
    const state: AtomicSummaryState = {
      revision: 4,
      last_date_epoch_millis: 2_000,
      last_message_id: 'message-visible',
      last_processed_message_id: 'message-visible',
      unread_count: 2,
    };
    jest.spyOn(service, 'findChatByChatId').mockResolvedValue({
      chat_id: 'chat-1',
      account: { id: 'account-1', name: 'Account' },
      worker: { id: 'worker-1', name: 'Worker' },
      name: 'Contact',
      phone: '5511999999999',
      status: EChatStatus.in_chat,
      date: '2026-07-10T12:00:00.000Z',
      summary: {
        revision: 4,
        last_message: 'visible',
        last_date: '2026-07-10T12:00:00.000Z',
        last_message_id: 'message-visible',
        unread_count: 2,
      },
    });
    elasticDatabaseService.updateWithScriptOCC.mockImplementation(
      async (...args: unknown[]) => {
        const input = args[2] as {
          params: Record<string, unknown>;
        };
        if ('expected_summary_revision' in input.params) {
          if (input.params.expected_summary_revision !== state.revision) {
            return 'noop';
          }
          state.unread_count = 0;
          state.revision += 1;
          return 'updated';
        }

        state.unread_count += 1;
        state.last_processed_message_id = input.params
          .processed_message_id as string;
        state.revision += 1;
        return 'updated';
      }
    );

    await expect(
      service.clearChatSummary('chat-1', 'account-1', {
        operationId: 'clear-revision-4',
        enforceExpectedSummaryRevision: true,
        expectedSummaryRevision: 4,
        enforceExpectedLastMessageId: true,
        expectedLastMessageId: 'message-visible',
      })
    ).resolves.toBe(true);
    await expect(
      service.updateChatSummaryAtomically(
        'chat-1',
        'older inbound',
        '2026-07-10T11:59:59.000Z',
        1_000,
        'message-after-clear',
        'message-after-clear',
        true,
        ETypeUserChat.client,
        true
      )
    ).resolves.toBe(true);

    expect(state).toEqual({
      revision: 6,
      last_date_epoch_millis: 2_000,
      last_message_id: 'message-visible',
      last_processed_message_id: 'message-after-clear',
      unread_count: 1,
    });
  });
});
