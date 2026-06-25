import 'reflect-metadata';

jest.mock('@core/config/environments', () => ({
  baileysEnvironment: {
    baileysAccountId: 'account-1',
    baileysWorkerId: 'worker-1',
  },
}));

jest.mock('@core/common/functions/centrifugoQueue', () => ({
  workerCentrifugoQueue: (accountId: string) => `channel-${accountId}`,
}));

const mockGetPhoneNumber = jest.fn((jid?: string) =>
  jid ? jid.split('@')[0] : undefined
);
const mockBuildWppConnectionDocumentId = jest.fn(
  (accountId: string, workerId: string) => `${accountId}:${workerId}`
);
const mockWppConnectionMappings = jest.fn(() => ({ mappings: true }));

jest.mock('@core/common/functions/getPhoneNumber', () => ({
  getPhoneNumber: (jid?: string) => mockGetPhoneNumber(jid),
}));

jest.mock('@core/common/functions/buildWppConnectionDocumentId', () => ({
  buildWppConnectionDocumentId: (accountId: string, workerId: string) =>
    mockBuildWppConnectionDocumentId(accountId, workerId),
}));

jest.mock('@core/mappings/wppConnection.mappings', () => ({
  wppConnectionMappings: () => mockWppConnectionMappings(),
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

import { EBaileysConnectionStatus as Status } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { BaileysHealthCheckService } from '@core/services/baileys/methods/healthCheck.service';

describe('BaileysHealthCheckService', () => {
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

    const service = new BaileysHealthCheckService(
      centrifugo as never,
      elasticDatabaseService as never,
      balanceWorkerStatusGrpcClientService as never
    );

    return {
      service,
      centrifugo,
      elasticDatabaseService,
      balanceWorkerStatusGrpcClientService,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();

    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('starts/stops health-check interval and handles unconfigured run', async () => {
    const { service } = makeService();

    await expect(service.runHealthCheck()).resolves.toMatchObject({
      isHealthy: false,
      reason: 'Health check not configured',
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.offline,
      session_ready: false,
    });

    jest.useFakeTimers();

    const runSpy = jest.spyOn(service, 'runHealthCheck').mockResolvedValue({
      isHealthy: true,
      detectedStatus: Status.connected,
      workerStatus: EWorkerStatus.online,
    } as never);

    service.start(25);
    service.start(25);

    jest.advanceTimersByTime(60);

    expect(runSpy).toHaveBeenCalledTimes(2);

    service.stop();
    service.stop();

    expect((service as any).isRunning).toBe(false);
  });

  it('notifies disconnected once per status transition and can reset status tracking', async () => {
    const { service } = makeService();

    const notifyStatusChangeSpy = jest
      .spyOn(service as any, 'notifyStatusChange')
      .mockResolvedValue(undefined);

    await service.notifyDisconnected('network down');
    await service.notifyDisconnected('network down');

    expect(notifyStatusChangeSpy).toHaveBeenCalledTimes(1);

    service.resetLastKnownStatus();

    expect((service as any).lastKnownStatus).toBe(Status.initial);
    expect((service as any).lastKnownWorkerStatus).toBe(
      EWorkerStatus.disponible
    );
  });

  it('runHealthCheck skips notify when status and worker are unchanged', async () => {
    const { service } = makeService();

    service.configure({
      getSocket: () =>
        ({
          ws: { isOpen: true },
          user: { id: '5511999999999@s.whatsapp.net' },
          fetchPrivacySettings: jest.fn(async () => ({})),
          onWhatsApp: jest.fn(async () => [{ exists: true }]),
        }) as never,
      getStatus: () => Status.connected,
      getCode: () => ECodeMessage.awaitConnection,
      reconnect: jest.fn(),
      isConnected: () => true,
      hasSession: () => true,
      isIncomingBound: () => true,
    });

    (service as any).lastKnownStatus = Status.connected;
    (service as any).lastKnownWorkerStatus = EWorkerStatus.online;

    const notifyStatusChangeSpy = jest
      .spyOn(service as any, 'notifyStatusChange')
      .mockResolvedValue(undefined);

    await expect(service.runHealthCheck()).resolves.toMatchObject({
      isHealthy: true,
      reason: 'Session ready (WebSocket client state: OPEN)',
      detectedStatus: Status.connected,
      workerStatus: EWorkerStatus.online,
      session_ready: true,
      can_send: true,
      can_receive_runtime: true,
      authenticated: true,
    });

    expect(notifyStatusChangeSpy).not.toHaveBeenCalled();
  });

  it('runs health-check with status change and mismatch callback', async () => {
    const { service, centrifugo, balanceWorkerStatusGrpcClientService } =
      makeService();

    const mismatch = jest.fn();
    const socket = {
      ws: {
        isOpen: true,
      },
      user: {
        id: '5511999999999@s.whatsapp.net',
      },
      fetchPrivacySettings: jest.fn(async () => ({})),
      onWhatsApp: jest.fn(async () => [{ exists: true }]),
    };

    service.configure({
      getSocket: () => socket as never,
      getStatus: () => Status.disconnected,
      getCode: () => ECodeMessage.awaitConnection,
      reconnect: jest.fn(),
      isConnected: () => false,
      hasSession: () => true,
      isIncomingBound: () => true,
      onStatusMismatch: mismatch,
    });

    await expect(service.runHealthCheck()).resolves.toMatchObject({
      isHealthy: true,
      reason: 'Session ready (WebSocket client state: OPEN)',
      detectedStatus: Status.connected,
      workerStatus: EWorkerStatus.online,
      session_ready: true,
    });

    expect(mismatch).toHaveBeenCalledWith(
      Status.connected,
      EWorkerStatus.online
    );
    expect(centrifugo.publishSub).toHaveBeenCalledWith(
      'channel-account-1',
      expect.objectContaining({
        status: Status.connected,
        worker_status_id: EWorkerStatus.online,
        phone: '5511999999999',
        code: ECodeMessage.connectionEstablished,
        session_ready: true,
      })
    );
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).toHaveBeenCalled();
  });

  it('keeps reported connected socket in connecting state on transient closed websocket', async () => {
    const { service } = makeService();
    const mismatch = jest.fn();

    service.configure({
      getSocket: () =>
        ({
          ws: { isClosed: true },
        }) as never,
      getStatus: () => Status.connected,
      getCode: () => ECodeMessage.connectionEstablished,
      reconnect: jest.fn(),
      isConnected: () => true,
      hasSession: () => true,
      isIncomingBound: () => true,
      onStatusMismatch: mismatch,
    });

    (service as any).lastKnownStatus = Status.connected;
    (service as any).lastKnownWorkerStatus = EWorkerStatus.online;

    await expect(service.runHealthCheck()).resolves.toMatchObject({
      isHealthy: true,
      reason: 'Transient disconnect tolerated (WebSocket client state: CLOSED)',
      detectedStatus: Status.connecting,
      workerStatus: EWorkerStatus.disponible,
      session_ready: false,
    });
    expect(mismatch).toHaveBeenCalledWith(
      Status.connecting,
      EWorkerStatus.disponible
    );
  });

  it('bootstrapConnection handles all bootstrap branches and promise lock', async () => {
    const { service, balanceWorkerStatusGrpcClientService } = makeService();

    await expect(service.bootstrapConnection()).resolves.toBeUndefined();

    const reconnectAction = jest.fn();

    service.configure({
      getSocket: () => undefined,
      getStatus: () => Status.initial,
      getCode: () => ECodeMessage.awaitConnection,
      reconnect: reconnectAction,
      isConnected: () => false,
      hasSession: () => false,
    });

    await expect(service.bootstrapConnection()).resolves.toBeUndefined();
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        status: Status.info,
        code: ECodeMessage.info,
        worker_status_id: EWorkerStatus.disponible,
      })
    );

    service.configure({
      getSocket: () => undefined,
      getStatus: () => Status.connecting,
      getCode: () => ECodeMessage.awaitingReadQrCode,
      reconnect: reconnectAction,
      isConnected: () => false,
      hasSession: () => true,
    });

    await expect(service.bootstrapConnection()).resolves.toBeUndefined();
    expect(reconnectAction).not.toHaveBeenCalled();

    service.configure({
      getSocket: () => undefined,
      getStatus: () => Status.disconnected,
      getCode: () => ECodeMessage.awaitConnection,
      reconnect: reconnectAction,
      isConnected: () => false,
      hasSession: () => true,
    });

    await expect(service.bootstrapConnection()).resolves.toBeUndefined();
    expect(reconnectAction).toHaveBeenCalledWith({
      initial_connection: true,
      requested_by_user: false,
      from_disconnect_restart: true,
    });

    service.configure({
      getSocket: () => undefined,
      getStatus: () => Status.disconnected,
      getCode: () => ECodeMessage.awaitConnection,
      reconnect: () => {
        throw new Error('reconnect failed');
      },
      isConnected: () => false,
      hasSession: () => true,
    });

    await expect(service.bootstrapConnection()).resolves.toBeUndefined();

    service.configure({
      getSocket: () => undefined,
      getStatus: () => Status.disconnected,
      getCode: () => ECodeMessage.awaitConnection,
      reconnect: reconnectAction,
      isConnected: () => true,
      hasSession: () => true,
    });

    await expect(service.bootstrapConnection()).resolves.toBeUndefined();

    (service as any).bootstrapLock = true;
    (service as any).bootstrapPromise = Promise.resolve();
    const lockedPromise = (service as any).bootstrapPromise;
    expect(service.bootstrapConnection()).toBe(lockedPromise);

    (service as any).bootstrapLock = false;
    (service as any).bootstrapPromise = Promise.resolve();
    const existingPromise = (service as any).bootstrapPromise;
    expect(service.bootstrapConnection()).toBe(existingPromise);

    (service as any).bootstrapLock = false;
    (service as any).bootstrapPromise = undefined;

    const bootstrapSpy = jest
      .spyOn(service as any, 'runBootstrapConnection')
      .mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, 10);
          })
      );

    jest.useFakeTimers();
    const first = service.bootstrapConnection();
    const second = service.bootstrapConnection();
    expect(first).toBe(second);
    jest.advanceTimersByTime(15);
    await expect(first).resolves.toBeUndefined();
    expect(bootstrapSpy).toHaveBeenCalledTimes(1);
  });

  it('maps socket states in connectivity checks and websocket resolvers', async () => {
    const { service } = makeService();
    const sut = service as any;

    await expect(
      sut.checkConnectivity(undefined, Status.disconnected)
    ).resolves.toMatchObject({
      isHealthy: false,
      reason: 'No socket instance',
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.offline,
      session_ready: false,
    });

    await expect(
      sut.checkConnectivity(
        {
          ws: { isOpen: true },
        },
        Status.connecting
      )
    ).resolves.toMatchObject({
      isHealthy: true,
      reason: 'Verifying session (WebSocket client state: OPEN)',
      detectedStatus: Status.connecting,
      workerStatus: EWorkerStatus.disponible,
      session_ready: false,
      degraded_reason: 'missing_sock_user',
    });

    await expect(
      sut.checkConnectivity(
        {
          ws: { isOpen: true },
        },
        Status.disconnected
      )
    ).resolves.toMatchObject({
      isHealthy: true,
      reason: 'Verifying session (WebSocket client state: OPEN)',
      detectedStatus: Status.connecting,
      workerStatus: EWorkerStatus.disponible,
      session_ready: false,
    });

    await expect(
      sut.checkConnectivity(
        {
          ws: { isConnecting: true },
        },
        Status.disconnected
      )
    ).resolves.toMatchObject({
      isHealthy: true,
      reason: 'Connecting (WebSocket client state: CONNECTING)',
      detectedStatus: Status.connecting,
      workerStatus: EWorkerStatus.disponible,
      session_ready: false,
    });

    await expect(
      sut.checkConnectivity(
        {
          ws: { isClosed: true },
        },
        Status.connecting
      )
    ).resolves.toMatchObject({
      isHealthy: true,
      reason: 'Connecting (reported by service)',
      detectedStatus: Status.connecting,
      workerStatus: EWorkerStatus.disponible,
      session_ready: false,
    });

    await expect(
      sut.checkConnectivity({}, Status.connected)
    ).resolves.toMatchObject({
      isHealthy: false,
      reason: 'WebSocket state unavailable',
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.offline,
      session_ready: false,
    });

    await expect(
      sut.checkConnectivity(
        {
          ws: { isClosing: true },
        },
        Status.disconnected
      )
    ).resolves.toMatchObject({
      isHealthy: false,
      reason: 'WebSocket client state: CLOSING',
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.offline,
      session_ready: false,
    });

    expect(sut.mapReadyState(0, 'label')).toEqual({
      state: 'connecting',
      reason: 'label: CONNECTING',
    });
    expect(sut.mapReadyState(1, 'label')).toEqual({
      state: 'open',
      reason: 'label: OPEN',
    });
    expect(sut.mapReadyState(2, 'label')).toEqual({
      state: 'closing',
      reason: 'label: CLOSING',
    });
    expect(sut.mapReadyState(3, 'label')).toEqual({
      state: 'closed',
      reason: 'label: CLOSED',
    });
    expect(sut.mapReadyState(9, 'label')).toEqual({
      state: 'unknown',
      reason: 'label: 9',
    });

    expect(
      sut.resolveWebSocket({
        ws: {
          socket: { readyState: 1 },
        },
      })
    ).toEqual({ readyState: 1 });

    expect(
      sut.resolveWebSocket({
        socket: {
          socket: { readyState: 2 },
        },
      })
    ).toEqual({ readyState: 2 });

    expect(
      sut.resolveWebSocket({
        ws: {
          isOpen: false,
        },
      })
    ).toEqual({ isOpen: false });

    expect(
      sut.resolveWebSocket({
        socket: {
          readyState: 3,
        },
      })
    ).toEqual({ readyState: 3 });

    expect(sut.resolveWebSocket(null)).toBeUndefined();

    expect(
      sut.inspectSocketState({
        ws: {
          socket: { readyState: 2 },
        },
      })
    ).toEqual({
      state: 'closing',
      reason: 'WebSocket raw state: CLOSING',
    });

    expect(
      sut.inspectSocketState({
        socket: {
          readyState: 1,
        },
      })
    ).toEqual({
      state: 'open',
      reason: 'WebSocket state: OPEN',
    });

    expect(sut.resolveWebSocket({})).toBeUndefined();
  });

  it('notifies status change and persists elastic log across success/error branches', async () => {
    const {
      service,
      centrifugo,
      elasticDatabaseService,
      balanceWorkerStatusGrpcClientService,
    } = makeService();

    const socket = {
      user: {
        id: '5511888888888@s.whatsapp.net',
      },
    };

    await expect(
      (service as any).notifyStatusChange(socket, {
        detectedStatus: Status.connected,
        workerStatus: EWorkerStatus.online,
        isHealthy: true,
        reason: 'ok',
      })
    ).resolves.toBeUndefined();

    expect(centrifugo.publishSub).toHaveBeenCalled();
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).toHaveBeenCalled();
    expect(elasticDatabaseService.indices).toHaveBeenCalledWith(
      EElasticIndex.wpp_connection,
      { mappings: true }
    );
    expect(mockBuildWppConnectionDocumentId).toHaveBeenCalledWith(
      'account-1',
      'worker-1'
    );

    centrifugo.publishSub.mockRejectedValueOnce(new Error('centrifugo down'));
    balanceWorkerStatusGrpcClientService.notifyWorkerStatus.mockRejectedValueOnce(
      new Error('grpc down')
    );

    await expect(
      (service as any).notifyStatusChange(undefined, {
        detectedStatus: Status.disconnected,
        workerStatus: EWorkerStatus.offline,
        isHealthy: false,
        reason: 'down',
      })
    ).resolves.toBeUndefined();

    balanceWorkerStatusGrpcClientService.notifyWorkerStatus.mockRejectedValueOnce(
      new Error('bootstrap notify down')
    );
    await expect(
      (service as any).notifyDisponibleStatus('manual bootstrap status')
    ).resolves.toBeUndefined();

    elasticDatabaseService.indices.mockResolvedValueOnce(false);
    await expect(
      (service as any).saveLogWppConnection({ worker_id: 'w' })
    ).resolves.toBe(false);

    elasticDatabaseService.indices.mockResolvedValue(true);
    elasticDatabaseService.updateWithOCC.mockResolvedValueOnce('created');
    await expect(
      (service as any).saveLogWppConnection({ worker_id: 'w' })
    ).resolves.toBe(true);

    elasticDatabaseService.updateWithOCC.mockResolvedValueOnce('noop');
    await expect(
      (service as any).saveLogWppConnection({ worker_id: 'w' })
    ).resolves.toBe(true);

    elasticDatabaseService.updateWithOCC.mockResolvedValueOnce('ignored');
    await expect(
      (service as any).saveLogWppConnection({ worker_id: 'w' })
    ).resolves.toBe(false);
  });
});
