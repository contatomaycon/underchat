import 'reflect-metadata';

jest.mock('@core/config/environments', () => ({
  baileysEnvironment: {
    baileysAccountId: 'account-1',
    baileysWorkerId: 'worker-1',
    runtimeGeneration: 7,
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
import { ProviderInvocationSingleFlight } from '@core/common/functions/providerInvocationSingleFlight';

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
      notifyWorkerStatus: jest.fn(async (_payload: unknown) => undefined),
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

  it('records a transient disconnect without publishing a central status', async () => {
    const { service } = makeService();
    const notifyStatusChangeSpy = jest
      .spyOn(service as any, 'notifyStatusChange')
      .mockResolvedValue(undefined);

    await service.notifyDisconnected('temporary network loss', {
      detectedStatus: Status.connecting,
      workerStatus: EWorkerStatus.disponible,
      providerState: 'reconnecting',
      publishStatus: false,
    });

    expect(notifyStatusChangeSpy).not.toHaveBeenCalled();
    expect((service as any).lastKnownStatus).toBe(Status.connecting);
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
    expect(centrifugo.publishSub).not.toHaveBeenCalled();
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        status: Status.connected,
        worker_status_id: EWorkerStatus.online,
        phone: '5511999999999',
        code: ECodeMessage.connectionEstablished,
        session_ready: true,
      })
    );
  });

  it('shares an open-socket provider probe across concurrent readiness callers', async () => {
    const { service } = makeService();
    let releasePrivacyProbe!: () => void;
    const privacyProbe = new Promise<void>((resolve) => {
      releasePrivacyProbe = resolve;
    });
    const socket = {
      ws: { isOpen: true },
      user: { id: '5511999999999@s.whatsapp.net' },
      fetchPrivacySettings: jest.fn(() => privacyProbe),
      onWhatsApp: jest.fn(async () => [{ exists: true }]),
    };

    service.configure({
      getSocket: () => socket as never,
      getStatus: () => Status.connecting,
      getCode: () => ECodeMessage.awaitConnection,
      reconnect: jest.fn(),
      isConnected: () => false,
      hasSession: () => true,
      isIncomingBound: () => true,
    });

    const first = service.verifyCurrentSession();
    const second = service.verifyCurrentSession();
    await Promise.resolve();

    expect(socket.fetchPrivacySettings).toHaveBeenCalledTimes(1);
    expect(socket.onWhatsApp).not.toHaveBeenCalled();

    releasePrivacyProbe();

    await expect(first).resolves.toMatchObject({
      detectedStatus: Status.connected,
      session_ready: true,
      can_send: true,
    });
    await expect(second).resolves.toMatchObject({
      detectedStatus: Status.connected,
      session_ready: true,
      can_send: true,
    });
    expect(socket.fetchPrivacySettings).toHaveBeenCalledTimes(1);
    expect(socket.onWhatsApp).toHaveBeenCalledTimes(1);
  });

  it('fences a timed-out provider probe, observes its late rejection, and accepts only a recreated socket', async () => {
    jest.useFakeTimers();
    const { service } = makeService();
    const onProviderProbeTimeout = jest.fn();
    let rejectPrivacyProbe: (reason?: unknown) => void = () => undefined;
    const oldSocket = {
      ws: { isOpen: true },
      user: { id: '5511999999999@s.whatsapp.net' },
      fetchPrivacySettings: jest.fn(
        () =>
          new Promise<unknown>((_resolve, reject) => {
            rejectPrivacyProbe = reject;
          })
      ),
      onWhatsApp: jest.fn(async () => [{ exists: true }]),
    };
    let activeSocket = oldSocket;

    service.configure({
      getSocket: () => activeSocket as never,
      getStatus: () => Status.connected,
      getCode: () => ECodeMessage.connectionEstablished,
      reconnect: jest.fn(),
      isConnected: () => true,
      hasSession: () => true,
      isIncomingBound: () => true,
      onProviderProbeTimeout,
    });

    const timedOutCheck = service.runHealthCheck();
    await jest.advanceTimersByTimeAsync(10_000);
    await expect(timedOutCheck).resolves.toMatchObject({
      detectedStatus: Status.connecting,
      session_ready: false,
    });
    expect(oldSocket.fetchPrivacySettings).toHaveBeenCalledTimes(1);
    expect(oldSocket.onWhatsApp).not.toHaveBeenCalled();
    expect(onProviderProbeTimeout).toHaveBeenCalledTimes(1);

    await expect(service.runHealthCheck()).resolves.toMatchObject({
      detectedStatus: Status.connecting,
      session_ready: false,
    });
    expect(oldSocket.fetchPrivacySettings).toHaveBeenCalledTimes(1);
    expect(onProviderProbeTimeout).toHaveBeenCalledTimes(2);

    rejectPrivacyProbe(new Error('late privacy failure'));
    await Promise.resolve();
    await Promise.resolve();
    expect(console.warn).toHaveBeenCalledWith(
      '[WhatsappProviderAuxiliary] operation_rejected_after_timeout',
      expect.objectContaining({
        provider: 'baileys',
        operation: 'health:fetchPrivacySettings',
      })
    );

    activeSocket = {
      ws: { isOpen: true },
      user: { id: '5511999999999@s.whatsapp.net' },
      fetchPrivacySettings: jest.fn(async () => ({})),
      onWhatsApp: jest.fn(async () => [{ exists: true }]),
    };
    await expect(service.runHealthCheck()).resolves.toMatchObject({
      detectedStatus: Status.connected,
      session_ready: true,
      can_send: true,
    });
    expect(activeSocket.fetchPrivacySettings).toHaveBeenCalledTimes(1);
    expect(activeSocket.onWhatsApp).toHaveBeenCalledTimes(1);
  });

  it('treats healthy provider capacity saturation as a skipped probe without recovery', async () => {
    const { service } = makeService();
    const onProviderProbeTimeout = jest.fn();
    const socket = {
      ws: { isOpen: true },
      user: { id: '5511999999999@s.whatsapp.net' },
      fetchPrivacySettings: jest.fn(async () => ({})),
      onWhatsApp: jest.fn(async () => [{ exists: true }]),
    };
    const admission = new ProviderInvocationSingleFlight();
    const leases = Array.from({ length: 4 }, () => admission.acquire(socket));
    service.configure({
      getSocket: () => socket as never,
      getStatus: () => Status.connected,
      getCode: () => ECodeMessage.connectionEstablished,
      reconnect: jest.fn(),
      isConnected: () => true,
      hasSession: () => true,
      isIncomingBound: () => true,
      onProviderProbeTimeout,
    });

    try {
      await expect(service.runHealthCheck()).resolves.toMatchObject({
        isHealthy: true,
        detectedStatus: Status.connecting,
        session_ready: false,
        degraded_reason: 'outbound_provider_capacity_saturated',
      });
      expect(socket.fetchPrivacySettings).not.toHaveBeenCalled();
      expect(socket.onWhatsApp).not.toHaveBeenCalled();
      expect(onProviderProbeTimeout).not.toHaveBeenCalled();
    } finally {
      leases.forEach((lease) => lease?.releaseBeforeStart());
    }
  });

  it('does not expose provider probe error contents as degraded reasons', async () => {
    const { service } = makeService();
    const secret =
      'postgres://worker:password@database:5432/underchat capability-secret qr-secret session-secret';
    const socket = {
      ws: { isOpen: true },
      user: { id: '5511999999999@s.whatsapp.net' },
      fetchPrivacySettings: jest.fn(async () => {
        throw Object.assign(new Error(secret), { code: '57P01' });
      }),
      onWhatsApp: jest.fn(async () => [{ exists: true }]),
    };
    service.configure({
      getSocket: () => socket as never,
      getStatus: () => Status.connected,
      getCode: () => ECodeMessage.connectionEstablished,
      reconnect: jest.fn(),
      isConnected: () => true,
      hasSession: () => true,
      isIncomingBound: () => true,
    });

    const result = await (service as any).checkConnectivity(
      socket,
      Status.connected
    );

    expect(result).toMatchObject({
      reason: 'Session probe failed',
      degraded_reason: 'session_probe_failed:57p01',
      session_ready: false,
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('keeps reported connected socket in connecting state on transient closed websocket', async () => {
    const { service, centrifugo, balanceWorkerStatusGrpcClientService } =
      makeService();
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
    expect(mismatch).not.toHaveBeenCalled();
    expect(centrifugo.publishSub).not.toHaveBeenCalled();
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).not.toHaveBeenCalled();
  });

  it('preloads an asynchronous PostgreSQL session before bootstrap checks and reconnects it', async () => {
    const { service } = makeService();
    const callOrder: string[] = [];
    let sessionKnown = false;
    const prepareSession = jest.fn(async () => {
      callOrder.push('prepare:start');
      await Promise.resolve();
      sessionKnown = true;
      callOrder.push('prepare:done');
    });
    const hasSession = jest.fn(() => {
      callOrder.push('has_session');
      return sessionKnown;
    });
    const reconnect = jest.fn(() => {
      callOrder.push('reconnect');
      return true;
    });

    service.configure({
      getSocket: () => undefined,
      getStatus: () => Status.disconnected,
      getCode: () => ECodeMessage.awaitConnection,
      reconnect,
      isConnected: () => false,
      prepareSession,
      hasSession,
    });

    await expect(service.bootstrapConnection()).resolves.toBeUndefined();

    expect(prepareSession).toHaveBeenCalledTimes(1);
    expect(hasSession).toHaveBeenCalledTimes(1);
    expect(reconnect).toHaveBeenCalledWith({
      initial_connection: true,
      requested_by_user: false,
      from_disconnect_restart: true,
      runtime_generation: 7,
    });
    expect(callOrder).toEqual([
      'prepare:start',
      'prepare:done',
      'has_session',
      'reconnect',
    ]);
  });

  it('keeps bootstrap dormant after a tombstone without reading or reconnecting the session', async () => {
    const { service, balanceWorkerStatusGrpcClientService } = makeService();
    const prepareSession = jest.fn(async () => false);
    const hasSession = jest.fn(() => true);
    const reconnect = jest.fn(() => true);

    service.configure({
      getSocket: () => undefined,
      getStatus: () => Status.disconnected,
      getCode: () => ECodeMessage.awaitConnection,
      reconnect,
      isConnected: () => false,
      prepareSession,
      hasSession,
    });

    await expect(service.bootstrapConnection()).resolves.toBeUndefined();

    expect(prepareSession).toHaveBeenCalledTimes(1);
    expect(hasSession).not.toHaveBeenCalled();
    expect(reconnect).not.toHaveBeenCalled();
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        status: Status.info,
        worker_status_id: EWorkerStatus.disponible,
        session_ready: false,
        degraded_reason: 'Waiting for an authorized QR connection grant',
      })
    );
  });

  it('fails bootstrap closed with safe offline diagnostics when PostgreSQL session preload fails', async () => {
    const {
      service,
      centrifugo,
      elasticDatabaseService,
      balanceWorkerStatusGrpcClientService,
    } = makeService();
    const secret =
      'postgres://worker:password@database/session capability-secret qr-payload';
    const reportSecret = 'elastic://report-secret';
    const prepareSession = jest.fn(async () => {
      throw Object.assign(new Error(secret), { code: '42501' });
    });
    const hasSession = jest.fn(() => false);
    const reconnect = jest.fn(() => true);

    service.configure({
      getSocket: () => undefined,
      getStatus: () => Status.disconnected,
      getCode: () => ECodeMessage.awaitConnection,
      reconnect,
      isConnected: () => false,
      prepareSession,
      hasSession,
    });
    elasticDatabaseService.updateWithOCC.mockRejectedValueOnce(
      new Error(reportSecret)
    );

    await expect(service.bootstrapConnection()).rejects.toThrow(
      'baileys_bootstrap_session_refresh_failed:42501'
    );

    expect(prepareSession).toHaveBeenCalledTimes(1);
    expect(hasSession).not.toHaveBeenCalled();
    expect(reconnect).not.toHaveBeenCalled();
    expect(centrifugo.publishSub).not.toHaveBeenCalled();
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).toHaveBeenCalledTimes(1);
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        status: Status.disconnected,
        code: ECodeMessage.connectionLost,
        worker_status_id: EWorkerStatus.offline,
        session_ready: false,
        provider_state: 'bootstrap_session_refresh_failed',
        degraded_reason: 'baileys_bootstrap_session_refresh_failed:42501',
      })
    );
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus.mock.calls[0][0]
    ).not.toEqual(
      expect.objectContaining({
        qrcode: expect.anything(),
      })
    );
    expect(service.getReadinessSnapshot()).toMatchObject({
      isHealthy: false,
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.offline,
      provider_state: 'bootstrap_session_refresh_failed',
      degraded_reason: 'baileys_bootstrap_session_refresh_failed:42501',
    });
    expect(JSON.stringify(jest.mocked(console.error).mock.calls)).not.toContain(
      secret
    );
    expect(JSON.stringify(jest.mocked(console.error).mock.calls)).not.toContain(
      reportSecret
    );
  });

  it('does not downgrade a connection that becomes current while session preload is pending', async () => {
    const { service, balanceWorkerStatusGrpcClientService } = makeService();
    const secret = 'postgres://bootstrap-race-secret';
    let rejectPreparation!: (error: Error) => void;
    let connected = false;
    let status = Status.connecting;
    const prepareSession = jest.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectPreparation = reject;
        })
    );
    const hasSession = jest.fn(() => true);
    const reconnect = jest.fn(() => true);

    service.configure({
      getSocket: () => undefined,
      getStatus: () => status,
      getCode: () => ECodeMessage.awaitConnection,
      reconnect,
      isConnected: () => connected,
      prepareSession,
      hasSession,
    });

    const bootstrap = service.bootstrapConnection();
    await Promise.resolve();
    connected = true;
    status = Status.connected;
    rejectPreparation(Object.assign(new Error(secret), { code: '42501' }));

    await expect(bootstrap).resolves.toBeUndefined();
    expect(hasSession).not.toHaveBeenCalled();
    expect(reconnect).not.toHaveBeenCalled();
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).not.toHaveBeenCalled();
    expect(JSON.stringify(jest.mocked(console.error).mock.calls)).not.toContain(
      secret
    );
  });

  it('single-flights PostgreSQL session preload across concurrent bootstrap callers', async () => {
    const { service } = makeService();
    let finishPreparation!: () => void;
    const prepareSession = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finishPreparation = resolve;
        })
    );
    const hasSession = jest.fn(() => true);
    const reconnect = jest.fn(() => true);

    service.configure({
      getSocket: () => undefined,
      getStatus: () => Status.disconnected,
      getCode: () => ECodeMessage.awaitConnection,
      reconnect,
      isConnected: () => false,
      prepareSession,
      hasSession,
    });

    const first = service.bootstrapConnection();
    const second = service.bootstrapConnection();

    expect(first).toBe(second);
    await Promise.resolve();
    expect(prepareSession).toHaveBeenCalledTimes(1);
    expect(hasSession).not.toHaveBeenCalled();
    expect(reconnect).not.toHaveBeenCalled();

    finishPreparation();
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();

    expect(prepareSession).toHaveBeenCalledTimes(1);
    expect(hasSession).toHaveBeenCalledTimes(1);
    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  it('cancels an in-flight bootstrap before a stale reconnect can be scheduled', async () => {
    const { service, balanceWorkerStatusGrpcClientService } = makeService();
    let finishPreparation!: () => void;
    const prepareSession = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finishPreparation = resolve;
        })
    );
    const reconnect = jest.fn(() => true);

    service.configure({
      getSocket: () => undefined,
      getStatus: () => Status.disconnected,
      getCode: () => ECodeMessage.awaitConnection,
      reconnect,
      isConnected: () => false,
      prepareSession,
      hasSession: () => true,
    });

    const bootstrap = service.bootstrapConnection();
    await Promise.resolve();
    service.stop();
    finishPreparation();

    await expect(bootstrap).rejects.toThrow('baileys_bootstrap_cancelled');
    expect(reconnect).not.toHaveBeenCalled();
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).not.toHaveBeenCalled();
  });

  it('fails bootstrap closed when reconnect does not acknowledge a scheduled or started attempt', async () => {
    const { service, centrifugo, balanceWorkerStatusGrpcClientService } =
      makeService();
    const reconnect = jest.fn(() => false);

    service.configure({
      getSocket: () => undefined,
      getStatus: () => Status.disconnected,
      getCode: () => ECodeMessage.connectionLost,
      reconnect,
      isConnected: () => false,
      hasSession: () => true,
    });

    await expect(service.bootstrapConnection()).rejects.toThrow(
      'baileys_bootstrap_reconnect_not_started'
    );
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(centrifugo.publishSub).not.toHaveBeenCalled();
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        status: Status.disconnected,
        worker_status_id: EWorkerStatus.offline,
        provider_state: 'bootstrap_reconnect_not_started',
        degraded_reason: 'baileys_bootstrap_reconnect_not_started',
      })
    );
  });

  it('bootstrapConnection handles all bootstrap branches and promise lock', async () => {
    const { service, balanceWorkerStatusGrpcClientService } = makeService();

    await expect(service.bootstrapConnection()).resolves.toBeUndefined();

    const reconnectAction = jest.fn(() => true);

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
      runtime_generation: 7,
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

    await expect(service.bootstrapConnection()).rejects.toThrow(
      'baileys_bootstrap_reconnect_failed'
    );

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
      isHealthy: false,
      reason: 'WebSocket client state: CLOSED',
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.offline,
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

    expect(centrifugo.publishSub).not.toHaveBeenCalled();
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

    const secret =
      'postgres://worker:password@database:5432/underchat capability-secret qr-secret session-secret';
    balanceWorkerStatusGrpcClientService.notifyWorkerStatus.mockRejectedValueOnce(
      Object.assign(new Error(secret), { code: '57P01' })
    );

    await expect(
      (service as any).notifyStatusChange(undefined, {
        detectedStatus: Status.disconnected,
        workerStatus: EWorkerStatus.offline,
        isHealthy: false,
        reason: 'down',
      })
    ).resolves.toBeUndefined();
    expect(JSON.stringify(jest.mocked(console.error).mock.calls)).not.toContain(
      secret
    );

    balanceWorkerStatusGrpcClientService.notifyWorkerStatus.mockRejectedValueOnce(
      new Error('bootstrap notify down')
    );
    await expect(
      (service as any).notifyDisponibleStatus('manual bootstrap status')
    ).resolves.toBeUndefined();
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        worker_id: 'worker-1',
        runtime_generation: 7,
      })
    );

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
