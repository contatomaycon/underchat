import 'reflect-metadata';

jest.mock('@core/services/wwebjs/methods/helpers.service', () => ({
  WwebjsHelpersService: class {},
}));

jest.mock('@core/services/wwebjs/util/messageToWaLike', () => ({
  messageToWaLike: jest.fn((msg) => ({ wrapped: msg })),
}));

jest.mock('@core/services/wwebjs/util/resolveQuotedMessageId', () => ({
  resolveQuotedMessageId: jest.fn(async () => 'quoted-id'),
}));

import { WwebjsMessageTextService } from '@core/services/wwebjs/methods/messageText.service';

describe('WwebjsMessageTextService', () => {
  it('sends text with options and quoted fallback branches', async () => {
    const sendMessage = jest
      .fn<Promise<unknown>, unknown[]>()
      .mockResolvedValueOnce({ id: 'm1' })
      .mockResolvedValueOnce({ id: 'm2' })
      .mockResolvedValueOnce({ id: 'm3' });

    const service = new WwebjsMessageTextService({
      sendMessage,
      getClient: jest.fn(() => ({ id: 'client' })),
    } as never);

    await expect(
      service.sendText('jid', 'hello', {
        mentions: ['u1@c.us'],
        extra: { a: 1 },
      })
    ).resolves.toEqual({ wrapped: { id: 'm1' } });

    await expect(
      service.sendTextQuoted(
        'jid',
        'quoted',
        { key: { id: 'k1', remoteJid: 'jid' } } as never,
        { extra: { b: 2 } }
      )
    ).resolves.toEqual({ wrapped: { id: 'm2' } });

    await expect(
      service.sendTextQuoted('jid', 'quoted2', { key: {} } as never, {
        extra: { c: 3 },
      })
    ).resolves.toEqual({ wrapped: { id: 'm3' } });

    expect(sendMessage).toHaveBeenNthCalledWith(
      1,
      'jid',
      'hello',
      {
        linkPreview: true,
        extra: { a: 1 },
        mentions: ['u1@c.us'],
      },
      undefined
    );
    expect(sendMessage).toHaveBeenNthCalledWith(
      2,
      'jid',
      'quoted',
      {
        extra: { b: 2 },
        quotedMessageId: 'quoted-id',
        ignoreQuoteErrors: false,
      },
      undefined
    );
    expect(sendMessage).toHaveBeenNthCalledWith(
      3,
      'jid',
      'quoted2',
      {
        extra: { c: 3 },
        quotedMessageId: 'quoted-id',
        ignoreQuoteErrors: false,
      },
      undefined
    );
  });
});
