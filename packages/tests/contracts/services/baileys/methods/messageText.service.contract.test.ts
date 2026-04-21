import 'reflect-metadata';

jest.mock('@whiskeysockets/baileys', () => ({
  __esModule: true,
  default: jest.fn(),
  Browsers: { ubuntu: jest.fn(() => ['Ubuntu', 'Chrome', '120']) },
  fetchLatestBaileysVersion: jest.fn(async () => ({ version: [2, 3000, 1] })),
  fetchLatestWaWebVersion: jest.fn(async () => ({ version: [2, 3000, 1] })),
  makeWASocket: jest.fn(() => ({})),
  useMultiFileAuthState: jest.fn(async () => ({
    state: {},
    saveCreds: jest.fn(),
  })),
  generateMessageIDV2: jest.fn(() => 'mid'),
  generateWAMessageContent: jest.fn(async () => ({})),
  generateWAMessageFromContent: jest.fn(() => ({
    key: { id: 'mid' },
    message: {},
  })),
  proto: {
    Message: {
      AudioMessage: { fromObject: (v: unknown) => v },
      fromObject: (v: unknown) => v,
    },
  },
}));
jest.mock('@core/services/balanceWorkerStatusGrpcClient.service', () => ({
  BalanceWorkerStatusGrpcClientService: class {},
}));
jest.mock('@core/services/baileys/methods/helpers.service', () => ({
  BaileysHelpersService: class {},
}));

import { BaileysMessageTextService } from '@core/services/baileys/methods/messageText.service';

describe('BaileysMessageTextService', () => {
  it('delegates sendText/sendTextQuoted/sendMention/forward payloads', async () => {
    const send = jest.fn(async () => ({ ok: true }));
    const service = new BaileysMessageTextService({ send } as never);

    await service.sendText('jid', 'hello', {
      mentions: ['a@c.us'],
      contextInfo: { stanzaId: 's1' },
      linkPreview: { canonicalUrl: 'https://x' } as never,
    } as never);
    await service.sendTextQuoted(
      'jid',
      'quoted',
      { key: { id: 'k1' } } as never,
      {
        quoted: 'ignore',
      } as never
    );
    await service.sendMention('jid', '@john', ['john@c.us'], {
      quoted: 'q',
    } as never);
    await service.forward('jid', { key: { id: 'k2' } } as never, true, {
      quoted: 'q2',
    } as never);

    expect(send).toHaveBeenNthCalledWith(
      1,
      'jid',
      {
        text: 'hello',
        linkPreview: { canonicalUrl: 'https://x' },
        mentions: ['a@c.us'],
        contextInfo: { stanzaId: 's1' },
      },
      {
        mentions: ['a@c.us'],
        contextInfo: { stanzaId: 's1' },
        linkPreview: { canonicalUrl: 'https://x' },
      }
    );
    expect(send).toHaveBeenNthCalledWith(
      2,
      'jid',
      { text: 'quoted' },
      { quoted: { key: { id: 'k1' } } }
    );
    expect(send).toHaveBeenNthCalledWith(
      3,
      'jid',
      { text: '@john', mentions: ['john@c.us'] },
      { quoted: 'q' }
    );
    expect(send).toHaveBeenNthCalledWith(
      4,
      'jid',
      { forward: { key: { id: 'k2' } }, force: true },
      { quoted: 'q2' }
    );
  });
});
