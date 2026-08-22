import 'reflect-metadata';

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) =>
    jid.replace(/@c\.us$/u, '@s.whatsapp.net')
  ),
}));

import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import type { IChat } from '@core/common/interfaces/IChat';
import { ChatService } from '@core/services/chat.service';

describe('ChatService incoming-call template rendering', () => {
  it('uses the canonical chat, protocol OCC, cache and webhook outbox', async () => {
    const accountId = '01900000-0000-7000-8000-000000000109';
    const workerId = '01900000-0000-7000-8000-000000000110';
    const eventId = '01900000-0000-7000-8000-000000000111';
    const chat: IChat = {
      chat_id: 'chat-1',
      account: { id: accountId, name: 'Acme' },
      worker: { id: workerId, name: 'Suporte' },
      name: 'Contato',
      phone: '5511999999999',
      status: EChatStatus.in_chat,
      date: '2026-08-01T12:00:00.000Z',
      user: { id: 'user-1', name: 'Ana' },
      sector: { id: 'sector-1', name: 'Financeiro' },
      contact: null,
      protocol_start: [],
      message_key: { remote_jid: '5511999999999@s.whatsapp.net' },
    } as IChat;
    const redis = {
      get: jest.fn(async () => null),
      set: jest.fn(async () => 'OK'),
      del: jest.fn(async () => 1),
    };
    const elastic = {
      selectOrThrow: jest.fn(async () => ({
        hits: { hits: [{ _source: chat }] },
      })),
      getById: jest
        .fn()
        .mockResolvedValueOnce(chat)
        .mockImplementationOnce(async () => {
          const calls = elastic.updateWithScriptOCC.mock
            .calls as unknown as unknown[][];
          const script = calls[0]?.[2] as
            { params?: { protocol?: string } } | undefined;
          return {
            ...chat,
            protocol_start: [script?.params?.protocol ?? 'missing'],
            meta: { outbound_webhook_event_ids: [eventId] },
          };
        }),
      updateWithScriptOCC: jest.fn(async () => 'updated'),
    };
    const outbound = {
      prepareBestEffort: jest.fn(async () => ({
        eventId,
        envelope: {
          id: eventId,
          type: 'chat.protocol.updated',
          api_version: '1',
          occurred_at: '2026-08-01T12:00:01.000Z',
          account_id: accountId,
          aggregate: { type: 'chat', id: 'chat-1' },
          data: {},
        },
        created: true,
        state: 'preparing',
      })),
      completeBestEffort: jest.fn(async () => true),
      cancel: jest.fn(async () => undefined),
    };
    const service = new ChatService(
      redis as never,
      elastic as never,
      {} as never,
      {} as never,
      outbound as never
    );

    const rendered = await service.renderIncomingCallTemplate({
      accountId,
      accountName: 'Acme',
      workerId,
      workerName: 'Suporte',
      template: 'Protocolo {{protocol}} · {{user}} · {{sector}}',
      callJid: '5511999999999@s.whatsapp.net',
      callPhone: '55 (11) 99999-9999',
    });

    expect(rendered).toMatch(/^Protocolo \d+ · Ana · Financeiro$/u);
    expect(elastic.selectOrThrow).toHaveBeenCalledWith(
      EElasticIndex.chat,
      expect.objectContaining({ size: 1 })
    );
    expect(elastic.updateWithScriptOCC).toHaveBeenCalledWith(
      EElasticIndex.chat,
      'chat-1',
      expect.objectContaining({
        params: expect.objectContaining({
          protocol_type: 'protocol_start',
          outbound_webhook_event_ids: [eventId],
        }),
      }),
      { upsert: false, maxRetries: 5, refresh: true }
    );
    expect(outbound.completeBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ eventId, accountId })
    );
    expect(redis.set).toHaveBeenCalledWith(
      `underchat:chat:${accountId}:${workerId}:${chat.phone}`,
      expect.any(String),
      'PX',
      60_000
    );
    expect(redis.set).toHaveBeenCalledWith(
      `chat:${accountId}:${chat.chat_id}`,
      expect.any(String),
      'PX',
      60_000
    );
  });

  it('renders against a scoped fallback chat without creating a protocol', async () => {
    const elastic = {
      selectOrThrow: jest.fn(async () => ({ hits: { hits: [] } })),
      getById: jest.fn(),
      updateWithScriptOCC: jest.fn(),
    };
    const service = new ChatService(
      {
        get: jest.fn(async () => null),
        set: jest.fn(async () => 'OK'),
        del: jest.fn(async () => 1),
      } as never,
      elastic as never,
      {} as never,
      {} as never,
      null
    );

    await expect(
      service.renderIncomingCallTemplate({
        accountId: 'account-1',
        accountName: 'Acme',
        workerId: 'worker-1',
        workerName: 'Suporte',
        template: '{{account_name}} · {{channel_name}}',
        callPhone: '5511999999999',
      })
    ).resolves.toBe('Acme · Suporte');
    expect(elastic.updateWithScriptOCC).not.toHaveBeenCalled();
  });

  it('rejects a cached chat from another tenant and reads the scoped canonical chat', async () => {
    const accountId = '01900000-0000-7000-8000-000000000120';
    const workerId = '01900000-0000-7000-8000-000000000121';
    const phone = '5511999999999';
    const poisonedChat = {
      chat_id: 'poisoned-chat',
      account: {
        id: '01900000-0000-7000-8000-000000000122',
        name: 'Outra conta',
      },
      worker: {
        id: '01900000-0000-7000-8000-000000000123',
        name: 'Outro canal',
      },
      name: 'Outro contato',
      phone,
      status: EChatStatus.in_chat,
      date: '2026-08-01T12:00:00.000Z',
      user: { id: 'other-user', name: 'Outro atendente' },
      sector: { id: 'other-sector', name: 'Outro setor' },
      contact: null,
      message_key: { remote_jid: `${phone}@s.whatsapp.net` },
    } as IChat;
    const canonicalChat = {
      ...poisonedChat,
      chat_id: 'canonical-chat',
      account: { id: accountId, name: 'Conta correta' },
      worker: { id: workerId, name: 'Canal correto' },
      name: 'Contato correto',
      user: { id: 'user-1', name: 'Atendente correto' },
      sector: { id: 'sector-1', name: 'Setor correto' },
    } as IChat;
    const redis = {
      get: jest
        .fn()
        .mockResolvedValueOnce(JSON.stringify(poisonedChat))
        .mockResolvedValue(null),
      set: jest.fn(async () => 'OK'),
      del: jest.fn(async () => 1),
    };
    const elastic = {
      selectOrThrow: jest.fn(async () => ({
        hits: { hits: [{ _source: canonicalChat }] },
      })),
    };
    const service = new ChatService(
      redis as never,
      elastic as never,
      {} as never,
      {} as never,
      null
    );

    await expect(
      service.renderIncomingCallTemplate({
        accountId,
        accountName: 'Conta correta',
        workerId,
        workerName: 'Canal correto',
        template: '{{name}} · {{user}} · {{sector}}',
        callJid: `${phone}@s.whatsapp.net`,
        callPhone: phone,
      })
    ).resolves.toBe('Contato correto · Atendente correto · Setor correto');

    expect(redis.del).toHaveBeenCalledWith(
      `underchat:chat:${accountId}:${workerId}:${phone}`
    );
    expect(elastic.selectOrThrow).toHaveBeenCalledTimes(1);
  });

  it('propagates an Elasticsearch outage so the worker can use its static fallback', async () => {
    const service = new ChatService(
      {
        get: jest.fn(async () => null),
        set: jest.fn(async () => 'OK'),
        del: jest.fn(async () => 1),
      } as never,
      {
        selectOrThrow: jest.fn(async () => {
          throw new Error('elasticsearch_unavailable');
        }),
      } as never,
      {} as never,
      {} as never,
      null
    );

    await expect(
      service.renderIncomingCallTemplate({
        accountId: '01900000-0000-7000-8000-000000000124',
        accountName: 'Acme',
        workerId: '01900000-0000-7000-8000-000000000125',
        workerName: 'Suporte',
        template: 'Não atendemos. {{protocol}}',
        callPhone: '5511999999999',
      })
    ).rejects.toThrow('elasticsearch_unavailable');
  });

  it('refreshes both cache views with the OCC winner after a noop', async () => {
    const accountId = '01900000-0000-7000-8000-000000000126';
    const workerId = '01900000-0000-7000-8000-000000000127';
    const chat = {
      chat_id: 'chat-noop',
      account: { id: accountId, name: 'Acme' },
      worker: { id: workerId, name: 'Suporte' },
      name: 'Contato',
      phone: '5511999999999',
      status: EChatStatus.in_chat,
      date: '2026-08-01T12:00:00.000Z',
      user: null,
      sector: null,
      contact: null,
      protocol_start: [],
      message_key: { remote_jid: '5511999999999@s.whatsapp.net' },
    } as IChat;
    const winner = { ...chat, protocol_start: ['202608011234567'] } as IChat;
    const redis = {
      get: jest.fn(async () => null),
      set: jest.fn(async () => 'OK'),
      del: jest.fn(async () => 1),
    };
    const elastic = {
      getById: jest
        .fn()
        .mockResolvedValueOnce(chat)
        .mockResolvedValueOnce(winner),
      updateWithScriptOCC: jest.fn(async () => 'noop'),
    };
    const outbound = {
      prepareBestEffort: jest.fn(async () => null),
      completeBestEffort: jest.fn(async () => true),
      cancel: jest.fn(async () => undefined),
    };
    const service = new ChatService(
      redis as never,
      elastic as never,
      {} as never,
      {} as never,
      outbound as never
    );

    await expect(
      service.getOrCreateChatProtocol(accountId, chat.chat_id, 'protocol_start')
    ).resolves.toBe('202608011234567');

    expect(redis.set).toHaveBeenCalledWith(
      `underchat:chat:${accountId}:${workerId}:${chat.phone}`,
      JSON.stringify(winner),
      'PX',
      60_000
    );
    expect(redis.set).toHaveBeenCalledWith(
      `chat:${accountId}:${chat.chat_id}`,
      JSON.stringify(winner),
      'PX',
      60_000
    );
  });
});
