import 'reflect-metadata';

jest.mock('@wwebjs/whatsapp-web.js', () => ({
  __esModule: true,
  default: {
    Client: class {},
    LocalAuth: class {},
    MessageMedia: { fromFilePath: jest.fn() },
  },
}));
jest.mock('@core/services/balanceWorkerStatusGrpcClient.service', () => ({
  BalanceWorkerStatusGrpcClientService: class {},
}));

jest.mock('@core/services/wwebjs/methods/connection.service', () => ({
  WwebjsConnectionService: class {},
}));
jest.mock('@core/services/wwebjs/methods/phoneValidation.service', () => ({
  WwebjsPhoneValidationService: class {},
}));

import { WwebjsService } from '@core/services/wwebjs';

describe('WwebjsService', () => {
  it('delegates connection and phone validation methods', async () => {
    const connection = {
      connected: false,
      connect: jest.fn(async () => ({ connected: false })),
      reconnect: jest.fn(),
      disconnect: jest.fn(async () => undefined),
      getStatus: jest.fn(() => 'offline'),
      getCode: jest.fn(() => 'code2'),
      hasSession: jest.fn(() => false),
      getSocket: jest.fn(() => ({ client: true })),
      clearUserRequestedDisconnect: jest.fn(),
      republishLastState: jest.fn(),
      shutdown: jest.fn(async () => undefined),
    };

    const validatePhone = jest.fn(async () => ({ valid: false }));

    const service = new WwebjsService(
      connection as never,
      {
        validatePhone,
      } as never
    );

    await expect(service.connect({} as never)).resolves.toEqual({
      connected: false,
    });
    service.reconnect({} as never);
    await expect(service.disconnect({} as never)).resolves.toBeUndefined();
    expect(service.isConnected()).toBe(false);
    expect(service.getStatus()).toBe('offline');
    expect(service.getCode()).toBe('code2');
    expect(service.hasSession()).toBe(false);
    expect(service.socket).toEqual({ client: true });
    service.clearUserRequestedDisconnect();
    service.republishLastState();
    await expect(service.shutdown()).resolves.toBeUndefined();
    await expect(service.validatePhone('55', '1199999')).resolves.toEqual({
      valid: false,
    });
  });
});
