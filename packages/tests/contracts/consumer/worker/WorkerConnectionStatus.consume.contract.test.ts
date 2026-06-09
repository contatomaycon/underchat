import 'reflect-metadata';

jest.mock('@core/config/environments', () => ({
  baileysEnvironment: {
    baileysAccountId: 'account-b',
    baileysWorkerId: 'worker-b',
  },
  wwebjsEnvironment: {
    wwebjsAccountId: 'account-w',
    wwebjsWorkerId: 'worker-w',
  },
}));

jest.mock('@core/common/functions/centrifugoQueue', () => ({
  workerCentrifugoQueue: (accountId: string) => `worker-${accountId}`,
}));

jest.mock('@core/plugins/telemetry/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('@core/services/baileys', () => ({
  BaileysService: class {},
}));

jest.mock('@core/services/wwebjs', () => ({
  WwebjsService: class {},
}));

jest.mock('@core/services/balanceWorkerStatusGrpcClient.service', () => ({
  BalanceWorkerStatusGrpcClientService: class {},
}));

jest.mock('@core/services/centrifugo.service', () => ({
  CentrifugoService: class {},
}));

import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { WorkerConnectionStatusConsume } from '@core/consumer/worker/WorkerConnectionStatus.consume';
import { WorkerConnectionStatusWwebjsConsume } from '@core/consumer/worker/WorkerConnectionStatusWwebjs.consume';

const flushPromises = async (): Promise<void> => {
  await new Promise((resolve) => setImmediate(resolve));
};

describe('Worker connection status consumers', () => {
  const payload = {
    worker_id: 'worker',
    status: EWorkerStatus.online,
    type: EBaileysConnectionType.qrcode,
  };

  it('restarts a stale Baileys connecting socket immediately for user requests', async () => {
    const baileysService = {
      isConnected: jest.fn(() => false),
      hasSession: jest.fn(() => false),
      getStatus: jest.fn(() => EBaileysConnectionStatus.connecting),
      getCode: jest.fn(() => ECodeMessage.awaitConnection),
      socket: {},
      connect: jest.fn(async () => ({
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitingReadQrCode,
        worker_id: 'worker-b',
        account_id: 'account-b',
      })),
      republishLastState: jest.fn(),
    };
    const sut = new WorkerConnectionStatusConsume(
      baileysService as never,
      { notifyWorkerStatus: jest.fn() } as never,
      { publishSub: jest.fn() } as never
    );

    sut.requestConnection(payload);
    await flushPromises();

    expect(baileysService.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        force_new: true,
        initial_connection: true,
        requested_by_user: true,
      })
    );
  });

  it('lets a user request override an active Baileys retry when startup is stale', async () => {
    const baileysService = {
      isConnected: jest.fn(() => false),
      hasSession: jest.fn(() => false),
      getStatus: jest.fn(() => EBaileysConnectionStatus.connecting),
      getCode: jest.fn(() => ECodeMessage.awaitConnection),
      socket: {},
      connect: jest.fn(async () => ({
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitingReadQrCode,
        worker_id: 'worker-b',
        account_id: 'account-b',
      })),
      republishLastState: jest.fn(),
    };
    const sut = new WorkerConnectionStatusConsume(
      baileysService as never,
      { notifyWorkerStatus: jest.fn() } as never,
      { publishSub: jest.fn() } as never
    ) as never as {
      activeConnectionRequest: typeof payload;
      requestConnection: (input: typeof payload) => void;
    };
    sut.activeConnectionRequest = payload;

    sut.requestConnection(payload);
    await flushPromises();

    expect(baileysService.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        force_new: true,
        requested_by_user: true,
      })
    );
  });

  it('restarts a stale WWebJS connecting socket immediately for user requests', async () => {
    const wwebjsService = {
      isConnected: jest.fn(() => false),
      hasSession: jest.fn(() => false),
      getStatus: jest.fn(() => EBaileysConnectionStatus.connecting),
      getCode: jest.fn(() => ECodeMessage.awaitConnection),
      socket: {},
      connect: jest.fn(async () => ({
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitingReadQrCode,
        worker_id: 'worker-w',
        account_id: 'account-w',
      })),
      republishLastState: jest.fn(),
    };
    const sut = new WorkerConnectionStatusWwebjsConsume(
      wwebjsService as never,
      { notifyWorkerStatus: jest.fn() } as never,
      { publishSub: jest.fn() } as never
    );

    sut.requestConnection(payload);
    await flushPromises();

    expect(wwebjsService.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        allow_restore: false,
        force_new: true,
        initial_connection: true,
        requested_by_user: true,
      })
    );
  });

  it('clears a stale WWebJS session before generating a queued QR', async () => {
    jest.useFakeTimers();
    const wwebjsService = {
      isConnected: jest.fn(() => false),
      hasSession: jest.fn(() => true),
      getStatus: jest.fn(() => EBaileysConnectionStatus.disconnected),
      getCode: jest.fn(() => ECodeMessage.awaitConnection),
      socket: undefined,
      connect: jest.fn(async () => ({
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitingReadQrCode,
        worker_id: 'worker-w',
        account_id: 'account-w',
      })),
      disconnect: jest.fn(async () => undefined),
      republishLastState: jest.fn(),
    };
    const sut = new WorkerConnectionStatusWwebjsConsume(
      wwebjsService as never,
      { notifyWorkerStatus: jest.fn() } as never,
      { publishSub: jest.fn() } as never
    );

    try {
      const pending = sut.requestConnection({
        ...payload,
        qr_pending: true,
        connection_attempt_id: 'attempt-1',
        connection_lifecycle_id: 'lifecycle-1',
      });

      await jest.advanceTimersByTimeAsync(3000);
      await pending;

      expect(wwebjsService.disconnect).toHaveBeenCalledWith(
        expect.objectContaining({
          preserve_session: false,
          remove_session: true,
        })
      );
      expect(wwebjsService.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          allow_restore: false,
          from_disconnect_restart: true,
          requested_by_user: true,
        })
      );
    } finally {
      jest.useRealTimers();
    }
  });
});
