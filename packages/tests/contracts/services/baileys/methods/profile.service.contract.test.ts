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

import { BaileysProfileService } from '@core/services/baileys/methods/profile.service';

describe('BaileysProfileService', () => {
  it('delegates profile updates and removes profile picture using own jid', async () => {
    const helpers = {
      updateProfileName: jest.fn(async () => undefined),
      updateProfileStatus: jest.fn(async () => undefined),
      updateProfilePicture: jest.fn(async () => undefined),
      getOwnJid: jest.fn(() => '5511@s.whatsapp.net'),
      removeProfilePicture: jest.fn(async () => undefined),
    };

    const service = new BaileysProfileService(helpers as never);

    await service.updateProfileName('Name');
    await service.updateProfileStatus('Status');
    await service.updateProfilePicture('https://img');
    await service.removeProfilePicture();

    expect(helpers.updateProfileName).toHaveBeenCalledWith('Name');
    expect(helpers.updateProfileStatus).toHaveBeenCalledWith('Status');
    expect(helpers.updateProfilePicture).toHaveBeenCalledWith('https://img');
    expect(helpers.removeProfilePicture).toHaveBeenCalledWith(
      '5511@s.whatsapp.net'
    );
  });
});
