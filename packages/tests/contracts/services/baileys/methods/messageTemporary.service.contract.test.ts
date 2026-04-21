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

import { BaileysMessageTemporaryService } from '@core/services/baileys/methods/messageTemporary.service';

describe('BaileysMessageTemporaryService', () => {
  it('delegates setDisappearingMessages', async () => {
    const send = jest.fn(async () => ({ ok: true }));
    const service = new BaileysMessageTemporaryService({ send } as never);

    await expect(
      service.setDisappearingMessages('jid', 86400, { quoted: 'q' } as never)
    ).resolves.toEqual({
      ok: true,
    });
    expect(send).toHaveBeenCalledWith(
      'jid',
      { disappearingMessagesInChat: 86400 },
      { quoted: 'q' }
    );
  });
});
