import 'reflect-metadata';

jest.mock('@core/common/functions/normalizeJid', () => ({
  normalizeJid: jest.fn((jid?: string | null) =>
    jid ? jid.replace(/@c\.us$/, '@s.whatsapp.net') : undefined
  ),
}));

import { LidJidCacheService } from '@core/services/lidJidCache.service';
import type { IChat } from '@core/common/interfaces/IChat';

describe('LidJidCacheService', () => {
  const makeRedis = () => ({
    status: 'ready',
    get: jest.fn<Promise<string | null>, [string]>(async () => null),
    set: jest.fn<Promise<string | null>, unknown[]>(async () => 'OK'),
  });

  it('stores a LID to phone JID mapping with TTL', async () => {
    const redis = makeRedis();
    const service = new LidJidCacheService(redis as never);

    await expect(
      service.remember(
        'account-1',
        'worker-1',
        '123456789@lid',
        '556999715039@c.us'
      )
    ).resolves.toBe('556999715039@s.whatsapp.net');

    expect(redis.set).toHaveBeenCalledWith(
      'inbound:lid-jid:account-1:worker-1:123456789@lid',
      '556999715039@s.whatsapp.net',
      'EX',
      60 * 60 * 24 * 30
    );
  });

  it('resolves a cached LID from Redis', async () => {
    const redis = makeRedis();
    redis.get.mockResolvedValueOnce('556999715039@s.whatsapp.net');
    const service = new LidJidCacheService(redis as never);

    await expect(
      service.resolvePhoneJid('account-1', 'worker-1', '123456789@lid')
    ).resolves.toBe('556999715039@s.whatsapp.net');

    expect(redis.get).toHaveBeenCalledWith(
      'inbound:lid-jid:account-1:worker-1:123456789@lid'
    );
  });

  it('does not store non-phone targets', async () => {
    const redis = makeRedis();
    const service = new LidJidCacheService(redis as never);

    await expect(
      service.remember('account-1', 'worker-1', '123456789@lid', '120@g.us')
    ).resolves.toBeNull();

    expect(redis.set).not.toHaveBeenCalled();
  });

  it('can recover a phone JID from an active chat', async () => {
    const redis = makeRedis();
    const service = new LidJidCacheService(redis as never);
    const chat = {
      phone: '556999715039',
      message_key: {
        remote_jid: '123456789@lid',
      },
    } as IChat;

    await expect(
      service.rememberFromChat('account-1', 'worker-1', chat)
    ).resolves.toBe('556999715039@s.whatsapp.net');

    expect(service.extractPhoneJidFromChat(chat)).toBe(
      '556999715039@s.whatsapp.net'
    );
  });
});
