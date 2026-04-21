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

import { BaileysMessageEditDeleteService } from '@core/services/baileys/methods/messageEditDelete.service';

describe('BaileysMessageEditDeleteService', () => {
  it('delegates deleteMessage and editText payloads', async () => {
    const send = jest.fn(async () => ({ ok: true }));
    const service = new BaileysMessageEditDeleteService({ send } as never);

    const key = { id: 'k1' } as never;

    await service.deleteMessage('jid', key, { quoted: 'q' } as never);
    await service.editText('jid', 'new text', key, { quoted: 'q2' } as never);

    expect(send).toHaveBeenNthCalledWith(
      1,
      'jid',
      { delete: key },
      { quoted: 'q' }
    );
    expect(send).toHaveBeenNthCalledWith(
      2,
      'jid',
      { text: 'new text', edit: key },
      { quoted: 'q2' }
    );
  });
});
