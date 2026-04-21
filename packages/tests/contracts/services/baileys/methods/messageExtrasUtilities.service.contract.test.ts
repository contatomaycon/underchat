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

import { BaileysMessageExtrasUtilitiesService } from '@core/services/baileys/methods/messageExtrasUtilities.service';

describe('BaileysMessageExtrasUtilitiesService', () => {
  it('delegates utility message wrappers', async () => {
    const send = jest.fn(async () => ({ ok: true }));
    const service = new BaileysMessageExtrasUtilitiesService({ send } as never);

    await service.sendWithContext(
      'jid',
      { text: 'x' } as never,
      { stanzaId: 's1' } as never,
      {
        quoted: 'q',
      } as never
    );
    await service.sendWithMessageId('jid', { text: 'x' } as never, 'mid-1', {
      quoted: 'q2',
    } as never);
    await service.sendAsBroadcast(
      'jid',
      { text: 'x' } as never,
      ['a@jid'],
      { backgroundColor: '#000', font: 1 },
      { quoted: 'q3' } as never
    );
    await service.sendWithViewOnce(
      'jid',
      { text: 'x' } as never,
      { quoted: 'q4' } as never
    );
    await service.sendEphemeral('jid', { text: 'x' } as never, 60, {
      quoted: 'q5',
    } as never);
    await service.sendWithQuoted(
      'jid',
      { text: 'x' } as never,
      { key: { id: 'k1' } } as never,
      { quoted: 'q6' } as never
    );
    await service.sendToStatusRecipients(
      { text: 'x' } as never,
      ['a@jid', 'b@jid'],
      { quoted: 'q7' } as never
    );

    expect(send).toHaveBeenCalledTimes(7);
    expect(send).toHaveBeenLastCalledWith(
      'status@broadcast',
      { text: 'x' },
      { quoted: 'q7', statusJidList: ['a@jid', 'b@jid'], broadcast: true }
    );
  });
});
