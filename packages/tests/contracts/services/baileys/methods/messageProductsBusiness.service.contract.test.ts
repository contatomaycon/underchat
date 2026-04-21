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
      AudioMessage: { fromObject: (value: unknown) => value },
      fromObject: (value: unknown) => value,
    },
  },
}));
jest.mock('@core/services/balanceWorkerStatusGrpcClient.service', () => ({
  BalanceWorkerStatusGrpcClientService: class {},
}));

jest.mock('@core/services/baileys/methods/helpers.service', () => ({
  BaileysHelpersService: class {},
}));

import { BaileysMessageProductsBusinessService } from '@core/services/baileys/methods/messageProductsBusiness.service';

describe('BaileysMessageProductsBusinessService', () => {
  it('delegates sendProduct payload with optional args', async () => {
    const send = jest.fn(async () => ({ sent: true }));
    const service = new BaileysMessageProductsBusinessService({
      send,
    } as never);

    const product = { productId: 'p1' } as never;
    await expect(
      service.sendProduct(
        'jid',
        product,
        { businessOwnerJid: 'owner', body: 'body', footer: 'footer' },
        { quoted: 'q' } as never
      )
    ).resolves.toEqual({ sent: true });

    expect(send).toHaveBeenCalledWith(
      'jid',
      {
        product,
        businessOwnerJid: 'owner',
        body: 'body',
        footer: 'footer',
      },
      { quoted: 'q' }
    );
  });
});
