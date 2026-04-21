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

import { BaileysMessageButtonsListsInvitationsService } from '@core/services/baileys/methods/messageButtonsListsInvitations.service';

describe('BaileysMessageButtonsListsInvitationsService', () => {
  it('delegates button reply, list reply and group invite', async () => {
    const send = jest.fn(async () => ({ ok: true }));
    const service = new BaileysMessageButtonsListsInvitationsService({
      send,
    } as never);

    await service.sendButtonReply(
      'jid',
      { selectedButtonId: 'b1' } as never,
      'template',
      {
        quoted: 'q',
      } as never
    );
    await service.sendListReply(
      'jid',
      { title: 'list' } as never,
      { quoted: 'q2' } as never
    );
    await service.sendGroupInvite(
      'jid',
      {
        inviteCode: 'abc',
        inviteExpiration: 10,
        text: 'join',
        jid: 'group@g.us',
        subject: 'Group',
      },
      { quoted: 'q3' } as never
    );

    expect(send).toHaveBeenNthCalledWith(
      1,
      'jid',
      { buttonReply: { selectedButtonId: 'b1' }, type: 'template' },
      { quoted: 'q' }
    );
    expect(send).toHaveBeenNthCalledWith(
      2,
      'jid',
      { listReply: { title: 'list' } },
      { quoted: 'q2' }
    );
    expect(send).toHaveBeenNthCalledWith(
      3,
      'jid',
      {
        groupInvite: {
          inviteCode: 'abc',
          inviteExpiration: 10,
          text: 'join',
          jid: 'group@g.us',
          subject: 'Group',
        },
      },
      { quoted: 'q3' }
    );
  });
});
