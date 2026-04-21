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

jest.mock('@core/common/functions/buildCandidatesBR', () => ({
  buildCandidates: jest.fn(() => ['55119999', '55118888']),
}));

jest.mock('@core/common/functions/normalizeJid', () => ({
  normalizeJid: jest.fn((jid: string) => jid),
}));

jest.mock('@core/common/functions/onlyDigits', () => ({
  onlyDigits: jest.fn((v: string) => v.replaceAll(/\D/g, '')),
}));

jest.mock('@core/common/functions/getPhoneNumber', () => ({
  getPhoneNumber: jest.fn((jid: string) => jid.split('@')[0]),
}));

jest.mock('@core/services/baileys/methods/connection.service', () => ({
  BaileysConnectionService: class {},
}));

import { BaileysPhoneValidationService } from '@core/services/baileys/methods/phoneValidation.service';

describe('BaileysPhoneValidationService', () => {
  it('throws when socket is not connected', async () => {
    const service = new BaileysPhoneValidationService({
      getSocket: jest.fn(() => undefined),
    } as never);

    await expect(service.validatePhone('55', '11999999999')).rejects.toThrow(
      'Baileys socket not connected'
    );
  });

  it('returns valid true when one candidate exists', async () => {
    const onWhatsApp = jest
      .fn<Promise<Array<{ exists: boolean; jid?: string }>>, [string]>()
      .mockResolvedValueOnce([{ exists: false }])
      .mockResolvedValueOnce([
        { exists: true, jid: '55118888@s.whatsapp.net' },
      ]);

    const service = new BaileysPhoneValidationService({
      getSocket: jest.fn(() => ({ onWhatsApp })),
    } as never);

    await expect(service.validatePhone('55', '119999')).resolves.toEqual({
      valid: true,
      jid: '55118888@s.whatsapp.net',
      phone: '55118888',
    });
  });

  it('returns valid false when no candidate exists', async () => {
    const onWhatsApp = jest.fn(async () => [{ exists: false }]);
    const service = new BaileysPhoneValidationService({
      getSocket: jest.fn(() => ({ onWhatsApp })),
    } as never);

    await expect(service.validatePhone('55', '119999')).resolves.toEqual({
      valid: false,
    });
  });
});
