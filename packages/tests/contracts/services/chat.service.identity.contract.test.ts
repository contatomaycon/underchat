import 'reflect-metadata';

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) =>
    jid.replace(/@c\.us$/, '@s.whatsapp.net')
  ),
}));

import { EChatStatus } from '@core/common/enums/EChatStatus';
import type { IChat } from '@core/common/interfaces/IChat';
import { ChatService } from '@core/services/chat.service';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';

describe('ChatService chat identity lookup', () => {
  const account = { id: 'account-1', name: 'Account' };
  const worker = { id: 'worker-1', name: 'Worker' };

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

  function makeService(
    selectResult: unknown,
    cachedValue: string | null = null
  ): {
    service: ChatService;
    redis: {
      get: jest.Mock;
      set: jest.Mock;
      del: jest.Mock;
    };
    elasticDatabaseService: {
      indices: jest.Mock;
      select: jest.Mock;
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
      select: jest.fn(async () => selectResult),
      updateWithScriptOCC: jest.fn(async () => 'updated'),
    };
    const service = new ChatService(
      redis as never,
      elasticDatabaseService as never,
      {} as never,
      {} as never
    );

    return { service, redis, elasticDatabaseService };
  }

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

      expect(elasticDatabaseService.select).toHaveBeenCalledTimes(1);
      expect(elasticDatabaseService.updateWithScriptOCC).toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
