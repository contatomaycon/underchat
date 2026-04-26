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

jest.mock('@core/plugins/telemetry/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
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
import { WwebjsConnectionService } from '@core/services/wwebjs/methods/connection.service';

type WwebjsConnectionServicePrivate = {
  client: unknown;
  status: Status;
  connectionEstablished: boolean;
  logConnectionEvent: (...args: unknown[]) => void;
  markConnected: (...args: unknown[]) => void;
  startConnectionStateProbe: (...args: unknown[]) => void;
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

    jest
      .spyOn(servicePrivate, 'logConnectionEvent')
      .mockImplementation(() => undefined);

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
});
