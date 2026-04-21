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
jest.mock('@core/services/baileys/methods/connection.service', () => ({
  BaileysConnectionService: class {},
}));
jest.mock('@core/services/baileys/methods/phoneValidation.service', () => ({
  BaileysPhoneValidationService: class {},
}));

import { BaileysService } from '@core/services/baileys';

describe('BaileysService', () => {
  it('delegates connection and phone validation methods', async () => {
    const connection = {
      connected: true,
      connect: jest.fn(async () => ({ connected: true })),
      reconnect: jest.fn(),
      disconnect: jest.fn(async () => undefined),
      getStatus: jest.fn(() => 'online'),
      getCode: jest.fn(() => 'code'),
      hasSession: jest.fn(() => true),
      getSocket: jest.fn(() => ({ socket: true })),
      clearUserRequestedDisconnect: jest.fn(),
      republishLastState: jest.fn(),
      shutdown: jest.fn(async () => undefined),
    };

    const validatePhone = jest.fn(async () => ({ valid: true }));

    const service = new BaileysService(
      connection as never,
      { validatePhone } as never
    );

    await expect(service.connect({} as never)).resolves.toEqual({
      connected: true,
    });
    service.reconnect({} as never);
    await expect(service.disconnect({} as never)).resolves.toBeUndefined();
    expect(service.isConnected()).toBe(true);
    expect(service.getStatus()).toBe('online');
    expect(service.getCode()).toBe('code');
    expect(service.hasSession()).toBe(true);
    expect(service.socket).toEqual({ socket: true });
    service.clearUserRequestedDisconnect();
    service.republishLastState();
    await expect(service.shutdown()).resolves.toBeUndefined();
    await expect(service.validatePhone('55', '1199999')).resolves.toEqual({
      valid: true,
    });
  });
});
