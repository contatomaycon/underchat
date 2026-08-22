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

  it('fences a stuck validation call and resumes only with a recreated socket', async () => {
    const previousTimeout = process.env.WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT_MS;
    process.env.WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT_MS = '1000';
    jest.useFakeTimers();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const oldSocket = {
        onWhatsApp: jest.fn(() => new Promise<never>(() => undefined)),
      };
      const freshSocket = {
        onWhatsApp: jest.fn(async () => [
          { exists: true, jid: '55119999@s.whatsapp.net' },
        ]),
      };
      const connection = {
        getSocket: jest.fn(() => oldSocket),
        reportOutboundSendFailure: jest.fn(() => false),
        ensureOutboundSendRecovery: jest.fn(),
      };
      const service = new BaileysPhoneValidationService(connection as never);

      const validation = service.validatePhone('55', '119999');
      const rejection = expect(validation).rejects.toMatchObject({
        code: 'WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT',
        operation: 'validate_phone',
      });

      await jest.advanceTimersByTimeAsync(1_000);
      await rejection;

      await expect(service.validatePhone('55', '119999')).rejects.toMatchObject(
        { code: 'OUTBOUND_PROVIDER_CALL_IN_FLIGHT' }
      );
      expect(oldSocket.onWhatsApp).toHaveBeenCalledTimes(1);
      expect(connection.reportOutboundSendFailure).toHaveBeenCalledWith(
        oldSocket,
        expect.objectContaining({
          code: 'WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT',
        }),
        { timedOut: true }
      );
      expect(connection.ensureOutboundSendRecovery).toHaveBeenCalledWith(
        oldSocket
      );

      (connection.getSocket as jest.Mock).mockReturnValue(freshSocket);
      await expect(service.validatePhone('55', '119999')).resolves.toEqual({
        valid: true,
        jid: '55119999@s.whatsapp.net',
        phone: '55119999',
      });
      expect(freshSocket.onWhatsApp).toHaveBeenCalledTimes(1);
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT_MS;
      } else {
        process.env.WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT_MS = previousTimeout;
      }
      jest.useRealTimers();
    }
  });

  it('allows concurrent healthy validations on one socket', async () => {
    let resolveFirst!: (value: Array<{ exists: boolean; jid: string }>) => void;
    let resolveSecond!: (
      value: Array<{ exists: boolean; jid: string }>
    ) => void;
    const onWhatsApp = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          })
      );
    const socket = { onWhatsApp };
    const service = new BaileysPhoneValidationService({
      getSocket: jest.fn(() => socket),
    } as never);

    const first = service.validatePhone('55', '119999');
    const second = service.validatePhone('55', '119999');
    expect(onWhatsApp).toHaveBeenCalledTimes(2);

    resolveSecond([{ exists: true, jid: '55119999@s.whatsapp.net' }]);
    resolveFirst([{ exists: true, jid: '55119999@s.whatsapp.net' }]);

    await expect(Promise.all([first, second])).resolves.toEqual([
      {
        valid: true,
        jid: '55119999@s.whatsapp.net',
        phone: '55119999',
      },
      {
        valid: true,
        jid: '55119999@s.whatsapp.net',
        phone: '55119999',
      },
    ]);
  });
});
