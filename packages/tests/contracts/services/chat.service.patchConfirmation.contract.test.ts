import 'reflect-metadata';

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
}));

import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import type { IChat } from '@core/common/interfaces/IChat';
import { ChatService } from '@core/services/chat.service';

describe('ChatService patch confirmation', () => {
  const account = { id: 'account-1', name: 'Account' };
  const worker = {
    id: '01900000-0000-7000-8000-000000000201',
    name: 'Worker',
  };
  const label = {
    label_template_id: 'label-1',
    label: 'Priority',
    color: '#112233',
  };

  const makeChat = (overrides: Partial<IChat> = {}): IChat =>
    ({
      chat_id: 'chat-1',
      account,
      worker,
      name: 'Contact',
      phone: '5561999999999',
      status: EChatStatus.in_chat,
      date: '2026-07-11T12:00:00.000Z',
      secondary_users: [],
      message_key: null,
      label: null,
      ...overrides,
    }) as IChat;

  const makeService = (confirmedChat?: IChat) => {
    const eventId = '01900000-0000-7000-8000-000000000101';
    const outboundWebhookEventService = {
      prepareBestEffort: jest.fn(async () => ({
        eventId,
        envelope: {
          id: eventId,
          type: 'chat.labels.changed',
          api_version: '1',
          occurred_at: '2026-07-11T12:00:01.000Z',
          account_id: account.id,
          aggregate: { type: 'chat', id: 'chat-1' },
          data: {},
        },
        created: true,
        state: 'preparing',
      })),
      completeBestEffort: jest.fn(async () => true),
    };
    const elasticDatabaseService = {
      indices: jest.fn(async () => true),
      updateWithScriptOCC: jest.fn(async () => 'updated'),
      getById: jest.fn(async () => confirmedChat ?? null),
    };
    const service = new ChatService(
      {} as never,
      elasticDatabaseService as never,
      {} as never,
      {} as never,
      outboundWebhookEventService as never
    );

    return {
      eventId,
      service,
      elasticDatabaseService,
      outboundWebhookEventService,
    };
  };

  it('accepts an Elasticsearch confirmation whose object keys were reordered', async () => {
    const previousChat = makeChat();
    const confirmedChat = makeChat({
      label: [
        {
          color: label.color,
          label: label.label,
          label_template_id: label.label_template_id,
        },
      ],
      meta: {
        labels_epoch: 1,
        labels_event_id: 'labels-event-1',
        outbound_webhook_event_ids: ['01900000-0000-7000-8000-000000000101'],
      },
    });
    const { service, outboundWebhookEventService } = makeService(confirmedChat);

    await expect(
      service.updateChatLabel('chat-1', [label], 1, 'labels-event-1', {
        eventTypes: ['chat.labels.changed'],
        idempotencyKey: 'chat-labels:chat-1:labels-event-1',
        source: 'manager_api',
        previousChat,
        changes: { labels: [label] },
      })
    ).resolves.toBe(true);

    expect(outboundWebhookEventService.completeBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: '01900000-0000-7000-8000-000000000101',
        accountId: account.id,
      })
    );
  });

  it('keeps the labels revision domain when all labels are removed', async () => {
    const { service, elasticDatabaseService } = makeService();

    await expect(
      service.updateChatLabel('chat-1', null, 8, 'labels-event-8')
    ).resolves.toBe(true);

    expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalledWith(
      EElasticIndex.chat,
      'chat-1',
      expect.objectContaining({
        params: expect.objectContaining({
          patch: { label: null },
          domain: 'labels',
          event_epoch_millis: 8,
          event_id: 'labels-event-8',
        }),
      }),
      expect.any(Object)
    );
  });

  it('keeps the assignment revision domain when user and sector are cleared', async () => {
    const { service, elasticDatabaseService } = makeService();

    await expect(
      service.updateChatUserAndSector(
        'chat-1',
        null,
        null,
        9,
        'assignment-event-9'
      )
    ).resolves.toBe(true);

    expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalledWith(
      EElasticIndex.chat,
      'chat-1',
      expect.objectContaining({
        source: expect.stringContaining("if (patch.containsKey('sector'))"),
        params: expect.objectContaining({
          patch: { user: null, sector: null },
          domain: 'assignment',
          event_epoch_millis: 9,
          event_id: 'assignment-event-9',
        }),
      }),
      expect.any(Object)
    );
  });

  it('persists and finalizes a generated protocol from the canonical chat', async () => {
    const initialChat = makeChat({ protocol_start: [] });
    const {
      eventId,
      service,
      elasticDatabaseService,
      outboundWebhookEventService,
    } = makeService();
    elasticDatabaseService.getById
      .mockResolvedValueOnce(initialChat)
      .mockImplementationOnce(async () => {
        const updateCalls = elasticDatabaseService.updateWithScriptOCC.mock
          .calls as unknown as unknown[][];
        const updateInput = updateCalls[0]?.[2] as
          { params: { protocol: string } } | undefined;
        if (!updateInput) {
          throw new Error('protocol update was not persisted');
        }
        return makeChat({
          protocol_start: [updateInput.params.protocol],
          meta: { outbound_webhook_event_ids: [eventId] },
        });
      });

    const protocol = await service.getOrCreateChatProtocol(
      account.id,
      'chat-1',
      'protocol_start'
    );

    expect(protocol).toEqual(expect.any(String));
    expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalledWith(
      EElasticIndex.chat,
      'chat-1',
      expect.objectContaining({
        source: expect.stringContaining('params.protocol_type'),
        params: expect.objectContaining({
          protocol_type: 'protocol_start',
          protocol,
          outbound_webhook_event_ids: [eventId],
        }),
      }),
      { upsert: false, maxRetries: 5, refresh: true }
    );
    expect(outboundWebhookEventService.completeBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ eventId, accountId: account.id })
    );
  });

  it('persists and finalizes a satisfaction response', async () => {
    const previousChat = makeChat();
    const response = {
      question: 'How was the service?',
      options: [{ id: 'great', text: 'Great' }],
      response: { id: 'great', text: 'Great' },
      analyst: { id: 'user-1', name: 'Analyst' },
    };
    const confirmedChat = makeChat({
      satisfaction_response: response,
      meta: {
        outbound_webhook_event_ids: ['01900000-0000-7000-8000-000000000101'],
      },
    });
    const { service, outboundWebhookEventService } = makeService(confirmedChat);

    await expect(
      service.updateChatSatisfactionResponse('chat-1', response, {
        eventTypes: ['chat.satisfaction.updated'],
        idempotencyKey: 'chat-satisfaction:chat-1:great',
        source: 'chatbot_flow',
        previousChat,
        changes: { satisfaction: response },
      })
    ).resolves.toBe(true);

    expect(outboundWebhookEventService.completeBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: '01900000-0000-7000-8000-000000000101',
        accountId: account.id,
      })
    );
  });
});
