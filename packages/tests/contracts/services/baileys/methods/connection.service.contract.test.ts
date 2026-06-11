import 'reflect-metadata';

jest.mock('@whiskeysockets/baileys', () => ({
  Browsers: {
    macOS: jest.fn(() => ['Underchat', 'Desktop', '1.0.0']),
  },
  DEFAULT_CONNECTION_CONFIG: {
    version: [2, 3000, 1035194821],
  },
  fetchLatestBaileysVersion: jest.fn(async () => ({
    version: [2, 3000, 0],
  })),
  fetchLatestWaWebVersion: jest.fn(async () => ({
    version: [2, 3000, 0],
  })),
  makeWASocket: jest.fn(),
  useMultiFileAuthState: jest.fn(async () => ({
    state: {},
    saveCreds: jest.fn(async () => undefined),
  })),
}));

jest.mock('@core/config/environments', () => ({
  baileysEnvironment: {
    baileysAccountId: 'account-b',
    baileysWorkerId: 'worker-b',
  },
}));

jest.mock('@core/common/functions/centrifugoQueue', () => ({
  workerCentrifugoQueue: (accountId: string) => `worker-${accountId}`,
}));

jest.mock('@core/services/balanceWorkerStatusGrpcClient.service', () => ({
  BalanceWorkerStatusGrpcClientService: class {},
}));

jest.mock('@core/services/centrifugo.service', () => ({
  CentrifugoService: class {},
}));

jest.mock('@core/services/elasticDatabase.service', () => ({
  ElasticDatabaseService: class {},
}));

jest.mock('@core/services/baileys/methods/incoming.service', () => ({
  BaileysIncomingMessageService: class {},
}));

jest.mock('@core/services/baileys/methods/healthCheck.service', () => ({
  BaileysHealthCheckService: class {},
}));

import { EBaileysConnectionStatus as Status } from '@core/common/enums/EBaileysConnectionStatus';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { BaileysConnectionService } from '@core/services/baileys/methods/connection.service';
import {
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
  makeWASocket,
} from '@whiskeysockets/baileys';

type BaileysConnectionServicePrivate = {
  connecting: boolean;
  currentPromise?: Promise<IBaileysConnectionState>;
  status: Status;
  cancelAttempt: (skipWebSocketClose?: boolean) => void;
  createSocket: () => Promise<{ socket: unknown; saveCreds: () => void }>;
  wait: (socket: unknown, id: number) => Promise<IBaileysConnectionState>;
  prepareFolder: () => void;
};

describe('BaileysConnectionService', () => {
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
      getCachedMessage: jest.fn(),
    };
    const healthCheckService = {
      configure: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
      notifyDisconnected: jest.fn(async () => undefined),
    };

    const service = new BaileysConnectionService(
      centrifugo as never,
      elasticDatabaseService as never,
      balanceWorkerStatusGrpcClientService as never,
      incomingMessageService as never,
      healthCheckService as never
    );

    const servicePrivate =
      service as unknown as BaileysConnectionServicePrivate;

    return {
      service,
      servicePrivate,
    };
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('cancels an active connecting attempt when a user forces a new QR request', async () => {
    const { service, servicePrivate } = makeService();
    const state: IBaileysConnectionState = {
      status: Status.connecting,
      code: ECodeMessage.awaitingReadQrCode,
      worker_id: 'worker-b',
      account_id: 'account-b',
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
    const createSocketSpy = jest
      .spyOn(servicePrivate, 'createSocket')
      .mockResolvedValue({ socket: {}, saveCreds: jest.fn() });
    jest.spyOn(servicePrivate, 'prepareFolder').mockImplementation(() => {});
    jest.spyOn(servicePrivate, 'wait').mockResolvedValue(state);

    await service.connect({
      initial_connection: true,
      force_new: true,
      requested_by_user: true,
      type: EBaileysConnectionType.qrcode,
    });

    expect(cancelAttemptSpy).toHaveBeenCalled();
    expect(createSocketSpy).toHaveBeenCalled();
  });

  it('uses the bundled Baileys version when remote version resolution fails', async () => {
    const { servicePrivate } = makeService();
    const socket = { ev: { on: jest.fn() } };

    (fetchLatestWaWebVersion as jest.Mock).mockResolvedValueOnce({
      version: [2, 3000, 0],
      isLatest: false,
      error: new Error('wa web unavailable'),
    });
    (fetchLatestBaileysVersion as jest.Mock).mockResolvedValueOnce({
      version: [2, 3000, 0],
      isLatest: false,
      error: new Error('github unavailable'),
    });
    (makeWASocket as jest.Mock).mockReturnValueOnce(socket);

    await servicePrivate.createSocket();

    expect(makeWASocket).toHaveBeenCalledWith(
      expect.objectContaining({
        version: [2, 3000, 1035194821],
      })
    );
  });
});
