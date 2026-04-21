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
jest.mock('@core/services/baileys/methods/messageEditDelete.service', () => ({
  BaileysMessageEditDeleteService: class {},
}));

import { BaileysMessageStatusStoriesService } from '@core/services/baileys/methods/messageStatusStories.service';

describe('BaileysMessageStatusStoriesService', () => {
  it('delegates status senders and deleteStatus', async () => {
    const addOwnJidToStatusList = jest.fn((list: string[]) => [
      ...list,
      'own@jid',
    ]);
    const send = jest.fn(async () => ({ ok: true }));
    const deleteMessage = jest.fn(async () => ({ deleted: true }));

    const service = new BaileysMessageStatusStoriesService(
      { addOwnJidToStatusList, send } as never,
      { deleteMessage } as never
    );

    await service.sendStatusImage(
      'status@broadcast',
      { media: 'i' } as never,
      {
        caption: 'img',
        statusJidList: ['a@jid'],
        backgroundColor: '#000',
        font: 1,
      } as never
    );
    await service.sendStatusVideo(
      'status@broadcast',
      { media: 'v' } as never,
      {
        caption: 'vid',
        statusJidList: ['b@jid'],
        backgroundColor: '#111',
        font: 2,
      } as never
    );
    await service.sendStatusText('status@broadcast', 'txt', {
      statusJidList: ['c@jid'],
      backgroundColor: '#222',
      font: 3,
    } as never);
    await service.sendStatusAudio(
      'status@broadcast',
      { media: 'a' } as never,
      {
        caption: 'aud',
        statusJidList: ['d@jid'],
        backgroundColor: '#333',
        font: 4,
      } as never
    );
    await service.deleteStatus('ext-1', ['z@jid']);

    expect(send).toHaveBeenCalledTimes(4);
    expect(deleteMessage).toHaveBeenCalledWith(
      'status@broadcast',
      { remoteJid: 'status@broadcast', fromMe: true, id: 'ext-1' },
      { broadcast: true, statusJidList: ['z@jid', 'own@jid'] }
    );
  });
});
