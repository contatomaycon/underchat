import 'reflect-metadata';

jest.mock('@core/config/environments', () => ({
  wwebjsEnvironment: {
    wwebjsAccountId: 'account-w',
    wwebjsWorkerId: 'worker-w',
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
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { WwebjsHealthCheckService } from '@core/services/wwebjs/methods/healthCheck.service';

describe('WwebjsHealthCheckService', () => {
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

    const service = new WwebjsHealthCheckService(
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

  it('starts/stops and handles unconfigured run', async () => {
    const { service } = makeService();

    await expect(service.runHealthCheck()).resolves.toEqual({
      isHealthy: false,
      reason: 'Health check not configured',
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.offline,
    });

    jest.useFakeTimers();

    const runSpy = jest.spyOn(service, 'runHealthCheck').mockResolvedValue({
      isHealthy: true,
      detectedStatus: Status.connected,
      workerStatus: EWorkerStatus.online,
    } as never);

    service.start(20);
    service.start(20);
    jest.advanceTimersByTime(45);

    expect(runSpy).toHaveBeenCalledTimes(2);

    service.stop();
    service.stop();
    expect((service as any).isRunning).toBe(false);
  });

  it('tracks disconnected transitions and reset', async () => {
    const { service } = makeService();

    const notifyStatusChangeSpy = jest
      .spyOn(service as any, 'notifyStatusChange')
      .mockResolvedValue(undefined);

    await service.notifyDisconnected('down');
    await service.notifyDisconnected('down');

    expect(notifyStatusChangeSpy).toHaveBeenCalledTimes(1);

    service.resetLastKnownStatus();
    expect((service as any).lastKnownStatus).toBe(Status.initial);
    expect((service as any).lastKnownWorkerStatus).toBe(
      EWorkerStatus.disponible
    );
  });

  it('runs health-check, publishes status change and mismatch callback', async () => {
    const { service, centrifugo, balanceWorkerStatusGrpcClientService } =
      makeService();

    const mismatch = jest.fn();
    const client = {
      info: {
        wid: {
          _serialized: '5511777777777@c.us',
        },
      },
      getState: jest.fn(async () => 'CONNECTED'),
    };

    service.configure({
      getClient: () => client as never,
      getStatus: () => Status.disconnected,
      getCode: () => ECodeMessage.awaitConnection,
      reconnect: jest.fn(),
      isConnected: () => false,
      hasSession: () => true,
      onStatusMismatch: mismatch,
    });

    await expect(service.runHealthCheck()).resolves.toEqual({
      isHealthy: true,
      reason: 'Connected',
      detectedStatus: Status.connected,
      workerStatus: EWorkerStatus.online,
      waState: 'CONNECTED',
    });

    expect(mismatch).toHaveBeenCalledWith(
      Status.connected,
      EWorkerStatus.online
    );
    expect(centrifugo.publishSub).toHaveBeenCalledWith(
      'channel-account-w',
      expect.objectContaining({
        status: Status.connected,
        worker_status_id: EWorkerStatus.online,
        code: ECodeMessage.connectionEstablished,
        phone: '5511777777777',
      })
    );
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).toHaveBeenCalled();

    (service as any).lastKnownStatus = Status.connected;
    (service as any).lastKnownWorkerStatus = EWorkerStatus.online;
    const notifyStatusChangeSpy = jest
      .spyOn(service as any, 'notifyStatusChange')
      .mockResolvedValue(undefined);

    await service.runHealthCheck();
    expect(notifyStatusChangeSpy).not.toHaveBeenCalled();
  });

  it('does not disconnect on the first transient state check failure while reported connected', async () => {
    const { service } = makeService();

    const mismatch = jest.fn();
    const client = {
      info: {
        wid: {
          _serialized: '5511777777777@c.us',
        },
      },
      getState: jest.fn(async () => {
        throw new Error("Cannot read properties of null (reading 'evaluate')");
      }),
    };

    service.configure({
      getClient: () => client as never,
      getStatus: () => Status.connected,
      getCode: () => ECodeMessage.connectionEstablished,
      reconnect: jest.fn(),
      isConnected: () => true,
      hasSession: () => true,
      onStatusMismatch: mismatch,
    });

    (service as any).lastKnownStatus = Status.connected;
    (service as any).lastKnownWorkerStatus = EWorkerStatus.online;

    await expect(service.runHealthCheck()).resolves.toEqual({
      isHealthy: true,
      reason:
        "Transient health check failure ignored (1/2): Failed to get state: Cannot read properties of null (reading 'evaluate')",
      detectedStatus: Status.connected,
      workerStatus: EWorkerStatus.online,
    });
    expect(mismatch).not.toHaveBeenCalled();

    await expect(service.runHealthCheck()).resolves.toEqual({
      isHealthy: false,
      reason:
        "Failed to get state: Cannot read properties of null (reading 'evaluate')",
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.offline,
    });
    expect(mismatch).toHaveBeenCalledWith(
      Status.disconnected,
      EWorkerStatus.offline
    );
  });

  it('covers bootstrap flow, timers, fallback skip/trigger reasons and lock reuse', async () => {
    const { service, balanceWorkerStatusGrpcClientService } = makeService();

    await expect(service.bootstrapConnection()).resolves.toBeUndefined();

    const reconnectAction = jest.fn();

    service.configure({
      getClient: () => undefined,
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
        worker_status_id: EWorkerStatus.disponible,
      })
    );

    service.configure({
      getClient: () => undefined,
      getStatus: () => Status.connecting,
      getCode: () => ECodeMessage.awaitingReadQrCode,
      reconnect: reconnectAction,
      isConnected: () => false,
      hasSession: () => true,
    });
    await expect(service.bootstrapConnection()).resolves.toBeUndefined();
    expect(reconnectAction).not.toHaveBeenCalled();

    jest.useFakeTimers();

    service.configure({
      getClient: () => undefined,
      getStatus: () => Status.disconnected,
      getCode: () => ECodeMessage.awaitConnection,
      reconnect: reconnectAction,
      isConnected: () => false,
      hasSession: () => true,
    });

    await expect(service.bootstrapConnection()).resolves.toBeUndefined();
    jest.advanceTimersByTime(15001);
    expect(reconnectAction).toHaveBeenCalledWith({
      initial_connection: true,
      requested_by_user: false,
      from_disconnect_restart: true,
    });

    const sut = service as any;

    const setFallbackConfig = (config: {
      isConnected: boolean;
      hasSession: boolean;
      status: Status;
      code: ECodeMessage;
      reconnect?: () => void;
    }) => {
      service.configure({
        getClient: () => undefined,
        getStatus: () => config.status,
        getCode: () => config.code,
        reconnect: config.reconnect ?? reconnectAction,
        isConnected: () => config.isConnected,
        hasSession: () => config.hasSession,
      });
    };

    setFallbackConfig({
      isConnected: true,
      hasSession: true,
      status: Status.disconnected,
      code: ECodeMessage.awaitConnection,
    });
    sut.scheduleBootstrapReconnectFallback();
    jest.advanceTimersByTime(15001);

    setFallbackConfig({
      isConnected: false,
      hasSession: false,
      status: Status.disconnected,
      code: ECodeMessage.awaitConnection,
    });
    sut.scheduleBootstrapReconnectFallback();
    jest.advanceTimersByTime(15001);

    setFallbackConfig({
      isConnected: false,
      hasSession: true,
      status: Status.connecting,
      code: ECodeMessage.awaitingPairingCode,
    });
    sut.scheduleBootstrapReconnectFallback();
    jest.advanceTimersByTime(15001);

    setFallbackConfig({
      isConnected: false,
      hasSession: true,
      status: Status.connecting,
      code: ECodeMessage.awaitConnection,
    });
    sut.scheduleBootstrapReconnectFallback();
    jest.advanceTimersByTime(15001);

    setFallbackConfig({
      isConnected: false,
      hasSession: true,
      status: Status.connected,
      code: ECodeMessage.awaitConnection,
    });
    sut.scheduleBootstrapReconnectFallback();
    jest.advanceTimersByTime(15001);

    setFallbackConfig({
      isConnected: false,
      hasSession: true,
      status: Status.disconnected,
      code: ECodeMessage.awaitConnection,
      reconnect: () => {
        throw new Error('fallback reconnect fail');
      },
    });
    sut.scheduleBootstrapReconnectFallback();
    jest.advanceTimersByTime(15001);

    sut.clearBootstrapFallbackTimer();
    expect((service as any).bootstrapFallbackTimer).toBeUndefined();

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

    const first = service.bootstrapConnection();
    const second = service.bootstrapConnection();
    expect(first).toBe(second);
    jest.advanceTimersByTime(11);
    await expect(first).resolves.toBeUndefined();
    expect(bootstrapSpy).toHaveBeenCalledTimes(1);
  });

  it('checks connectivity states and mapping branches', async () => {
    const { service } = makeService();
    const sut = service as any;

    await expect(
      sut.checkConnectivity(undefined, Status.disconnected)
    ).resolves.toEqual({
      isHealthy: false,
      reason: 'No client instance',
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.offline,
    });

    jest
      .spyOn(sut, 'getStateWithTimeout')
      .mockRejectedValueOnce(new Error('state down'))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('CONNECTED')
      .mockResolvedValueOnce('CONNECTED')
      .mockResolvedValueOnce('UNPAIRED');

    await expect(
      sut.checkConnectivity({ info: {} }, Status.disconnected)
    ).resolves.toEqual({
      isHealthy: false,
      reason: 'Failed to get state: state down',
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.offline,
    });

    await expect(
      sut.checkConnectivity({ info: {} }, Status.connecting)
    ).resolves.toEqual({
      isHealthy: true,
      reason: 'Connecting (state not yet available)',
      detectedStatus: Status.connecting,
      workerStatus: EWorkerStatus.disponible,
    });

    await expect(
      sut.checkConnectivity({ info: {} }, Status.disconnected)
    ).resolves.toEqual({
      isHealthy: false,
      reason: 'State not available',
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.offline,
    });

    await expect(
      sut.checkConnectivity({}, Status.disconnected)
    ).resolves.toEqual({
      isHealthy: false,
      reason: 'Connected state but no client info',
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.offline,
      waState: 'CONNECTED',
    });

    await expect(
      sut.checkConnectivity(
        {
          info: {
            wid: { _serialized: '55119999@c.us' },
          },
        },
        Status.disconnected
      )
    ).resolves.toEqual({
      isHealthy: true,
      reason: 'Connected',
      detectedStatus: Status.connected,
      workerStatus: EWorkerStatus.online,
      waState: 'CONNECTED',
    });

    await expect(
      sut.checkConnectivity(
        {
          info: {
            wid: { _serialized: '55119999@c.us' },
          },
        },
        Status.disconnected
      )
    ).resolves.toEqual({
      isHealthy: false,
      reason: 'Not paired: UNPAIRED',
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.disponible,
      waState: 'UNPAIRED',
    });

    expect(sut.mapWAStateToStatus('OPENING')).toEqual({
      isHealthy: true,
      reason: 'State: OPENING',
      detectedStatus: Status.connecting,
      workerStatus: EWorkerStatus.disponible,
    });

    expect(sut.mapWAStateToStatus('PAIRING')).toEqual({
      isHealthy: true,
      reason: 'State: PAIRING',
      detectedStatus: Status.connecting,
      workerStatus: EWorkerStatus.disponible,
    });

    expect(sut.mapWAStateToStatus('UNPAIRED_IDLE')).toEqual({
      isHealthy: false,
      reason: 'Not paired: UNPAIRED_IDLE',
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.disponible,
    });

    expect(sut.mapWAStateToStatus('CONFLICT')).toEqual({
      isHealthy: false,
      reason: 'Session conflict - another device connected',
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.mismatched,
    });

    expect(sut.mapWAStateToStatus('DEPRECATED_VERSION')).toEqual({
      isHealthy: false,
      reason: 'Deprecated WhatsApp Web version',
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.mismatched,
    });

    expect(sut.mapWAStateToStatus('TIMEOUT')).toEqual({
      isHealthy: false,
      reason: 'Connection timeout',
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.offline,
    });

    expect(sut.mapWAStateToStatus('PROXYBLOCK')).toEqual({
      isHealthy: false,
      reason: 'Blocked: PROXYBLOCK',
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.mismatched,
    });

    expect(sut.mapWAStateToStatus('TOS_BLOCK')).toEqual({
      isHealthy: false,
      reason: 'Blocked: TOS_BLOCK',
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.mismatched,
    });

    expect(sut.mapWAStateToStatus('SMB_TOS_BLOCK')).toEqual({
      isHealthy: false,
      reason: 'Blocked: SMB_TOS_BLOCK',
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.mismatched,
    });

    expect(sut.mapWAStateToStatus('UNLAUNCHED')).toEqual({
      isHealthy: false,
      reason: 'Client not launched',
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.offline,
    });

    expect(sut.mapWAStateToStatus('UNKNOWN' as never)).toEqual({
      isHealthy: false,
      reason: 'Unknown state: UNKNOWN',
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.offline,
    });

    expect(sut.isAwaitingUserAction(ECodeMessage.awaitingReadQrCode)).toBe(
      true
    );
    expect(sut.isAwaitingUserAction(ECodeMessage.awaitingPairingCode)).toBe(
      true
    );
    expect(sut.isAwaitingUserAction(ECodeMessage.pairingInProgress)).toBe(true);
    expect(sut.isAwaitingUserAction(ECodeMessage.newLoginAttempt)).toBe(true);
    expect(sut.isAwaitingUserAction(ECodeMessage.awaitConnection)).toBe(false);
  });

  it('handles state timeout helper, status notify flow and elastic persistence branches', async () => {
    const {
      service,
      centrifugo,
      elasticDatabaseService,
      balanceWorkerStatusGrpcClientService,
    } = makeService();

    const sut = service as any;

    jest.useFakeTimers();

    const timeoutClient = {
      getState: jest.fn(() => new Promise(() => undefined)),
    };

    const timeoutPromise = sut.getStateWithTimeout(timeoutClient);
    jest.advanceTimersByTime(10001);
    await expect(timeoutPromise).rejects.toThrow('State check timeout');

    const okClient = {
      getState: jest.fn(async () => 'CONNECTED'),
    };
    await expect(sut.getStateWithTimeout(okClient)).resolves.toBe('CONNECTED');

    const errorClient = {
      getState: jest.fn(async () => {
        throw new Error('getState failed');
      }),
    };
    await expect(sut.getStateWithTimeout(errorClient)).rejects.toThrow(
      'getState failed'
    );

    const client = {
      info: {
        wid: {
          _serialized: '5511666666666@s.whatsapp.net',
        },
      },
    };

    await expect(
      sut.notifyStatusChange(client, {
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

    centrifugo.publishSub.mockRejectedValueOnce(new Error('centrifugo down'));
    balanceWorkerStatusGrpcClientService.notifyWorkerStatus.mockRejectedValueOnce(
      new Error('grpc down')
    );

    await expect(
      sut.notifyStatusChange(undefined, {
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
      sut.notifyDisponibleStatus('manual bootstrap status')
    ).resolves.toBeUndefined();

    elasticDatabaseService.indices.mockResolvedValueOnce(false);
    await expect(sut.saveLogWppConnection({ worker_id: 'w' })).resolves.toBe(
      false
    );

    elasticDatabaseService.indices.mockResolvedValue(true);
    elasticDatabaseService.updateWithOCC.mockResolvedValueOnce('created');
    await expect(sut.saveLogWppConnection({ worker_id: 'w' })).resolves.toBe(
      true
    );

    elasticDatabaseService.updateWithOCC.mockResolvedValueOnce('noop');
    await expect(sut.saveLogWppConnection({ worker_id: 'w' })).resolves.toBe(
      true
    );

    elasticDatabaseService.updateWithOCC.mockResolvedValueOnce('ignored');
    await expect(sut.saveLogWppConnection({ worker_id: 'w' })).resolves.toBe(
      false
    );

    expect(elasticDatabaseService.indices).toHaveBeenCalledWith(
      EElasticIndex.wpp_connection,
      { mappings: true }
    );
    expect(mockBuildWppConnectionDocumentId).toHaveBeenCalledWith(
      'account-w',
      'worker-w'
    );
  });
});
