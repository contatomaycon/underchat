import 'reflect-metadata';

jest.mock('@wwebjs/whatsapp-web.js', () => ({
  __esModule: true,
  default: {
    Client: class {},
    LocalAuth: class {},
  },
}));

jest.mock('@core/config/environments', () => ({
  wwebjsEnvironment: {
    wwebjsAccountId: 'account-w',
    wwebjsWorkerId: 'worker-w',
  },
}));

jest.mock('@core/common/functions/centrifugoQueue', () => ({
  workerCentrifugoQueue: (accountId: string) => `worker-${accountId}`,
  chatAccountCentrifugo: (accountId: string) => `chat-${accountId}`,
}));

jest.mock('@core/common/functions/normalizeJid', () => ({
  normalizeJid: (jid?: string | null) => jid ?? undefined,
}));

jest.mock('@core/services/centrifugo.service', () => ({
  CentrifugoService: class {},
}));

jest.mock('@core/services/elasticDatabase.service', () => ({
  ElasticDatabaseService: class {},
}));

jest.mock('@core/services/balanceWorkerStatusGrpcClient.service', () => ({
  BalanceWorkerStatusGrpcClientService: class {},
}));

jest.mock('@core/services/wwebjs/methods/incoming.service', () => ({
  WwebjsIncomingMessageService: class {},
}));

jest.mock('@core/services/wwebjs/methods/healthCheck.service', () => ({
  WwebjsHealthCheckService: class {},
}));

import { EBaileysConnectionStatus as Status } from '@core/common/enums/EBaileysConnectionStatus';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { WwebjsConnectionService } from '@core/services/wwebjs/methods/connection.service';

type WwebjsConnectionServicePrivate = {
  client: unknown;
  status: Status;
  connecting: boolean;
  currentPromise?: Promise<IBaileysConnectionState>;
  connectionEstablished: boolean;
  markConnected: (...args: unknown[]) => void;
  startConnectionStateProbe: (...args: unknown[]) => void;
  handleHealthCheckMismatch: (detectedStatus: Status) => void;
  cancelAttempt: (skipDestroy?: boolean) => void;
  waitForPendingTeardown: () => Promise<void>;
  startConnection: (
    fromDisconnectRestart?: boolean
  ) => Promise<IBaileysConnectionState>;
};

describe('WwebjsConnectionService', () => {
  const makeService = () => {
    const centrifugo = {
      publishSub: jest.fn(async () => undefined),
    };
    const elasticDatabaseService = {
      indices: jest.fn(async () => true),
      updateWithOCC: jest.fn(async () => 'updated'),
    };
    const balanceWorkerStatusGrpcClientService = {
      notifyWorkerStatus: jest.fn(async () => undefined),
    };
    const incomingMessageService = {
      bindTo: jest.fn(),
      markConnectionReady: jest.fn(),
      unbind: jest.fn(),
    };
    const healthCheckService = {
      configure: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
      notifyDisconnected: jest.fn(async () => undefined),
    };

    const service = new WwebjsConnectionService(
      centrifugo as never,
      elasticDatabaseService as never,
      balanceWorkerStatusGrpcClientService as never,
      incomingMessageService as never,
      healthCheckService as never
    );

    const servicePrivate = service as unknown as WwebjsConnectionServicePrivate;

    return {
      service,
      servicePrivate,
      incomingMessageService,
      healthCheckService,
    };
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('waits for native ready before using the state probe fallback', async () => {
    const { servicePrivate } = makeService();
    const client = {
      info: {
        wid: {
          _serialized: '5511999999999@c.us',
        },
      },
      getState: jest.fn(async () => 'CONNECTED'),
      pupPage: {
        evaluate: jest.fn(async () => true),
      },
      attachEventListeners: jest.fn(async () => undefined),
    };

    const markConnectedSpy = jest
      .spyOn(servicePrivate, 'markConnected')
      .mockImplementation(() => undefined);

    servicePrivate.client = client;
    servicePrivate.status = Status.connecting;
    servicePrivate.connectionEstablished = false;

    servicePrivate.startConnectionStateProbe(client, 1, null);

    await jest.advanceTimersByTimeAsync(25_000);

    expect(client.attachEventListeners).not.toHaveBeenCalled();
    expect(markConnectedSpy).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(5_000);

    expect(client.attachEventListeners).toHaveBeenCalledTimes(1);
    expect(markConnectedSpy).toHaveBeenCalledWith(
      client,
      1,
      null,
      'state_probe'
    );
  });

  it('cancels an active connecting attempt when a user forces a new QR request', async () => {
    const { service, servicePrivate } = makeService();
    const state: IBaileysConnectionState = {
      status: Status.connecting,
      code: ECodeMessage.awaitingReadQrCode,
      worker_id: 'worker-w',
      account_id: 'account-w',
    };

    servicePrivate.connecting = true;
    servicePrivate.currentPromise = Promise.resolve(state);
    servicePrivate.status = Status.connecting;

    const cancelAttemptSpy = jest
      .spyOn(servicePrivate, 'cancelAttempt')
      .mockImplementation(() => {
        servicePrivate.connecting = false;
        servicePrivate.currentPromise = undefined;
      });
    const startConnectionSpy = jest
      .spyOn(servicePrivate, 'startConnection')
      .mockResolvedValue(state);

    await service.connect({
      initial_connection: true,
      force_new: true,
      requested_by_user: true,
      type: EBaileysConnectionType.qrcode,
    });

    expect(cancelAttemptSpy).toHaveBeenCalled();
    expect(startConnectionSpy).toHaveBeenCalled();
  });

  it('bypasses session restore for a user QR request with an existing stale session', async () => {
    const { service, servicePrivate } = makeService();
    const state: IBaileysConnectionState = {
      status: Status.connecting,
      code: ECodeMessage.awaitingReadQrCode,
      worker_id: 'worker-w',
      account_id: 'account-w',
    };

    servicePrivate.status = Status.disconnected;
    jest.spyOn(service, 'hasSession').mockReturnValue(true);
    const startConnectionSpy = jest
      .spyOn(servicePrivate, 'startConnection')
      .mockResolvedValue(state);

    await service.connect({
      initial_connection: true,
      allow_restore: true,
      requested_by_user: true,
      type: EBaileysConnectionType.qrcode,
    });

    expect(startConnectionSpy).toHaveBeenCalled();
  });

  it('tears down the active client before reconnecting after a health-check disconnect', () => {
    const { servicePrivate, healthCheckService } = makeService();

    servicePrivate.client = {};
    servicePrivate.status = Status.connected;
    servicePrivate.connectionEstablished = true;

    const cancelAttemptSpy = jest
      .spyOn(servicePrivate, 'cancelAttempt')
      .mockImplementation(() => {
        servicePrivate.connectionEstablished = false;
      });

    servicePrivate.handleHealthCheckMismatch(Status.disconnected);

    expect(cancelAttemptSpy).toHaveBeenCalledWith(false);
    expect(healthCheckService.stop).toHaveBeenCalled();
    expect(servicePrivate.connectionEstablished).toBe(false);
  });

  it('destroys the captured client when cancel teardown runs asynchronously', async () => {
    const { servicePrivate } = makeService();

    const oldClient = {
      destroy: jest.fn(async () => undefined),
    };
    const newClient = {
      destroy: jest.fn(async () => undefined),
    };

    servicePrivate.client = oldClient;

    servicePrivate.cancelAttempt(false);
    servicePrivate.client = newClient;

    await servicePrivate.waitForPendingTeardown();

    expect(oldClient.destroy).toHaveBeenCalledTimes(1);
    expect(newClient.destroy).not.toHaveBeenCalled();
    expect(servicePrivate.client).toBe(newClient);
  });
});
