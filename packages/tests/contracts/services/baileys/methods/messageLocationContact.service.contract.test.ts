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

import { BaileysMessageLocationContactService } from '@core/services/baileys/methods/messageLocationContact.service';

describe('BaileysMessageLocationContactService', () => {
  it('delegates location and contact payloads', async () => {
    const send = jest.fn(async () => ({ ok: true }));
    const service = new BaileysMessageLocationContactService({ send } as never);

    await service.sendLocation(
      'jid',
      { degreesLatitude: 1, degreesLongitude: 2 } as never,
      {
        quoted: 'q',
      } as never
    );
    await service.sendContactCard(
      'jid',
      'VCARD1',
      'John',
      { stanzaId: 's1' } as never,
      { quoted: 'q2' } as never
    );
    await service.sendContacts(
      'jid',
      ['VCARD1', 'VCARD2'],
      'People',
      { stanzaId: 's2' } as never,
      { quoted: 'q3' } as never
    );

    expect(send).toHaveBeenNthCalledWith(
      1,
      'jid',
      { location: { degreesLatitude: 1, degreesLongitude: 2 } },
      { quoted: 'q' }
    );
    expect(send).toHaveBeenNthCalledWith(
      2,
      'jid',
      {
        contacts: { displayName: 'John', contacts: [{ vcard: 'VCARD1' }] },
        contextInfo: { stanzaId: 's1' },
      },
      { quoted: 'q2' }
    );
    expect(send).toHaveBeenNthCalledWith(
      3,
      'jid',
      {
        contacts: {
          displayName: 'People',
          contacts: [{ vcard: 'VCARD1' }, { vcard: 'VCARD2' }],
        },
        contextInfo: { stanzaId: 's2' },
      },
      { quoted: 'q3' }
    );
  });
});
