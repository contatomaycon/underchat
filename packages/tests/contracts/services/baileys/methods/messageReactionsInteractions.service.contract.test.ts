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

import { BaileysMessageReactionsInteractionsService } from '@core/services/baileys/methods/messageReactionsInteractions.service';

describe('BaileysMessageReactionsInteractionsService', () => {
  it('delegates react, pin and poll payloads', async () => {
    const send = jest.fn(async () => ({ ok: true }));
    const service = new BaileysMessageReactionsInteractionsService({
      send,
    } as never);

    const key = { id: 'k1' } as never;
    await service.react('jid', key, '👍', { quoted: 'q' } as never);
    await service.pinMessage('jid', key, 'pin' as never, 86400, {
      quoted: 'q2',
    } as never);
    await service.sendPoll(
      'jid',
      { name: 'poll', values: ['a', 'b'], selectableCount: 1 } as never,
      { quoted: 'q3' } as never
    );

    expect(send).toHaveBeenNthCalledWith(
      1,
      'jid',
      { react: { text: '👍', key } },
      { quoted: 'q' }
    );
    expect(send).toHaveBeenNthCalledWith(
      2,
      'jid',
      { pin: key, type: 'pin', time: 86400 },
      { quoted: 'q2' }
    );
    expect(send).toHaveBeenNthCalledWith(
      3,
      'jid',
      { poll: { name: 'poll', values: ['a', 'b'], selectableCount: 1 } },
      { quoted: 'q3' }
    );
  });
});
