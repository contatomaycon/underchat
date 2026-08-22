import 'reflect-metadata';

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) =>
    jid.replace(/@c\.us$/, '@s.whatsapp.net')
  ),
}));

import { EChatStatus } from '@core/common/enums/EChatStatus';
import type { IChat } from '@core/common/interfaces/IChat';
import type { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { ChatService } from '@core/services/chat.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { KafkaConsumerDispatchRevokedError } from '@core/common/exceptions/KafkaConsumerDispatchRevokedError';
import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';

describe('ChatService chat identity lookup', () => {
  const account = { id: 'account-1', name: 'Account' };
  const worker = {
    id: '01900000-0000-7000-8000-000000000099',
    name: 'Worker',
  };

  function makeChat(overrides: Partial<IChat> = {}): IChat {
    return {
      chat_id: 'chat-1',
      account,
      worker,
      name: 'Contact',
      phone: '556195999040',
      status: EChatStatus.queue,
      date: '2026-06-28T12:00:00.000Z',
      secondary_users: [],
      message_key: null,
      ...overrides,
    } as IChat;
  }

  function makeOfficialOutboundMessage(
    overrides: Partial<IChatMessage> = {}
  ): IChatMessage {
    return {
      message_id: 'internal-template-1',
      chat_id: 'chat-1',
      account,
      worker,
      type_user: ETypeUserChat.operator,
      phone: '556195999040',
      date: '2026-08-17T12:00:00.000Z',
      message_key: {
        id: 'wamid.outbound-template-1',
        from_me: true,
        is_view_once: false,
      },
      content: {
        type: EMessageType.official_template,
        official_template: {
          id: 'template-1',
          name: 'welcome',
          language: 'pt_BR',
          status: 'APPROVED',
          components: [],
          variables: [],
          preview: {},
        },
      },
      summary: {
        is_sent: true,
        is_delivered: false,
        is_seen: false,
      },
      ...overrides,
    } as IChatMessage;
  }

  function makeOutboundWebhookEventService(
    eventId: string,
    eventType: string,
    aggregateId: string
  ): Record<string, jest.Mock> {
    return {
      prepareBestEffort: jest.fn(async () => ({
        eventId,
        envelope: {
          id: eventId,
          type: eventType,
          api_version: '1',
          occurred_at: '2026-07-10T12:00:00.000Z',
          account_id: account.id,
          aggregate: { type: 'chat', id: aggregateId },
          data: {},
        },
        created: true,
        state: 'preparing',
      })),
      completeBestEffort: jest.fn(async () => true),
      cancel: jest.fn(async () => undefined),
    };
  }

  function makeService(
    selectResult: unknown,
    cachedValue: string | null = null,
    outboundWebhookEventService?: Record<string, jest.Mock>
  ): {
    service: ChatService;
    redis: {
      get: jest.Mock;
      set: jest.Mock;
      del: jest.Mock;
    };
    elasticDatabaseService: {
      indices: jest.Mock;
      createDocument: jest.Mock;
      getById: jest.Mock;
      select: jest.Mock;
      updateWithOCC: jest.Mock;
      updateWithScriptOCC: jest.Mock;
    };
  } {
    const redis = {
      get: jest.fn(async () => cachedValue),
      set: jest.fn(async () => 'OK'),
      del: jest.fn(async () => 1),
    };
    const elasticDatabaseService = {
      indices: jest.fn(async () => true),
      createDocument: jest.fn(async () => 'created'),
      getById: jest.fn(async () => null),
      select: jest.fn(async () => selectResult),
      updateWithOCC: jest.fn(async () => 'updated'),
      updateWithScriptOCC: jest.fn(async () => 'updated'),
    };
    const service = new ChatService(
      redis as never,
      elasticDatabaseService as never,
      {} as never,
      {} as never,
      outboundWebhookEventService as never
    );

    return { service, redis, elasticDatabaseService };
  }

  it('routes a channel transfer to both the previous and current channel', () => {
    const previousChannelId = '01900000-0000-7000-8000-000000000010';
    const currentChannelId = '01900000-0000-7000-8000-000000000011';
    const previousChat = makeChat({
      worker: { id: previousChannelId, name: 'Previous channel' },
    });
    const currentChat = makeChat({
      worker: { id: currentChannelId, name: 'Current channel' },
    });
    const { service } = makeService({ hits: { hits: [] } });

    const resolveChannelIds = (
      service as unknown as {
        resolveChatWebhookChannelIds(
          chat: IChat,
          previousChat?: IChat | null
        ): string[];
      }
    ).resolveChatWebhookChannelIds.bind(service);

    expect(resolveChannelIds(currentChat, previousChat)).toEqual([
      previousChannelId,
      currentChannelId,
    ]);
  });

  it('finds only real client inbound messages after the pending template', async () => {
    const inboundMessage = {
      message_id: 'wamid.inbound',
      chat_id: 'chat-1',
      type_user: 'client',
      date: '2026-07-21T13:18:16.517Z',
      message_key: { from_me: false },
    } as unknown as IChatMessage;
    const { service, elasticDatabaseService } = makeService({
      hits: { hits: [{ _source: inboundMessage }] },
    });

    await expect(
      service.findLastInboundMessageByChatIdAfter(
        account.id,
        'chat-1',
        '2026-07-21T13:17:47.811Z'
      )
    ).resolves.toEqual(inboundMessage);

    const elasticQuery = elasticDatabaseService.select.mock.calls[0][1] as {
      query: { bool: { must_not: unknown[] } };
    };
    const query = JSON.stringify(elasticQuery);
    expect(query).toContain('"type_user":"client"');
    expect(query).toContain('"gt":"2026-07-21T13:17:47.811Z"');
    expect(elasticQuery.query.bool.must_not).toEqual(
      expect.arrayContaining([
        {
          nested: {
            path: 'message_key',
            query: { term: { 'message_key.from_me': true } },
          },
        },
        {
          nested: {
            path: 'content',
            query: {
              nested: {
                path: 'content.official',
                query: { term: { 'content.official.echo': true } },
              },
            },
          },
        },
      ])
    );
  });

  it('finds one official inbound message by its exact provider id for window repair', async () => {
    const inboundMessage = {
      message_id: 'internal-inbound-1',
      chat_id: 'chat-1',
      type_user: 'client',
      date: '2026-08-16T17:24:05.000Z',
      message_key: {
        id: 'wamid.inbound-1',
        from_me: false,
      },
      content: {
        official: {
          echo: false,
          raw: { id: 'wamid.inbound-1', timestamp: '1786800363' },
        },
      },
    } as unknown as IChatMessage;
    const { service, elasticDatabaseService } = makeService({
      hits: { hits: [{ _source: inboundMessage }] },
    });

    await expect(
      service.findOfficialInboundMessageByProviderId(
        account.id,
        worker.id,
        'wamid.inbound-1'
      )
    ).resolves.toEqual(inboundMessage);

    const query = JSON.stringify(
      elasticDatabaseService.select.mock.calls[0][1]
    );
    expect(query).toContain('"account.id":"account-1"');
    expect(query).toContain(`"worker.id":"${worker.id}"`);
    expect(query).toContain('"message_key.id":"wamid.inbound-1"');
    expect(query).toContain('"type_user":"client"');
    expect(query).toContain('"message_key.from_me":true');
  });

  it('resolves an exact outbound official template hit through realtime GET', async () => {
    const message = makeOfficialOutboundMessage();
    const { service, elasticDatabaseService } = makeService({
      hits: {
        hits: [
          {
            _id: 'physical-template-document-1',
            _source: makeOfficialOutboundMessage({
              delivery_status: 'failed',
            }),
          },
        ],
      },
    });
    elasticDatabaseService.getById.mockResolvedValueOnce(message);

    await expect(
      service.findOfficialOutboundMessageByProviderId(
        account.id,
        worker.id,
        'wamid.outbound-template-1'
      )
    ).resolves.toBe(message);

    expect(elasticDatabaseService.select).toHaveBeenCalledWith(
      EElasticIndex.message,
      expect.objectContaining({ size: 1, _source: false })
    );
    const query = JSON.stringify(
      elasticDatabaseService.select.mock.calls[0][1]
    );
    expect(query).toContain('"account.id":"account-1"');
    expect(query).toContain(`"worker.id":"${worker.id}"`);
    expect(query).toContain('"message_key.id":"wamid.outbound-template-1"');
    expect(query).toContain('"message_key.from_me":true');
    expect(query).toContain('"content.type":"official_template"');
    expect(query).toContain('"type_user":["operator","bot","system"]');
    expect(elasticDatabaseService.getById).toHaveBeenCalledWith(
      EElasticIndex.message,
      'physical-template-document-1'
    );
  });

  it.each([
    ['', worker.id, 'wamid.outbound-template-1'],
    [account.id, '', 'wamid.outbound-template-1'],
    [account.id, worker.id, '   '],
  ])(
    'rejects an incomplete outbound provider identity without searching',
    async (accountId, workerId, providerMessageId) => {
      const { service, elasticDatabaseService } = makeService({
        hits: { hits: [] },
      });

      await expect(
        service.findOfficialOutboundMessageByProviderId(
          accountId,
          workerId,
          providerMessageId
        )
      ).resolves.toBeNull();

      expect(elasticDatabaseService.select).not.toHaveBeenCalled();
      expect(elasticDatabaseService.getById).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['missing physical id', { _source: makeOfficialOutboundMessage() }, null],
    ['deleted realtime document', { _id: 'stale-document-1' }, null],
  ])(
    'rejects a stale outbound search hit: %s',
    async (_caseName, hit, realtimeMessage) => {
      const { service, elasticDatabaseService } = makeService({
        hits: { hits: [hit] },
      });
      elasticDatabaseService.getById.mockResolvedValueOnce(realtimeMessage);

      await expect(
        service.findOfficialOutboundMessageByProviderId(
          account.id,
          worker.id,
          'wamid.outbound-template-1'
        )
      ).resolves.toBeNull();

      if ('_id' in hit) {
        expect(elasticDatabaseService.getById).toHaveBeenCalledWith(
          EElasticIndex.message,
          hit._id
        );
      } else {
        expect(elasticDatabaseService.getById).not.toHaveBeenCalled();
      }
    }
  );

  it.each([
    [
      'account',
      makeOfficialOutboundMessage({
        account: { id: 'account-other', name: 'Other' },
      }),
    ],
    [
      'worker',
      makeOfficialOutboundMessage({
        worker: { id: 'worker-other', name: 'Other' },
      }),
    ],
    [
      'provider id',
      makeOfficialOutboundMessage({
        message_key: {
          id: 'wamid.other',
          from_me: true,
          is_view_once: false,
        },
      }),
    ],
    [
      'outbound direction',
      makeOfficialOutboundMessage({
        message_key: {
          id: 'wamid.outbound-template-1',
          from_me: false,
          is_view_once: false,
        },
      }),
    ],
    [
      'outbound actor',
      makeOfficialOutboundMessage({ type_user: ETypeUserChat.client }),
    ],
    [
      'official template content',
      makeOfficialOutboundMessage({
        content: { type: EMessageType.text, message: 'not a template' },
      }),
    ],
  ])(
    'rejects a realtime outbound hit with mismatched %s',
    async (_field, realtimeMessage) => {
      const { service, elasticDatabaseService } = makeService({
        hits: { hits: [{ _id: 'physical-template-document-1' }] },
      });
      elasticDatabaseService.getById.mockResolvedValueOnce(realtimeMessage);

      await expect(
        service.findOfficialOutboundMessageByProviderId(
          account.id,
          worker.id,
          'wamid.outbound-template-1'
        )
      ).resolves.toBeNull();
    }
  );

  it('repairs only the exact official inbound document timestamp', async () => {
    const { service, elasticDatabaseService } = makeService({
      hits: { hits: [] },
    });

    await expect(
      service.repairOfficialInboundMessageTimestamp({
        accountId: account.id,
        workerId: worker.id,
        internalMessageId: 'internal-inbound-1',
        providerMessageId: 'wamid.inbound-1',
        correctedAt: '2026-08-15T13:26:03.000Z',
      })
    ).resolves.toBe(true);

    expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalledWith(
      EElasticIndex.message,
      'internal-inbound-1',
      expect.objectContaining({
        source: expect.stringContaining(
          'ctx._source.message_key.id != params.provider_message_id'
        ),
        params: {
          account_id: account.id,
          worker_id: worker.id,
          provider_message_id: 'wamid.inbound-1',
          client_type: 'client',
          corrected_at: '2026-08-15T13:26:03.000Z',
        },
      }),
      { maxRetries: 5 }
    );
  });

  it('finds an open chat by phone, JID aliases and cross remote JID fields', async () => {
    const chat = makeChat();
    const { service, elasticDatabaseService } = makeService({
      hits: { hits: [{ _source: chat }] },
    });

    const result = await service.findOpenChatByIdentity(
      'account-1',
      'worker-1',
      {
        phone: '556195999040',
        remoteJid: '158733669765176@lid',
        remoteJidAlt: '556195999040@c.us',
      }
    );

    expect(result?.chat_id).toBe('chat-1');
    expect(result?.message_key).toEqual({
      remote_jid: '158733669765176@lid',
      remote_jid_alt: '556195999040@s.whatsapp.net',
    });

    expect(elasticDatabaseService.select).toHaveBeenCalledWith(
      EElasticIndex.chat,
      expect.any(Object)
    );

    const query = JSON.stringify(
      elasticDatabaseService.select.mock.calls[0][1]
    );
    expect(query).toContain('"worker.id":"worker-1"');
    expect(query).toContain(
      '"status":["in_chat","queue","ura","ura_output","ura_schedule","ura_webhook"]'
    );
    expect(query).not.toContain('"closed"');
    expect(query).toContain('556195999040');
    expect(query).toContain('5561995999040');
    expect(query).toContain('158733669765176@lid');
    expect(query).toContain('556195999040@s.whatsapp.net');
    expect(query).toContain('556195999040@c.us');
    expect(query).toContain('message_key.remote_jid');
    expect(query).toContain('message_key.remote_jid_alt');

    expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalledWith(
      EElasticIndex.chat,
      'chat-1',
      expect.objectContaining({
        params: {
          remote_jid: '158733669765176@lid',
          remote_jid_alt: '556195999040@s.whatsapp.net',
        },
      }),
      { maxRetries: 5 }
    );
  });

  it('ignores closed cached chats and falls back to Elasticsearch open-chat lookup', async () => {
    const closedChat = makeChat({
      chat_id: 'closed-chat',
      status: EChatStatus.closed,
    });
    const openChat = makeChat({ chat_id: 'open-chat' });
    const { service, redis, elasticDatabaseService } = makeService(
      { hits: { hits: [{ _source: openChat }] } },
      JSON.stringify(closedChat)
    );

    const result = await service.findOpenChatByIdentity(
      'account-1',
      'worker-1',
      { phone: '556195999040' }
    );

    expect(result?.chat_id).toBe('open-chat');
    expect(redis.del).toHaveBeenCalled();
    expect(elasticDatabaseService.select).toHaveBeenCalledTimes(1);
  });

  it('patches an isolated remoteJidAlt into remote_jid_alt without promoting it to remote_jid', async () => {
    const chat = makeChat();
    const { service, elasticDatabaseService } = makeService({
      hits: { hits: [{ _source: chat }] },
    });

    const result = await service.findOpenChatByIdentity(
      'account-1',
      'worker-1',
      {
        remoteJidAlt: '556195999040@c.us',
      }
    );

    expect(result?.message_key).toEqual({
      remote_jid_alt: '556195999040@s.whatsapp.net',
    });
    expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalledWith(
      EElasticIndex.chat,
      'chat-1',
      expect.objectContaining({
        params: {
          remote_jid: null,
          remote_jid_alt: '556195999040@s.whatsapp.net',
        },
      }),
      { maxRetries: 5 }
    );
  });

  it('prevents saving a second open chat with an existing identity in the same worker', async () => {
    const existingChat = makeChat({
      chat_id: 'chat-existing',
      message_key: {
        remote_jid: '158733669765176@lid',
        remote_jid_alt: '556195999040@s.whatsapp.net',
      },
    });
    const duplicateChat = makeChat({
      chat_id: 'chat-duplicate',
      message_key: {
        remote_jid: '158733669765176@lid',
        remote_jid_alt: '556195999040@s.whatsapp.net',
      },
    });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const { service, elasticDatabaseService } = makeService({
      hits: { hits: [] },
    });
    elasticDatabaseService.select
      .mockResolvedValueOnce({ hits: { hits: [] } })
      .mockResolvedValueOnce({ hits: { hits: [{ _source: existingChat }] } });

    try {
      await expect(service.saveChat(duplicateChat)).resolves.toBe(false);

      expect(elasticDatabaseService.updateWithScriptOCC).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        '[ChatService] Open chat identity conflict prevented',
        expect.objectContaining({
          incoming_chat_id: 'chat-duplicate',
          existing_chat_id: 'chat-existing',
        })
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('allows saving an already persisted open chat even when legacy duplicates exist', async () => {
    const persistedChat = makeChat({
      chat_id: 'chat-persisted',
      message_key: {
        remote_jid: '158733669765176@lid',
        remote_jid_alt: '556195999040@s.whatsapp.net',
      },
    });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const { service, elasticDatabaseService } = makeService({
      hits: { hits: [{ _source: persistedChat }] },
    });

    try {
      await expect(service.saveChat(persistedChat)).resolves.toBe(true);

      expect(elasticDatabaseService.select).toHaveBeenCalledTimes(2);
      expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('confirms a saved chat when Elasticsearch reorders nested object keys', async () => {
    const persistedChat = makeChat({
      status: EChatStatus.in_chat,
      worker: { id: worker.id, name: worker.name, type_id: undefined },
      user: {
        id: 'user-1',
        name: 'Operator',
        photo: null,
        entered_at: '2026-07-11T11:00:00.000Z',
      },
      sector: {
        id: 'sector-1',
        name: 'Support',
        color: '#123456',
      },
      label: [
        {
          label_template_id: 'label-1',
          label: 'Priority',
          color: '#FF0000',
        },
        {
          label_template_id: 'label-2',
          label: 'Customer',
          color: '#00FF00',
        },
      ],
    });
    const elasticSnapshot = {
      ...persistedChat,
      account: {
        name: persistedChat.account.name,
        id: persistedChat.account.id,
      },
      worker: { name: persistedChat.worker.name, id: persistedChat.worker.id },
      user: persistedChat.user
        ? {
            entered_at: persistedChat.user.entered_at,
            photo: persistedChat.user.photo,
            name: persistedChat.user.name,
            id: persistedChat.user.id,
          }
        : null,
      sector: persistedChat.sector
        ? {
            color: persistedChat.sector.color,
            name: persistedChat.sector.name,
            id: persistedChat.sector.id,
          }
        : null,
      label: persistedChat.label?.map((label) => ({
        color: label.color,
        label: label.label,
        label_template_id: label.label_template_id,
      })),
    } as IChat;
    const { service, elasticDatabaseService } = makeService({
      hits: { hits: [] },
    });
    elasticDatabaseService.getById
      .mockResolvedValueOnce(persistedChat)
      .mockResolvedValueOnce(elasticSnapshot);

    await expect(
      service.saveChat(persistedChat, { refresh: true })
    ).resolves.toBe(true);
  });

  it('creates a new chat without status metadata through a non-scripted upsert and confirms the persisted snapshot', async () => {
    const newChat = makeChat({
      chat_id: 'chat-new',
      meta: undefined,
      name: null,
    });
    const { service, elasticDatabaseService } = makeService({
      hits: { hits: [] },
    });
    let persistedChat: IChat | null = null;

    elasticDatabaseService.getById.mockImplementation(
      async () => persistedChat
    );
    elasticDatabaseService.updateWithScriptOCC.mockImplementation(
      async (
        _index: string,
        _chatId: string,
        input: {
          params: Record<string, unknown>;
          upsert?: Record<string, unknown>;
          scriptedUpsert?: boolean;
        }
      ) => {
        const upsert = input.upsert as Partial<IChat> | undefined;
        persistedChat = upsert ? ({ ...newChat, ...upsert } as IChat) : null;
        return 'created';
      }
    );

    await expect(service.saveChat(newChat)).resolves.toBe(true);

    expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalledWith(
      EElasticIndex.chat,
      'chat-new',
      expect.objectContaining({
        scriptedUpsert: false,
        params: expect.objectContaining({
          enforce_expected_status_revision: true,
          expected_status_event_id: null,
          expected_status_epoch: null,
          event_epoch_millis: expect.any(Number),
          event_id: expect.any(String),
        }),
        upsert: expect.objectContaining({
          chat_id: 'chat-new',
          name: null,
          status: EChatStatus.queue,
          meta: expect.objectContaining({
            status_epoch: expect.any(Number),
            status_event_id: expect.any(String),
            status_source: 'chat_service',
          }),
        }),
      }),
      expect.objectContaining({
        upsert: true,
      })
    );
    expect(elasticDatabaseService.getById).toHaveBeenCalledTimes(2);
    expect(newChat.meta).toEqual(
      expect.objectContaining({
        status_epoch: expect.any(Number),
        status_event_id: expect.any(String),
        status_source: 'chat_service',
      })
    );
  });

  it('does not confirm a new chat when the upsert cannot be read back', async () => {
    const newChat = makeChat({
      chat_id: 'chat-not-persisted',
      meta: undefined,
    });
    const { service, elasticDatabaseService } = makeService({
      hits: { hits: [] },
    });
    elasticDatabaseService.updateWithScriptOCC.mockResolvedValue('noop');

    await expect(service.saveChat(newChat)).resolves.toBe(false);

    expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalledWith(
      EElasticIndex.chat,
      'chat-not-persisted',
      expect.objectContaining({
        scriptedUpsert: false,
      }),
      expect.objectContaining({
        upsert: true,
      })
    );
    expect(elasticDatabaseService.getById).toHaveBeenCalledTimes(2);
  });

  it('prefers a direct Elasticsearch GET when finding chat by chat_id', async () => {
    const chat = makeChat();
    const { service, elasticDatabaseService } = makeService({
      hits: { hits: [] },
    });
    elasticDatabaseService.getById.mockResolvedValueOnce(chat);

    const result = await service.findChatByChatId('account-1', 'chat-1');

    expect(result?.chat_id).toBe('chat-1');
    expect(elasticDatabaseService.getById).toHaveBeenCalledWith(
      EElasticIndex.chat,
      'chat-1'
    );
    expect(elasticDatabaseService.select).not.toHaveBeenCalled();
  });

  it('prefers realtime GET when finding a freshly persisted message', async () => {
    const message = {
      message_id: 'message-1',
      chat_id: 'chat-1',
      account,
      worker,
      type_user: 'user',
      phone: '556195999040',
      date: '2026-07-10T12:00:00.000Z',
      content: { text: 'Hello' },
      summary: {},
    } as unknown as IChatMessage;
    const { service, elasticDatabaseService } = makeService({
      hits: { hits: [] },
    });
    elasticDatabaseService.getById.mockResolvedValueOnce(message);

    const result = await service.findMessageByMessageId(
      'account-1',
      'message-1'
    );

    expect(result).toBe(message);
    expect(elasticDatabaseService.getById).toHaveBeenCalledWith(
      EElasticIndex.message,
      'message-1'
    );
    expect(elasticDatabaseService.select).not.toHaveBeenCalled();
  });

  it('removes untyped official raw_data before indexing without mutating the message', async () => {
    const rawData = {
      from: {
        server: 'lid',
        _serialized: '34330059530273@lid',
        user: '34330059530273',
      },
      templateId: 'pedido_brasil',
    };
    const message = {
      message_id: 'message-legacy-raw-data',
      chat_id: 'chat-1',
      account,
      worker,
      type_user: 'user',
      phone: '556195999040',
      date: '2026-07-21T12:00:00.000Z',
      content: {
        type: 'text',
        message: 'Seu pedido foi registrado.',
        official: {
          provider: 'meta_whatsapp',
          type: 'template',
          raw: {
            type: 'template',
            template: { name: 'pedido_brasil' },
            raw_data: rawData,
          },
        },
      },
      summary: {},
    } as unknown as IChatMessage;
    const { service, elasticDatabaseService } = makeService({
      hits: { hits: [] },
    });

    await expect(service.createMessageIdempotent(message)).resolves.toEqual({
      created: true,
      conflict: false,
      id: message.message_id,
      attempted: true,
    });

    const persistedMessage = elasticDatabaseService.createDocument.mock
      .calls[0]?.[2] as IChatMessage;
    expect(persistedMessage.content?.official?.raw).toEqual({
      type: 'template',
      template: { name: 'pedido_brasil' },
    });
    expect(persistedMessage).not.toHaveProperty(
      'content.official.raw.raw_data'
    );
    expect(message.content?.official?.raw?.raw_data).toBe(rawData);
  });

  it('rejects a direct message document owned by another account', async () => {
    const message = {
      message_id: 'message-1',
      account: { id: 'account-2', name: 'Other' },
    } as unknown as IChatMessage;
    const { service, elasticDatabaseService } = makeService({
      hits: { hits: [] },
    });
    elasticDatabaseService.getById.mockResolvedValueOnce(message);

    await expect(
      service.findMessageByMessageId('account-1', 'message-1')
    ).resolves.toBeNull();
    expect(elasticDatabaseService.select).not.toHaveBeenCalled();
  });

  it('uses realtime GET after resolving a legacy message document id by search', async () => {
    const staleMessage = {
      message_id: 'message-1',
      account,
      content: { type: 'text', message: 'before', version: [] },
    } as unknown as IChatMessage;
    const freshMessage = {
      ...staleMessage,
      content: {
        type: 'text',
        message: 'before',
        version: [
          {
            type: 'text',
            message: 'after',
            date: '2026-07-11T12:00:00.000Z',
          },
        ],
      },
    } as unknown as IChatMessage;
    const { service, elasticDatabaseService } = makeService({
      hits: {
        hits: [{ _id: 'legacy-physical-id', _source: staleMessage }],
      },
    });
    elasticDatabaseService.getById
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(freshMessage);

    await expect(
      service.findMessageByMessageId('account-1', 'message-1')
    ).resolves.toBe(freshMessage);

    expect(elasticDatabaseService.getById).toHaveBeenNthCalledWith(
      1,
      EElasticIndex.message,
      'message-1'
    );
    expect(elasticDatabaseService.getById).toHaveBeenNthCalledWith(
      2,
      EElasticIndex.message,
      'legacy-physical-id'
    );
  });

  it('confirms a newly saved webhook message through realtime GET without search', async () => {
    const eventId = '01900000-0000-7000-8000-000000000010';
    const message = {
      message_id: 'message-webhook-1',
      chat_id: 'chat-1',
      account,
      worker,
      type_user: 'user',
      phone: '556195999040',
      date: '2026-07-10T12:00:00.000Z',
      content: { text: 'Webhook-safe message' },
      summary: {},
    } as unknown as IChatMessage;
    const prepared = {
      eventId,
      envelope: {
        id: eventId,
        type: 'message.sent',
        api_version: '1',
        occurred_at: '2026-07-10T12:00:00.000Z',
        account_id: account.id,
        aggregate: { type: 'message', id: message.message_id },
        data: {},
      },
      created: true,
      state: 'preparing',
    };
    const outboundWebhookEventService = {
      prepareBestEffort: jest.fn(async () => prepared),
      completeBestEffort: jest.fn(async () => true),
      cancel: jest.fn(async () => undefined),
    };
    const { service, elasticDatabaseService } = makeService(
      { hits: { hits: [] } },
      null,
      outboundWebhookEventService
    );
    elasticDatabaseService.getById.mockResolvedValueOnce({
      ...message,
      outbound_webhook_event_ids: [eventId],
    });

    await expect(
      service.saveMessageChat(message, {
        eventTypes: ['message.sent'],
        idempotencyKey: 'message-sent:message-webhook-1',
        source: 'manager_api',
        actor: { type: 'user', id: 'user-1' },
      })
    ).resolves.toBe(true);

    expect(elasticDatabaseService.getById).toHaveBeenCalledWith(
      EElasticIndex.message,
      message.message_id
    );
    expect(elasticDatabaseService.select).not.toHaveBeenCalled();
    expect(elasticDatabaseService.updateWithOCC).not.toHaveBeenCalled();
    expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalledWith(
      EElasticIndex.message,
      message.message_id,
      expect.objectContaining({
        source: expect.stringContaining(
          'ctx._source.outbound_webhook_event_ids'
        ),
        params: expect.objectContaining({ event_ids: [eventId] }),
        upsert: expect.objectContaining({
          outbound_webhook_event_ids: [eventId],
        }),
        scriptedUpsert: true,
      }),
      { upsert: true, maxRetries: 5 }
    );
    expect(outboundWebhookEventService.completeBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId,
        accountId: account.id,
      })
    );
  });

  it('keeps a saved message successful when webhook confirmation GET fails', async () => {
    const eventId = '01900000-0000-7000-8000-000000000011';
    const message = {
      message_id: 'message-webhook-2',
      chat_id: 'chat-1',
      account,
      worker,
      type_user: 'user',
      phone: '556195999040',
      date: '2026-07-10T12:00:00.000Z',
      content: { text: 'Already persisted' },
      summary: {},
    } as unknown as IChatMessage;
    const outboundWebhookEventService = {
      prepareBestEffort: jest.fn(async () => ({
        eventId,
        envelope: {
          id: eventId,
          type: 'message.sent',
          api_version: '1',
          occurred_at: '2026-07-10T12:00:00.000Z',
          account_id: account.id,
          aggregate: { type: 'message', id: message.message_id },
          data: {},
        },
        created: true,
        state: 'preparing',
      })),
      completeBestEffort: jest.fn(async () => true),
      cancel: jest.fn(async () => undefined),
    };
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const { service, elasticDatabaseService } = makeService(
      { hits: { hits: [] } },
      null,
      outboundWebhookEventService
    );
    elasticDatabaseService.updateWithOCC = jest.fn(async () => 'updated');
    elasticDatabaseService.getById.mockRejectedValueOnce(
      new Error('temporary GET failure')
    );

    try {
      await expect(
        service.saveMessageChat(message, {
          eventTypes: ['message.sent'],
          idempotencyKey: 'message-sent:message-webhook-2',
          source: 'manager_api',
        })
      ).resolves.toBe(true);
      expect(
        outboundWebhookEventService.completeBestEffort
      ).not.toHaveBeenCalled();
      expect(outboundWebhookEventService.cancel).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        '[OutboundWebhook] Message confirmation read failed',
        expect.objectContaining({ message_id: message.message_id })
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('uses the delivery payload contract for statuses known at message creation', async () => {
    const eventId = '01900000-0000-7000-8000-000000000023';
    const message = {
      message_id: 'message-delivery-initial',
      chat_id: 'chat-1',
      account,
      worker,
      type_user: 'user',
      phone: '556195999040',
      date: '2026-07-10T12:00:00.000Z',
      content: { text: 'Already sent' },
      summary: { is_sent: true },
    } as unknown as IChatMessage;
    const outboundWebhookEventService = makeOutboundWebhookEventService(
      eventId,
      'message.delivery.sent',
      message.message_id
    );
    const { service, elasticDatabaseService } = makeService(
      { hits: { hits: [] } },
      null,
      outboundWebhookEventService
    );
    elasticDatabaseService.getById.mockResolvedValueOnce({
      ...message,
      outbound_webhook_event_ids: [eventId],
    });

    await expect(
      service.saveMessageChat(message, {
        eventTypes: ['message.delivery.sent'],
        idempotencyKey: 'message-created:message-delivery-initial',
        source: 'message_upsert',
        changes: { direction: 'outbound' },
      })
    ).resolves.toBe(true);

    expect(outboundWebhookEventService.prepareBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'message.delivery.sent',
        data: {
          message: expect.objectContaining({
            message_id: message.message_id,
          }),
          delivery_status: 'sent',
        },
        previous: null,
      })
    );
    expect(outboundWebhookEventService.completeBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          data: expect.objectContaining({ delivery_status: 'sent' }),
        }),
      })
    );
  });

  it('preserves concurrent webhook markers even when this message update has no subscribed event', async () => {
    const message = {
      message_id: 'message-with-concurrent-marker',
      chat_id: 'chat-1',
      account,
      worker,
      type_user: 'user',
      phone: '556195999040',
      date: '2026-07-10T12:00:00.000Z',
      content: { text: 'Edited without a subscribed event' },
      summary: {},
      outbound_webhook_event_ids: [],
    } as unknown as IChatMessage;
    const { service, elasticDatabaseService } = makeService({
      hits: { hits: [] },
    });

    await expect(service.updateMessageChat(message)).resolves.toBe(true);

    expect(elasticDatabaseService.updateWithOCC).not.toHaveBeenCalled();
    expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalledWith(
      EElasticIndex.message,
      message.message_id,
      expect.objectContaining({
        source: expect.stringContaining(
          'ctx._source.outbound_webhook_event_ids'
        ),
        params: expect.objectContaining({ event_ids: [] }),
      }),
      { upsert: false, maxRetries: 5 }
    );
  });

  it('atomically reports a repeated inbound mutation without applying it again', async () => {
    const message = {
      message_id: 'message-inbound-mutation',
      chat_id: 'chat-1',
      account,
      worker,
      type_user: 'user',
      phone: '556195999040',
      date: '2026-07-10T12:00:00.000Z',
      content: { type: 'text', message: 'Edited' },
      summary: {},
    } as unknown as IChatMessage;
    const { service, elasticDatabaseService } = makeService({
      hits: { hits: [] },
    });
    elasticDatabaseService.updateWithScriptOCC.mockResolvedValueOnce('noop');

    await expect(
      service.updateMessageChatIdempotent(message, {
        eventTypes: [],
        idempotencyKey: 'message-edit:event-1',
        source: 'message_upsert',
        inboundEventId: 'waevt_v1_event-1',
      })
    ).resolves.toEqual({ persisted: true, applied: false });

    expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalledWith(
      EElasticIndex.message,
      message.message_id,
      expect.objectContaining({
        source: expect.stringContaining(
          'inboundEventIds.contains(params.inbound_event_id)'
        ),
        params: expect.objectContaining({
          inbound_event_id: 'waevt_v1_event-1',
          inbound_event_ids: ['waevt_v1_event-1'],
        }),
      }),
      { upsert: false, maxRetries: 5 }
    );
  });

  it('never forgets an inbound mutation identity after more than 256 later mutations', async () => {
    const firstEventId = 'waevt_v1_event-000';
    const retainedEventIds = Array.from(
      { length: 257 },
      (_, index) => `waevt_v1_event-${String(index).padStart(3, '0')}`
    );
    const latestEventId = 'waevt_v1_event-257';
    const message = {
      message_id: 'message-with-many-inbound-mutations',
      chat_id: 'chat-1',
      account,
      worker,
      type_user: 'user',
      phone: '556195999040',
      date: '2026-07-10T12:00:00.000Z',
      content: { type: 'text', message: 'Edited many times' },
      summary: {},
      inbound_event_ids: retainedEventIds,
    } as unknown as IChatMessage;
    const { service, elasticDatabaseService } = makeService({
      hits: { hits: [] },
    });

    await expect(
      service.updateMessageChatIdempotent(message, {
        eventTypes: [],
        idempotencyKey: `message-edit:${latestEventId}`,
        source: 'message_upsert',
        inboundEventId: latestEventId,
      })
    ).resolves.toEqual({ persisted: true, applied: true });

    const scriptCall = elasticDatabaseService.updateWithScriptOCC.mock
      .calls[0]?.[2] as {
      source: string;
      params: { inbound_event_ids: string[] };
    };
    expect(scriptCall.params.inbound_event_ids).toHaveLength(258);
    expect(scriptCall.params.inbound_event_ids).toContain(firstEventId);
    expect(scriptCall.source).not.toContain(
      'while (inboundEventIds.size() > 256)'
    );
  });

  it('journals provider message-key hydration only when the compare-and-set wins', async () => {
    const eventId = '01900000-0000-7000-8000-000000000024';
    const previousMessage = {
      message_id: 'message-key-hydration',
      chat_id: 'chat-1',
      account,
      worker,
      type_user: 'user',
      phone: '556195999040',
      date: '2026-07-10T12:00:00.000Z',
      content: { text: 'Sent' },
      summary: {},
      message_key: { id: null, remote_jid: null },
    } as unknown as IChatMessage;
    const intendedMessage = {
      ...previousMessage,
      message_key: {
        ...previousMessage.message_key,
        id: 'PROVIDER-ID',
        remote_jid: '556195999040@s.whatsapp.net',
      },
    } as IChatMessage;
    const outboundWebhookEventService = makeOutboundWebhookEventService(
      eventId,
      'message.updated',
      intendedMessage.message_id
    );
    const { service, elasticDatabaseService } = makeService(
      { hits: { hits: [] } },
      null,
      outboundWebhookEventService
    );
    elasticDatabaseService.getById
      .mockResolvedValueOnce(previousMessage)
      .mockResolvedValueOnce({
        ...intendedMessage,
        outbound_webhook_event_ids: [eventId],
      });
    elasticDatabaseService.updateWithScriptOCC.mockResolvedValueOnce('updated');

    await expect(
      service.patchExistingMessageMissingFields(
        intendedMessage.message_id,
        intendedMessage,
        {
          eventTypes: ['message.updated'],
          idempotencyKey: 'message-key-hydrated:message-key-hydration',
          source: 'message_update',
          previousMessage,
          actor: { type: 'system' },
          changes: { message_key_hydrated: true },
        }
      )
    ).resolves.toBe(true);

    expect(outboundWebhookEventService.prepareBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'message.updated',
        idempotencyKey: expect.stringMatching(
          /^message-key-hydrated:message-key-hydration:/
        ),
      })
    );
    expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalledWith(
      EElasticIndex.message,
      intendedMessage.message_id,
      expect.objectContaining({
        source: expect.stringContaining('outbound_webhook_event_ids'),
        params: expect.objectContaining({
          outbound_webhook_event_ids: [eventId],
        }),
      }),
      { maxRetries: 5 }
    );
    expect(
      outboundWebhookEventService.completeBestEffort
    ).toHaveBeenCalledTimes(1);
  });

  it('does not journal message-key hydration when every field is already canonical', async () => {
    const currentMessage = {
      message_id: 'message-key-canonical',
      chat_id: 'chat-1',
      account,
      worker,
      type_user: 'user',
      phone: '556195999040',
      date: '2026-07-10T12:00:00.000Z',
      content: { text: 'Sent' },
      summary: {},
      message_key: {
        id: 'PROVIDER-ID',
        remote_jid: '556195999040@s.whatsapp.net',
      },
    } as unknown as IChatMessage;
    const outboundWebhookEventService = makeOutboundWebhookEventService(
      '01900000-0000-7000-8000-000000000025',
      'message.updated',
      currentMessage.message_id
    );
    const { service, elasticDatabaseService } = makeService(
      { hits: { hits: [] } },
      null,
      outboundWebhookEventService
    );
    elasticDatabaseService.getById.mockResolvedValueOnce(currentMessage);

    await expect(
      service.patchExistingMessageMissingFields(
        currentMessage.message_id,
        currentMessage,
        {
          eventTypes: ['message.updated'],
          idempotencyKey: 'message-key-hydrated:already-canonical',
          source: 'message_update',
        }
      )
    ).resolves.toBe(true);

    expect(
      outboundWebhookEventService.prepareBestEffort
    ).not.toHaveBeenCalled();
    expect(elasticDatabaseService.updateWithScriptOCC).not.toHaveBeenCalled();
  });

  it('does not mutate message-key fields when the assignment is revoked during webhook preparation', async () => {
    let active = true;
    const previousMessage = {
      message_id: 'message-key-revoked',
      chat_id: 'chat-1',
      account,
      worker,
      type_user: 'user',
      phone: '556195999040',
      date: '2026-07-10T12:00:00.000Z',
      content: { text: 'Sent' },
      summary: {},
      message_key: { id: null, remote_jid: null },
    } as unknown as IChatMessage;
    const intendedMessage = {
      ...previousMessage,
      message_key: {
        ...previousMessage.message_key,
        id: 'PROVIDER-ID',
        remote_jid: '556195999040@s.whatsapp.net',
      },
    } as IChatMessage;
    const outboundWebhookEventService = makeOutboundWebhookEventService(
      '01900000-0000-7000-8000-000000000026',
      'message.updated',
      intendedMessage.message_id
    );
    outboundWebhookEventService.prepareBestEffort.mockImplementationOnce(
      async () => {
        active = false;
        return {
          eventId: '01900000-0000-7000-8000-000000000026',
          envelope: {
            id: '01900000-0000-7000-8000-000000000026',
            type: 'message.updated',
            api_version: '1',
            occurred_at: '2026-07-10T12:00:00.000Z',
            account_id: account.id,
            aggregate: {
              type: 'message',
              id: intendedMessage.message_id,
            },
            data: {},
          },
          created: true,
          state: 'preparing',
        };
      }
    );
    const { service, elasticDatabaseService } = makeService(
      { hits: { hits: [] } },
      null,
      outboundWebhookEventService
    );
    elasticDatabaseService.getById.mockResolvedValueOnce(previousMessage);
    const assertActive = jest.fn(() => {
      if (!active) {
        throw new KafkaConsumerDispatchRevokedError();
      }
    });

    await expect(
      service.patchExistingMessageMissingFields(
        intendedMessage.message_id,
        intendedMessage,
        {
          eventTypes: ['message.updated'],
          idempotencyKey: 'message-key-hydrated:revoked',
          source: 'message_update',
          previousMessage,
          assertActive,
        }
      )
    ).rejects.toBeInstanceOf(KafkaConsumerDispatchRevokedError);

    expect(elasticDatabaseService.updateWithScriptOCC).not.toHaveBeenCalled();
    expect(
      outboundWebhookEventService.completeBestEffort
    ).not.toHaveBeenCalled();
  });

  it('leaves a shared prepared intent for recovery when message persistence fails', async () => {
    const eventId = '01900000-0000-7000-8000-000000000013';
    const message = {
      message_id: 'message-webhook-shared',
      chat_id: 'chat-1',
      account,
      worker,
      type_user: 'user',
      phone: '556195999040',
      date: '2026-07-10T12:00:00.000Z',
      content: { text: 'Concurrent idempotent attempt' },
      summary: {},
    } as unknown as IChatMessage;
    const outboundWebhookEventService = {
      prepareBestEffort: jest.fn(async () => ({
        eventId,
        envelope: {
          id: eventId,
          type: 'message.sent',
          api_version: '1',
          occurred_at: '2026-07-10T12:00:00.000Z',
          account_id: account.id,
          aggregate: { type: 'message', id: message.message_id },
          data: {},
        },
        created: false,
        state: 'preparing',
      })),
      completeBestEffort: jest.fn(async () => true),
      cancel: jest.fn(async () => undefined),
    };
    const { service, elasticDatabaseService } = makeService(
      { hits: { hits: [] } },
      null,
      outboundWebhookEventService
    );
    elasticDatabaseService.updateWithScriptOCC.mockRejectedValueOnce(
      new Error('primary persistence failed')
    );

    await expect(
      service.saveMessageChat(message, {
        eventTypes: ['message.sent'],
        idempotencyKey: 'message-sent:message-webhook-shared',
        source: 'manager_api',
      })
    ).rejects.toThrow('primary persistence failed');

    expect(
      outboundWebhookEventService.completeBestEffort
    ).not.toHaveBeenCalled();
    expect(outboundWebhookEventService.cancel).not.toHaveBeenCalled();
  });

  it('returns the intended participant state when post-write chat GET fails', async () => {
    const eventId = '01900000-0000-7000-8000-000000000012';
    const chat = makeChat({ status: EChatStatus.in_chat });
    const joinedUser = { id: 'user-2', name: 'Secondary', photo: null };
    const outboundWebhookEventService = {
      prepareBestEffort: jest.fn(async () => ({
        eventId,
        envelope: {
          id: eventId,
          type: 'chat.joined',
          api_version: '1',
          occurred_at: '2026-07-10T12:00:00.000Z',
          account_id: account.id,
          aggregate: { type: 'chat', id: chat.chat_id },
          data: {},
        },
        created: true,
        state: 'preparing',
      })),
      completeBestEffort: jest.fn(async () => true),
      cancel: jest.fn(async () => undefined),
    };
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const { service, elasticDatabaseService } = makeService(
      { hits: { hits: [] } },
      null,
      outboundWebhookEventService
    );
    elasticDatabaseService.updateWithScriptOCC.mockResolvedValueOnce('updated');
    elasticDatabaseService.getById.mockRejectedValueOnce(
      new Error('temporary GET failure')
    );

    try {
      const result = await service.mutateSecondaryUserAtomically({
        accountId: account.id,
        chat,
        user: joinedUser,
        operation: 'join',
        outboundWebhook: {
          eventTypes: ['chat.joined'],
          idempotencyKey: 'chat-joined:chat-1:user-2',
          source: 'manager_api',
          previousChat: chat,
        },
      });

      expect(result?.secondary_users).toContainEqual(joinedUser);
      expect(result?.meta?.assignment_event_id).toEqual(expect.any(String));
      expect(result?.meta?.assignment_epoch).toEqual(expect.any(Number));
      expect(result?.meta?.outbound_webhook_event_ids).toContain(eventId);
      expect(
        outboundWebhookEventService.completeBestEffort
      ).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        '[OutboundWebhook] Chat confirmation read failed',
        expect.objectContaining({ chat_id: chat.chat_id })
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('does not report a guarded webhook patch as applied when Elasticsearch returns an ambiguous noop and confirmation fails', async () => {
    const eventId = '01900000-0000-7000-8000-000000000014';
    const chat = makeChat({ status: EChatStatus.in_chat });
    const outboundWebhookEventService = makeOutboundWebhookEventService(
      eventId,
      'chat.closed',
      chat.chat_id
    );
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const { service, elasticDatabaseService } = makeService(
      { hits: { hits: [] } },
      null,
      outboundWebhookEventService
    );
    elasticDatabaseService.updateWithScriptOCC.mockResolvedValueOnce('noop');
    elasticDatabaseService.getById.mockRejectedValueOnce(
      new Error('temporary GET failure')
    );

    try {
      await expect(
        service.applyChatPatch(
          chat.chat_id,
          { status: EChatStatus.closed },
          {
            allowCreate: false,
            expectedCurrentStatuses: [EChatStatus.in_chat],
            outboundWebhook: {
              eventTypes: ['chat.closed'],
              idempotencyKey: 'chat-close-guarded',
              source: 'manager_api',
              previousChat: chat,
            },
          }
        )
      ).resolves.toBe(false);
      expect(
        outboundWebhookEventService.completeBestEffort
      ).not.toHaveBeenCalled();
      expect(outboundWebhookEventService.cancel).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        '[OutboundWebhook] Chat confirmation read failed',
        expect.objectContaining({ chat_id: chat.chat_id })
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('does not report a guarded full chat save after noop when confirmation fails', async () => {
    const eventId = '01900000-0000-7000-8000-000000000018';
    const chat = makeChat({ status: EChatStatus.in_chat });
    const outboundWebhookEventService = makeOutboundWebhookEventService(
      eventId,
      'chat.status.changed',
      chat.chat_id
    );
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const { service, elasticDatabaseService } = makeService(
      { hits: { hits: [] } },
      null,
      outboundWebhookEventService
    );
    elasticDatabaseService.getById
      .mockResolvedValueOnce(chat)
      .mockRejectedValueOnce(new Error('temporary GET failure'));
    elasticDatabaseService.updateWithScriptOCC.mockResolvedValueOnce('noop');

    try {
      await expect(
        service.saveChat(chat, {
          outboundWebhook: {
            eventTypes: ['chat.status.changed'],
            idempotencyKey: 'chat-save-noop',
            source: 'manager_api',
            previousChat: chat,
          },
        })
      ).resolves.toBe(false);
      expect(
        outboundWebhookEventService.completeBestEffort
      ).not.toHaveBeenCalled();
      expect(outboundWebhookEventService.cancel).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('returns the canonical protocol when another concurrent caller wins the compare-and-set', async () => {
    const eventId = '01900000-0000-7000-8000-000000000022';
    const chat = makeChat({ status: EChatStatus.in_chat, protocol_start: [] });
    const winner = makeChat({
      status: EChatStatus.in_chat,
      protocol_start: ['WINNER-123'],
    });
    const outboundWebhookEventService = makeOutboundWebhookEventService(
      eventId,
      'chat.protocol.updated',
      chat.chat_id
    );
    const { service, elasticDatabaseService } = makeService(
      { hits: { hits: [] } },
      null,
      outboundWebhookEventService
    );
    elasticDatabaseService.getById
      .mockResolvedValueOnce(chat)
      .mockResolvedValueOnce(winner);
    elasticDatabaseService.updateWithScriptOCC.mockResolvedValueOnce('noop');

    await expect(
      service.getOrCreateChatProtocol(
        account.id,
        chat.chat_id,
        'protocol_start'
      )
    ).resolves.toBe('WINNER-123');

    expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalledWith(
      EElasticIndex.chat,
      chat.chat_id,
      expect.objectContaining({
        source: expect.stringContaining('ctx._source[params.protocol_type]'),
        params: expect.objectContaining({
          protocol_type: 'protocol_start',
          outbound_webhook_event_ids: [eventId],
        }),
      }),
      { upsert: false, maxRetries: 5, refresh: true }
    );
    expect(outboundWebhookEventService.cancel).toHaveBeenCalledWith(eventId);
    expect(
      outboundWebhookEventService.completeBestEffort
    ).not.toHaveBeenCalled();
  });

  it('does not report a status mutation after noop when confirmation fails', async () => {
    const eventId = '01900000-0000-7000-8000-000000000019';
    const chat = makeChat({ status: EChatStatus.in_chat });
    const outboundWebhookEventService = makeOutboundWebhookEventService(
      eventId,
      'chat.closed',
      chat.chat_id
    );
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const { service, elasticDatabaseService } = makeService(
      { hits: { hits: [] } },
      null,
      outboundWebhookEventService
    );
    elasticDatabaseService.updateWithScriptOCC.mockResolvedValueOnce('noop');
    elasticDatabaseService.getById.mockRejectedValueOnce(
      new Error('temporary GET failure')
    );

    try {
      await expect(
        service.updateChatStatus(
          chat.chat_id,
          EChatStatus.closed,
          undefined,
          undefined,
          '2026-07-10T12:00:00.000Z',
          100,
          'status-event-1',
          {
            eventTypes: ['chat.closed'],
            idempotencyKey: 'chat-status-noop',
            source: 'manager_api',
            previousChat: chat,
          }
        )
      ).resolves.toBe(false);
      expect(
        outboundWebhookEventService.completeBestEffort
      ).not.toHaveBeenCalled();
      expect(outboundWebhookEventService.cancel).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('does not report an assignment mutation after noop when confirmation fails', async () => {
    const eventId = '01900000-0000-7000-8000-000000000020';
    const chat = makeChat({ status: EChatStatus.in_chat });
    const targetUser = { id: 'user-2', name: 'Target', photo: null };
    const outboundWebhookEventService = makeOutboundWebhookEventService(
      eventId,
      'chat.assignment.changed',
      chat.chat_id
    );
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const { service, elasticDatabaseService } = makeService(
      { hits: { hits: [] } },
      null,
      outboundWebhookEventService
    );
    elasticDatabaseService.updateWithScriptOCC.mockResolvedValueOnce('noop');
    elasticDatabaseService.getById.mockRejectedValueOnce(
      new Error('temporary GET failure')
    );

    try {
      await expect(
        service.updateChatUserAndSector(
          chat.chat_id,
          targetUser,
          undefined,
          100,
          'assignment-event-1',
          {
            eventTypes: ['chat.assignment.changed'],
            idempotencyKey: 'chat-assignment-noop',
            source: 'manager_api',
            previousChat: chat,
          }
        )
      ).resolves.toBe(false);
      expect(
        outboundWebhookEventService.completeBestEffort
      ).not.toHaveBeenCalled();
      expect(outboundWebhookEventService.cancel).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('does not synthesize a participant success from noop when the confirmation read fails', async () => {
    const eventId = '01900000-0000-7000-8000-000000000015';
    const chat = makeChat({ status: EChatStatus.in_chat });
    const joinedUser = { id: 'user-2', name: 'Secondary', photo: null };
    const outboundWebhookEventService = makeOutboundWebhookEventService(
      eventId,
      'chat.joined',
      chat.chat_id
    );
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const { service, elasticDatabaseService } = makeService(
      { hits: { hits: [] } },
      null,
      outboundWebhookEventService
    );
    elasticDatabaseService.updateWithScriptOCC.mockResolvedValueOnce('noop');
    elasticDatabaseService.getById.mockRejectedValueOnce(
      new Error('temporary GET failure')
    );

    try {
      await expect(
        service.mutateSecondaryUserAtomically({
          accountId: account.id,
          chat,
          user: joinedUser,
          operation: 'join',
          outboundWebhook: {
            eventTypes: ['chat.joined'],
            idempotencyKey: 'chat-joined-noop',
            source: 'manager_api',
            previousChat: chat,
          },
        })
      ).resolves.toBeNull();
      expect(
        outboundWebhookEventService.completeBestEffort
      ).not.toHaveBeenCalled();
      expect(outboundWebhookEventService.cancel).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('does not confirm a generated protocol after noop when the canonical read is unavailable', async () => {
    const eventId = '01900000-0000-7000-8000-000000000016';
    const chat = makeChat({ status: EChatStatus.in_chat, protocol_start: [] });
    const outboundWebhookEventService = makeOutboundWebhookEventService(
      eventId,
      'chat.protocol.updated',
      chat.chat_id
    );
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const { service, elasticDatabaseService } = makeService(
      { hits: { hits: [] } },
      null,
      outboundWebhookEventService
    );
    elasticDatabaseService.getById
      .mockResolvedValueOnce(chat)
      .mockRejectedValueOnce(new Error('temporary GET failure'));
    elasticDatabaseService.updateWithScriptOCC.mockResolvedValueOnce('noop');

    try {
      await expect(
        service.getOrCreateChatProtocol(
          account.id,
          chat.chat_id,
          'protocol_start'
        )
      ).resolves.toBeNull();
      expect(
        outboundWebhookEventService.completeBestEffort
      ).not.toHaveBeenCalled();
      expect(outboundWebhookEventService.cancel).toHaveBeenCalledWith(eventId);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('does not report a satisfaction update after noop when the canonical read is unavailable', async () => {
    const eventId = '01900000-0000-7000-8000-000000000017';
    const chat = makeChat({ status: EChatStatus.in_chat });
    const outboundWebhookEventService = makeOutboundWebhookEventService(
      eventId,
      'chat.satisfaction.updated',
      chat.chat_id
    );
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const { service, elasticDatabaseService } = makeService(
      { hits: { hits: [] } },
      null,
      outboundWebhookEventService
    );
    elasticDatabaseService.updateWithScriptOCC.mockResolvedValueOnce('noop');
    elasticDatabaseService.getById.mockRejectedValueOnce(
      new Error('temporary GET failure')
    );

    try {
      await expect(
        service.updateChatSatisfactionResponse(
          chat.chat_id,
          {
            question: 'Como foi o atendimento?',
            options: [{ id: 'good', text: 'Bom' }],
            response: { id: 'good', text: 'Bom' },
          },
          {
            eventTypes: ['chat.satisfaction.updated'],
            idempotencyKey: 'chat-satisfaction-noop',
            source: 'chatbot_flow',
            previousChat: chat,
          }
        )
      ).resolves.toBe(false);
      expect(
        outboundWebhookEventService.completeBestEffort
      ).not.toHaveBeenCalled();
      expect(outboundWebhookEventService.cancel).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('passes human-to-automation guard params to chat patch updates', async () => {
    const staleAutomationChat = makeChat({
      status: EChatStatus.ura,
      user: null,
    });
    const { service, elasticDatabaseService } = makeService({
      hits: { hits: [] },
    });
    elasticDatabaseService.getById.mockResolvedValue(staleAutomationChat);

    await expect(service.saveChat(staleAutomationChat)).resolves.toBe(true);

    expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalledWith(
      EElasticIndex.chat,
      staleAutomationChat.chat_id,
      expect.objectContaining({
        source: expect.stringContaining(
          'humanAttendanceStatuses.contains(currentStatus)'
        ),
        params: expect.objectContaining({
          allow_human_to_automation: false,
          enforce_expected_status_revision: true,
          chatbot_statuses: expect.arrayContaining([EChatStatus.ura]),
          human_attendance_statuses: expect.arrayContaining([
            EChatStatus.queue,
            EChatStatus.in_chat,
          ]),
        }),
      }),
      expect.objectContaining({
        refresh: undefined,
      })
    );
  });

  it('does not let a stale full save reopen a newer closed revision', async () => {
    const staleChat = makeChat({
      status: EChatStatus.in_chat,
      meta: {
        status_epoch: 1,
        status_event_id: 'session-old',
        status_source: 'chat_service',
      },
    });
    const closedChat = makeChat({
      status: EChatStatus.closed,
      meta: {
        status_epoch: 2,
        status_event_id: 'close-new',
        status_source: 'chatbot',
      },
    });
    const { service, elasticDatabaseService } = makeService({
      hits: { hits: [] },
    });
    elasticDatabaseService.getById.mockResolvedValue(closedChat);

    await expect(service.saveChat(staleChat)).resolves.toBe(false);

    expect(staleChat.status).toBe(EChatStatus.closed);
    expect(staleChat.meta?.status_event_id).toBe('close-new');
    expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalledWith(
      EElasticIndex.chat,
      staleChat.chat_id,
      expect.objectContaining({
        params: expect.objectContaining({
          enforce_expected_status_revision: true,
          expected_status_event_id: 'session-old',
          expected_status_epoch: 1,
        }),
      }),
      expect.any(Object)
    );
  });

  it('atomically transfers automation chats to queue and clears chatbot markers', async () => {
    const targetUser = {
      id: 'user-2',
      name: 'Gisele',
      photo: null,
    };
    const automationChat = makeChat({
      status: EChatStatus.ura,
      user: null,
      sector: null,
      chatbot_transfer_id: 'chatbot-1',
      chatbot_schedule_id: 'schedule-1',
      chatbot_webhook_id: 'webhook-1',
      forward_to_output_chatbot: false,
    });
    const queuedChat = makeChat({
      ...automationChat,
      status: EChatStatus.queue,
      user: targetUser,
      sector: null,
      chatbot_transfer_id: null,
      chatbot_schedule_id: null,
      chatbot_webhook_id: null,
      forward_to_output_chatbot: true,
    });
    const { service, elasticDatabaseService } = makeService({
      hits: { hits: [] },
    });
    elasticDatabaseService.getById
      .mockResolvedValueOnce(automationChat)
      .mockResolvedValueOnce(queuedChat);
    elasticDatabaseService.updateWithScriptOCC.mockImplementationOnce(
      async (
        _index: string,
        _chatId: string,
        input: { params: Record<string, unknown> }
      ) => {
        queuedChat.meta = {
          status_epoch: input.params.event_epoch_millis as number,
          status_event_id: input.params.event_id as string,
          status_source: input.params.status_source as string,
        };
        return 'updated';
      }
    );

    await expect(
      service.transferAutomationChatToQueue({
        accountId: 'account-1',
        chat: automationChat,
        user: targetUser,
        sector: null,
        eventEpochMillis: 1778190016000,
        eventId: 'waevt-v1-transfer-event',
      })
    ).resolves.toEqual({
      chat: queuedChat,
      previousChat: automationChat,
      applied: true,
      alreadyHuman: true,
    });

    expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalledWith(
      EElasticIndex.chat,
      automationChat.chat_id,
      expect.objectContaining({
        params: expect.objectContaining({
          expected_current_statuses: expect.arrayContaining([
            EChatStatus.ura,
            EChatStatus.ura_output,
            EChatStatus.ura_schedule,
            EChatStatus.ura_webhook,
          ]),
          enforce_expected_status_revision: true,
          enforce_assignment_revision: true,
          enforce_expected_started_at: true,
          enforce_expected_last_message_id: true,
          expected_status_event_id: null,
          expected_status_epoch: null,
          expected_started_at: null,
          expected_last_message_id: null,
          event_epoch_millis: 1778190016000,
          event_id: 'waevt-v1-transfer-event',
          patch: expect.objectContaining({
            status: EChatStatus.queue,
            user: targetUser,
            sector: null,
            secondary_users: [],
            forward_to_output_chatbot: true,
            chatbot_transfer_id: null,
            chatbot_schedule_id: null,
            chatbot_webhook_id: null,
          }),
        }),
      }),
      expect.objectContaining({
        upsert: false,
        refresh: true,
      })
    );
  });

  it('atomically rejects a chatbot handoff when a newer assignment wins after the precheck', async () => {
    const targetUser = {
      id: 'user-target',
      name: 'Target User',
      photo: null,
    };
    const automationChat = makeChat({
      status: EChatStatus.ura,
      user: null,
      sector: null,
      meta: {
        status_epoch: 100,
        status_event_id: 'status-100',
        status_source: 'chatbot',
        assignment_epoch: 100,
        assignment_event_id: 'assignment-100',
      },
    });
    const concurrentAssignmentChat = makeChat({
      ...automationChat,
      user: { id: 'user-newer', name: 'Newer User', photo: null },
      sector: { id: 'sector-newer', name: 'Newer Sector', color: '#000' },
      meta: {
        ...automationChat.meta,
        assignment_epoch: 200,
        assignment_event_id: 'assignment-200',
      },
    });
    const { service, elasticDatabaseService } = makeService({
      hits: { hits: [] },
    });
    elasticDatabaseService.getById
      .mockResolvedValueOnce(automationChat)
      .mockResolvedValueOnce(concurrentAssignmentChat);
    elasticDatabaseService.updateWithScriptOCC.mockResolvedValueOnce('noop');

    await expect(
      service.transferAutomationChatToQueue({
        accountId: account.id,
        chat: automationChat,
        user: targetUser,
        sector: null,
        eventEpochMillis: 150,
        eventId: 'transfer-150',
      })
    ).resolves.toEqual({
      chat: concurrentAssignmentChat,
      previousChat: automationChat,
      applied: false,
      alreadyHuman: false,
    });

    expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalledWith(
      EElasticIndex.chat,
      automationChat.chat_id,
      expect.objectContaining({
        source: expect.stringContaining(
          'params.enforce_assignment_revision == true'
        ),
        params: expect.objectContaining({
          enforce_assignment_revision: true,
          event_epoch_millis: 150,
          event_id: 'transfer-150',
        }),
      }),
      expect.objectContaining({ upsert: false, refresh: true })
    );
  });

  it('keeps an applied automation handoff successful when the confirmation read fails', async () => {
    const eventId = '01900000-0000-7000-8000-000000000020';
    const automationChat = makeChat({
      status: EChatStatus.ura,
      user: null,
      sector: null,
      meta: {
        status_epoch: 100,
        status_event_id: 'automation-100',
        status_source: 'chatbot',
      },
    });
    const outboundWebhookEventService = makeOutboundWebhookEventService(
      eventId,
      'chat.transferred',
      automationChat.chat_id
    );
    const { service, elasticDatabaseService } = makeService(
      { hits: { hits: [] } },
      null,
      outboundWebhookEventService
    );
    elasticDatabaseService.getById
      .mockResolvedValueOnce(automationChat)
      .mockRejectedValueOnce(new Error('transient confirmation failure'));
    elasticDatabaseService.updateWithScriptOCC.mockResolvedValueOnce('updated');
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

    try {
      const result = await service.transferAutomationChatToQueue({
        accountId: account.id,
        chat: automationChat,
        user: null,
        sector: null,
        outboundWebhook: {
          eventTypes: ['chat.transferred'],
          idempotencyKey: 'handoff:chat-1:100',
          source: 'manager_api',
          previousChat: automationChat,
          actor: { type: 'user', id: 'user-1' },
        },
      });

      expect(result).toEqual({
        chat: expect.objectContaining({
          chat_id: automationChat.chat_id,
          status: EChatStatus.queue,
          meta: expect.objectContaining({
            status_epoch: expect.any(Number),
            status_event_id: expect.any(String),
            status_source: 'chat_service',
            outbound_webhook_event_ids: [eventId],
          }),
        }),
        previousChat: automationChat,
        applied: true,
        alreadyHuman: true,
      });
      expect(
        outboundWebhookEventService.completeBestEffort
      ).toHaveBeenCalledWith(
        expect.objectContaining({ eventId, accountId: account.id })
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('keeps an applied missing-name update successful when confirmation fails', async () => {
    const eventId = '01900000-0000-7000-8000-000000000021';
    const unnamedChat = makeChat({ name: null });
    const outboundWebhookEventService = makeOutboundWebhookEventService(
      eventId,
      'chat.updated',
      unnamedChat.chat_id
    );
    const { service, elasticDatabaseService } = makeService(
      { hits: { hits: [] } },
      null,
      outboundWebhookEventService
    );
    elasticDatabaseService.updateWithScriptOCC.mockResolvedValueOnce('updated');
    elasticDatabaseService.getById.mockRejectedValueOnce(
      new Error('transient confirmation failure')
    );
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

    try {
      await expect(
        service.updateChatNameIfMissing(unnamedChat, 'Maria', {
          eventTypes: ['chat.updated'],
          idempotencyKey: 'chat-name:chat-1:Maria',
          source: 'message_upsert',
          previousChat: unnamedChat,
          actor: { type: 'customer' },
        })
      ).resolves.toEqual(
        expect.objectContaining({
          chat_id: unnamedChat.chat_id,
          name: 'Maria',
          meta: expect.objectContaining({
            outbound_webhook_event_ids: [eventId],
          }),
        })
      );
      expect(
        outboundWebhookEventService.completeBestEffort
      ).toHaveBeenCalledWith(
        expect.objectContaining({ eventId, accountId: account.id })
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('does not claim an automation handoff applied when another status event won the race', async () => {
    const automationChat = makeChat({
      status: EChatStatus.ura,
      started_at: '2026-06-28T12:01:00.000Z',
      summary: {
        last_message_id: 'message-before-handoff',
      } as IChat['summary'],
      meta: {
        status_epoch: 100,
        status_event_id: 'automation-100',
        status_source: 'chatbot',
      },
    });
    const concurrentHumanChat = makeChat({
      ...automationChat,
      status: EChatStatus.queue,
      user: { id: 'user-concurrent', name: 'Concurrent', photo: null },
      meta: {
        status_epoch: 101,
        status_event_id: 'human-101',
        status_source: 'manual',
      },
    });
    const { service, elasticDatabaseService } = makeService({
      hits: { hits: [] },
    });
    elasticDatabaseService.getById
      .mockResolvedValueOnce(automationChat)
      .mockResolvedValueOnce(concurrentHumanChat);
    elasticDatabaseService.updateWithScriptOCC.mockResolvedValueOnce('noop');

    await expect(
      service.transferAutomationChatToQueue({
        accountId: 'account-1',
        chat: automationChat,
        user: null,
        sector: null,
      })
    ).resolves.toEqual({
      chat: concurrentHumanChat,
      previousChat: automationChat,
      applied: false,
      alreadyHuman: true,
    });

    expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalledWith(
      EElasticIndex.chat,
      automationChat.chat_id,
      expect.objectContaining({
        params: expect.objectContaining({
          expected_status_event_id: 'automation-100',
          expected_status_epoch: 100,
          expected_started_at: '2026-06-28T12:01:00.000Z',
          expected_last_message_id: 'message-before-handoff',
        }),
      }),
      expect.objectContaining({ upsert: false, refresh: true })
    );
  });

  it('does not downgrade chats that are already in human attendance', async () => {
    const queuedChat = makeChat({
      status: EChatStatus.queue,
      user: { id: 'user-2', name: 'Gisele', photo: null },
    });
    const { service, elasticDatabaseService } = makeService({
      hits: { hits: [] },
    });
    elasticDatabaseService.getById.mockResolvedValueOnce(queuedChat);

    await expect(
      service.transferAutomationChatToQueue({
        accountId: 'account-1',
        chat: makeChat({ status: EChatStatus.ura }),
        user: null,
        sector: null,
      })
    ).resolves.toEqual({
      chat: queuedChat,
      previousChat: queuedChat,
      applied: false,
      alreadyHuman: true,
    });

    expect(elasticDatabaseService.updateWithScriptOCC).not.toHaveBeenCalled();
  });

  it('does not transfer or return an in-memory automation chat when the persisted chat is missing', async () => {
    const inputChat = makeChat({ status: EChatStatus.ura });
    const { service, elasticDatabaseService } = makeService({
      hits: { hits: [] },
    });

    await expect(
      service.transferAutomationChatToQueue({
        accountId: 'account-1',
        chat: inputChat,
        user: null,
        sector: null,
      })
    ).resolves.toEqual({
      chat: null,
      previousChat: null,
      applied: false,
      alreadyHuman: false,
    });

    expect(elasticDatabaseService.updateWithScriptOCC).not.toHaveBeenCalled();
  });

  it('reports a failed automation handoff without treating the persisted source snapshot as applied', async () => {
    const automationChat = makeChat({ status: EChatStatus.ura });
    const { service, elasticDatabaseService } = makeService({
      hits: { hits: [] },
    });
    elasticDatabaseService.getById
      .mockResolvedValueOnce(automationChat)
      .mockResolvedValueOnce(automationChat);
    elasticDatabaseService.updateWithScriptOCC.mockResolvedValueOnce(
      'not_found'
    );

    await expect(
      service.transferAutomationChatToQueue({
        accountId: 'account-1',
        chat: automationChat,
        user: null,
        sector: null,
      })
    ).resolves.toEqual({
      chat: automationChat,
      previousChat: automationChat,
      applied: false,
      alreadyHuman: false,
    });
  });
});
