import 'reflect-metadata';

jest.mock('@core/config/environments', () => ({
  wwebjsEnvironment: {
    wwebjsAccountId: 'account-w',
    wwebjsWorkerId: 'worker-w',
    runtimeGeneration: 17,
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
import { ProviderInvocationSingleFlight } from '@core/common/functions/providerInvocationSingleFlight';

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
      pupPage: {
        evaluate: jest.fn(async () => true),
      },
      getNumberId: jest.fn(async () => ({ _serialized: '5511777777777@c.us' })),
    };

    service.configure({
      getClient: () => client as never,
      getStatus: () => Status.disconnected,
      getCode: () => ECodeMessage.awaitConnection,
      reconnect: jest.fn(),
      isConnected: () => false,
      hasSession: () => true,
      hasCentralOnlineAcknowledgement: () => true,
      isEventBridgeAttached: () => true,
      onStatusMismatch: mismatch,
    });

    await expect(service.runHealthCheck()).resolves.toMatchObject({
      isHealthy: true,
      reason: 'Session ready',
      detectedStatus: Status.connected,
      workerStatus: EWorkerStatus.online,
      session_ready: true,
      can_send: true,
      can_receive_runtime: true,
      authenticated: true,
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
        runtime_generation: 17,
        code: ECodeMessage.connectionEstablished,
        phone: '5511777777777',
        session_ready: true,
      })
    );

    (service as any).lastKnownStatus = Status.connected;
    (service as any).lastKnownWorkerStatus = EWorkerStatus.online;
    const notifyStatusChangeSpy = jest
      .spyOn(service as any, 'notifyStatusChange')
      .mockResolvedValue(undefined);

    await service.runHealthCheck();
    expect(notifyStatusChangeSpy).not.toHaveBeenCalled();
  });

  it('does not invoke provider probes before client initialization completes', async () => {
    const { service } = makeService();
    const client = {
      getState: jest.fn(() => new Promise<string>(() => undefined)),
    };
    const onProviderProbeTimeout = jest.fn();
    let providerProbeAllowed = false;

    service.configure({
      getClient: () => client as never,
      getStatus: () => Status.connecting,
      getCode: () => ECodeMessage.awaitConnection,
      reconnect: jest.fn(),
      isConnected: () => false,
      hasSession: () => true,
      isEventBridgeAttached: () => false,
      isProviderProbeAllowed: () => providerProbeAllowed,
      onProviderProbeTimeout,
    });

    await expect(service.verifyCurrentSession()).resolves.toMatchObject({
      isHealthy: true,
      detectedStatus: Status.connecting,
      provider_state: 'client_initializing',
      degraded_reason: 'connection_launching',
      session_ready: false,
    });
    expect(client.getState).not.toHaveBeenCalled();
    expect(onProviderProbeTimeout).not.toHaveBeenCalled();

    providerProbeAllowed = true;
    jest.useFakeTimers();
    const postInitializeProbe = service.verifyCurrentSession();
    await jest.advanceTimersByTimeAsync(10_000);

    await expect(postInitializeProbe).resolves.toMatchObject({
      detectedStatus: Status.connecting,
      session_ready: false,
    });
    expect(client.getState).toHaveBeenCalledTimes(1);
    expect(onProviderProbeTimeout).toHaveBeenCalledTimes(1);
  });

  it('defers a provider probe that reaches its deadline during a canonical activation checkpoint', async () => {
    jest.useFakeTimers();
    const { service } = makeService();
    let canonicalCheckpointState = {
      inProgress: false,
      generation: 0,
    };
    let resolveInitialStateProbe!: (state: string) => void;
    const client = {
      info: {
        wid: { _serialized: '5511777777777@c.us' },
      },
      getState: jest
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<string>((resolve) => {
              resolveInitialStateProbe = resolve;
            })
        )
        .mockResolvedValue('CONNECTED'),
      pupPage: {
        evaluate: jest.fn(async () => true),
      },
      getNumberId: jest.fn(async () => ({
        _serialized: '5511777777777@c.us',
      })),
    };
    const onProviderProbeTimeout = jest.fn();

    service.configure({
      getClient: () => client as never,
      getStatus: () => Status.connecting,
      getCode: () => ECodeMessage.awaitConnection,
      reconnect: jest.fn(),
      isConnected: () => false,
      hasSession: () => true,
      isEventBridgeAttached: () => true,
      getCanonicalActivationCheckpointState: () => canonicalCheckpointState,
      isProviderProbeAllowed: () =>
        canonicalCheckpointState.inProgress
          ? {
              allowed: false,
              state: 'canonical_activation_checkpoint',
            }
          : true,
      onProviderProbeTimeout,
    });

    const timedOutProbe = service.verifyCurrentSession();
    await Promise.resolve();
    expect(client.getState).toHaveBeenCalledTimes(1);

    canonicalCheckpointState = { inProgress: true, generation: 1 };
    canonicalCheckpointState = { inProgress: false, generation: 1 };
    await jest.advanceTimersByTimeAsync(10_000);

    await expect(timedOutProbe).resolves.toMatchObject({
      isHealthy: true,
      detectedStatus: Status.connecting,
      provider_state: 'probe_deferred_backpressure',
      degraded_reason: 'provider_capacity_saturated',
      session_ready: false,
    });
    expect(onProviderProbeTimeout).not.toHaveBeenCalled();

    const retainedSingleFlightProbe = service.verifyCurrentSession();
    await Promise.resolve();

    await expect(retainedSingleFlightProbe).resolves.toMatchObject({
      isHealthy: true,
      detectedStatus: Status.connecting,
      provider_state: 'probe_deferred_backpressure',
      degraded_reason: 'provider_capacity_saturated',
      session_ready: false,
    });
    expect(client.getState).toHaveBeenCalledTimes(1);
    expect(onProviderProbeTimeout).not.toHaveBeenCalled();

    resolveInitialStateProbe('CONNECTED');
    await Promise.resolve();
    await Promise.resolve();

    await expect(service.verifyCurrentSession()).resolves.toMatchObject({
      isHealthy: true,
      detectedStatus: Status.connected,
      session_ready: true,
      can_send: true,
    });
    expect(client.getState).toHaveBeenCalledTimes(2);
    expect(client.getNumberId).toHaveBeenCalledTimes(1);
    expect(onProviderProbeTimeout).not.toHaveBeenCalled();
  });

  it('recovers once when getNumberId never drains after a canonical checkpoint', async () => {
    jest.useFakeTimers();
    const { service } = makeService();
    let canonicalCheckpointState = { inProgress: false, generation: 0 };
    let resolveNumberProbe!: (value: { _serialized: string }) => void;
    const client = {
      info: {
        wid: { _serialized: '5511777777777@c.us' },
      },
      getState: jest.fn(async () => 'CONNECTED'),
      pupPage: {
        evaluate: jest.fn(async () => true),
      },
      getNumberId: jest.fn(
        () =>
          new Promise<{ _serialized: string }>((resolve) => {
            resolveNumberProbe = resolve;
          })
      ),
    };
    const onProviderProbeTimeout = jest.fn();

    service.configure({
      getClient: () => client as never,
      getStatus: () => Status.connecting,
      getCode: () => ECodeMessage.awaitConnection,
      reconnect: jest.fn(),
      isConnected: () => false,
      hasSession: () => true,
      isEventBridgeAttached: () => true,
      getCanonicalActivationCheckpointState: () => canonicalCheckpointState,
      isProviderProbeAllowed: () =>
        canonicalCheckpointState.inProgress
          ? {
              allowed: false,
              state: 'canonical_activation_checkpoint',
            }
          : true,
      onProviderProbeTimeout,
    });

    const verification = service.verifyCurrentSession();
    await jest.advanceTimersByTimeAsync(0);
    expect(client.getNumberId).toHaveBeenCalledTimes(1);

    canonicalCheckpointState = { inProgress: true, generation: 1 };
    await jest.advanceTimersByTimeAsync(10_000);
    await expect(verification).resolves.toMatchObject({
      isHealthy: true,
      detectedStatus: Status.connecting,
      provider_state: 'probe_deferred_backpressure',
    });

    await jest.advanceTimersByTimeAsync(30_000);
    expect(onProviderProbeTimeout).not.toHaveBeenCalled();

    canonicalCheckpointState = { inProgress: false, generation: 1 };
    await jest.advanceTimersByTimeAsync(250);
    await jest.advanceTimersByTimeAsync(9_999);
    expect(onProviderProbeTimeout).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(onProviderProbeTimeout).toHaveBeenCalledTimes(1);
    expect(onProviderProbeTimeout).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        code: 'WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT',
        operation: 'health:getNumberId',
      })
    );

    await jest.advanceTimersByTimeAsync(30_000);
    expect(onProviderProbeTimeout).toHaveBeenCalledTimes(1);

    resolveNumberProbe({ _serialized: '5511777777777@c.us' });
    await jest.advanceTimersByTimeAsync(0);
    expect(onProviderProbeTimeout).toHaveBeenCalledTimes(1);
  });

  it('cancels getNumberId recovery when the crossed call settles inside the drain grace', async () => {
    jest.useFakeTimers();
    const { service } = makeService();
    let canonicalCheckpointState = { inProgress: false, generation: 0 };
    let resolveNumberProbe!: (value: { _serialized: string }) => void;
    const client = {
      info: {
        wid: { _serialized: '5511777777777@c.us' },
      },
      getState: jest.fn(async () => 'CONNECTED'),
      pupPage: {
        evaluate: jest.fn(async () => true),
      },
      getNumberId: jest
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<{ _serialized: string }>((resolve) => {
              resolveNumberProbe = resolve;
            })
        )
        .mockResolvedValue({ _serialized: '5511777777777@c.us' }),
    };
    const onProviderProbeTimeout = jest.fn();

    service.configure({
      getClient: () => client as never,
      getStatus: () => Status.connecting,
      getCode: () => ECodeMessage.awaitConnection,
      reconnect: jest.fn(),
      isConnected: () => false,
      hasSession: () => true,
      isEventBridgeAttached: () => true,
      getCanonicalActivationCheckpointState: () => canonicalCheckpointState,
      isProviderProbeAllowed: () =>
        canonicalCheckpointState.inProgress
          ? {
              allowed: false,
              state: 'canonical_activation_checkpoint',
            }
          : true,
      onProviderProbeTimeout,
    });

    const verification = service.verifyCurrentSession();
    await jest.advanceTimersByTimeAsync(0);
    canonicalCheckpointState = { inProgress: true, generation: 1 };
    await jest.advanceTimersByTimeAsync(10_000);
    await expect(verification).resolves.toMatchObject({
      provider_state: 'probe_deferred_backpressure',
    });

    canonicalCheckpointState = { inProgress: false, generation: 1 };
    await jest.advanceTimersByTimeAsync(250);
    await jest.advanceTimersByTimeAsync(5_000);
    resolveNumberProbe({ _serialized: '5511777777777@c.us' });
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(10_000);

    expect(onProviderProbeTimeout).not.toHaveBeenCalled();
    await expect(service.verifyCurrentSession()).resolves.toMatchObject({
      isHealthy: true,
      detectedStatus: Status.connected,
      session_ready: true,
    });
    expect(client.getNumberId).toHaveBeenCalledTimes(2);
  });

  it('drops deferred recovery for a replaced client without contaminating the new scope', async () => {
    jest.useFakeTimers();
    const { service } = makeService();
    let canonicalCheckpointState = { inProgress: false, generation: 0 };
    let resolveOldNumberProbe!: (value: { _serialized: string }) => void;
    const oldClient = {
      info: {
        wid: { _serialized: '5511777777777@c.us' },
      },
      getState: jest.fn(async () => 'CONNECTED'),
      pupPage: {
        evaluate: jest.fn(async () => true),
      },
      getNumberId: jest.fn(
        () =>
          new Promise<{ _serialized: string }>((resolve) => {
            resolveOldNumberProbe = resolve;
          })
      ),
    };
    const newClient = {
      info: {
        wid: { _serialized: '5511888888888@c.us' },
      },
      getState: jest.fn(async () => 'CONNECTED'),
      pupPage: {
        evaluate: jest.fn(async () => true),
      },
      getNumberId: jest.fn(async () => ({
        _serialized: '5511888888888@c.us',
      })),
    };
    let currentClient: typeof oldClient | typeof newClient = oldClient;
    const onProviderProbeTimeout = jest.fn();

    service.configure({
      getClient: () => currentClient as never,
      getStatus: () => Status.connecting,
      getCode: () => ECodeMessage.awaitConnection,
      reconnect: jest.fn(),
      isConnected: () => false,
      hasSession: () => true,
      isEventBridgeAttached: () => true,
      getCanonicalActivationCheckpointState: () => canonicalCheckpointState,
      isProviderProbeAllowed: () =>
        canonicalCheckpointState.inProgress
          ? {
              allowed: false,
              state: 'canonical_activation_checkpoint',
            }
          : true,
      onProviderProbeTimeout,
    });

    const oldVerification = service.verifyCurrentSession();
    await jest.advanceTimersByTimeAsync(0);
    canonicalCheckpointState = { inProgress: true, generation: 1 };
    await jest.advanceTimersByTimeAsync(10_000);
    await expect(oldVerification).resolves.toMatchObject({
      provider_state: 'probe_deferred_backpressure',
    });

    currentClient = newClient;
    await jest.advanceTimersByTimeAsync(250);
    canonicalCheckpointState = { inProgress: false, generation: 1 };

    await expect(service.verifyCurrentSession()).resolves.toMatchObject({
      isHealthy: true,
      detectedStatus: Status.connected,
      session_ready: true,
    });
    expect(onProviderProbeTimeout).not.toHaveBeenCalled();

    resolveOldNumberProbe({ _serialized: '5511777777777@c.us' });
    await jest.advanceTimersByTimeAsync(0);
    await expect(service.verifyCurrentSession()).resolves.toMatchObject({
      isHealthy: true,
      detectedStatus: Status.connected,
      session_ready: true,
    });
    expect(newClient.getNumberId).toHaveBeenCalledTimes(2);
    expect(onProviderProbeTimeout).not.toHaveBeenCalled();
  });

  it('keeps a newer deferred-probe owner when an old settlement callback arrives', () => {
    const { service } = makeService();
    const servicePrivate = service as any;
    const client = {};
    const operationKey = 'health:getNumberId';
    const oldToken = Symbol('old-owner');
    const replacementEntry = {
      token: Symbol('replacement-owner'),
      client,
      operationKey,
      providerCall: Promise.resolve(),
      timeoutError: new Error('timeout'),
      markStalled: jest.fn(),
      deferredAtMs: Date.now(),
    };
    servicePrivate.canonicalCheckpointDeferredProviderCalls.set(
      client,
      new Map([[operationKey, replacementEntry]])
    );

    expect(
      servicePrivate.clearCanonicalCheckpointDeferredProviderCall(
        client,
        operationKey,
        oldToken
      )
    ).toBe(false);
    expect(
      servicePrivate.canonicalCheckpointDeferredProviderCalls
        .get(client)
        .get(operationKey)
    ).toBe(replacementEntry);
  });

  it('rearms deferred recovery when the health checker restarts', async () => {
    jest.useFakeTimers();
    const { service } = makeService();
    const servicePrivate = service as any;
    const client = {};
    const operationKey = 'health:getNumberId';
    const onProviderProbeTimeout = jest.fn();
    const markStalled = jest.fn();
    const entry = {
      token: Symbol('restart-owner'),
      client,
      operationKey,
      providerCall: new Promise(() => undefined),
      timeoutError: new Error('timeout'),
      markStalled,
      deferredAtMs: Date.now(),
    };

    service.configure({
      getClient: () => client as never,
      getStatus: () => Status.connecting,
      getCode: () => ECodeMessage.awaitConnection,
      reconnect: jest.fn(),
      isConnected: () => false,
      hasSession: () => true,
      getCanonicalActivationCheckpointState: () => ({
        inProgress: false,
        generation: 1,
      }),
      onProviderProbeTimeout,
    });
    servicePrivate.canonicalCheckpointDeferredProviderCalls.set(
      client,
      new Map([[operationKey, entry]])
    );
    servicePrivate.canonicalCheckpointDeferredEntries.add(entry);
    servicePrivate.scheduleCanonicalCheckpointDeferredProviderCallRecovery(
      client,
      entry,
      60_000
    );

    service.stop();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(onProviderProbeTimeout).not.toHaveBeenCalled();

    service.start(1_000_000);
    await jest.advanceTimersByTimeAsync(10_000);

    expect(markStalled).toHaveBeenCalledTimes(1);
    expect(onProviderProbeTimeout).toHaveBeenCalledTimes(1);
    service.stop();
  });

  it('does not start provider probes while a canonical activation checkpoint is already active', async () => {
    const { service } = makeService();
    const client = {
      getState: jest.fn(async () => 'CONNECTED'),
    };

    service.configure({
      getClient: () => client as never,
      getStatus: () => Status.connecting,
      getCode: () => ECodeMessage.awaitConnection,
      reconnect: jest.fn(),
      isConnected: () => false,
      hasSession: () => true,
      getCanonicalActivationCheckpointState: () => ({
        inProgress: true,
        generation: 4,
      }),
      isProviderProbeAllowed: () => ({
        allowed: false,
        state: 'canonical_activation_checkpoint',
      }),
    });

    await expect(service.verifyCurrentSession()).resolves.toMatchObject({
      isHealthy: true,
      detectedStatus: Status.connecting,
      provider_state: 'canonical_activation_checkpoint',
      degraded_reason: 'canonical_activation_checkpoint',
      session_ready: false,
      process_replacement_required: false,
    });
    expect(client.getState).not.toHaveBeenCalled();
  });

  it('reports a timed-out initialization as unhealthy process replacement without probing', async () => {
    const { service } = makeService();
    const client = {
      getState: jest.fn(async () => 'CONNECTED'),
    };

    service.configure({
      getClient: () => client as never,
      getStatus: () => Status.connecting,
      getCode: () => ECodeMessage.awaitConnection,
      reconnect: jest.fn(),
      isConnected: () => false,
      hasSession: () => true,
      isEventBridgeAttached: () => false,
      isProviderProbeAllowed: () => ({
        allowed: false,
        state: 'initialization_timeout',
        processReplacementRequired: true,
      }),
    });

    await expect(service.verifyCurrentSession()).resolves.toMatchObject({
      isHealthy: false,
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.offline,
      provider_state: 'initialization_timeout',
      degraded_reason: 'initialization_timeout',
      session_ready: false,
      process_replacement_required: true,
    });
    expect(client.getState).not.toHaveBeenCalled();
  });

  it.each([
    ['initialization_failed', 'Client initialization failed'],
    ['cancellation_requested', 'Client initialization was cancelled'],
  ] as const)(
    'reports the %s probe gate as unhealthy instead of pending',
    async (state, reason) => {
      const { service } = makeService();
      const client = {
        getState: jest.fn(async () => 'CONNECTED'),
      };

      service.configure({
        getClient: () => client as never,
        getStatus: () => Status.connecting,
        getCode: () => ECodeMessage.awaitConnection,
        reconnect: jest.fn(),
        isConnected: () => false,
        hasSession: () => true,
        isProviderProbeAllowed: () => ({ allowed: false, state }),
      });

      await expect(service.verifyCurrentSession()).resolves.toMatchObject({
        isHealthy: false,
        reason,
        detectedStatus: Status.disconnected,
        provider_state: state,
        process_replacement_required: false,
      });
      expect(client.getState).not.toHaveBeenCalled();
    }
  );

  it('fences a timed-out state probe, observes its late rejection, and accepts only a recreated client', async () => {
    jest.useFakeTimers();
    const { service } = makeService();
    const onProviderProbeTimeout = jest.fn();
    let rejectStateProbe: (reason?: unknown) => void = () => undefined;
    const oldClient = {
      info: {
        wid: { _serialized: '5511777777777@c.us' },
      },
      getState: jest.fn(
        () =>
          new Promise<string>((_resolve, reject) => {
            rejectStateProbe = reject;
          })
      ),
    };
    let activeClient = oldClient;

    service.configure({
      getClient: () => activeClient as never,
      getStatus: () => Status.connected,
      getCode: () => ECodeMessage.connectionEstablished,
      reconnect: jest.fn(),
      isConnected: () => true,
      hasSession: () => true,
      isEventBridgeAttached: () => true,
      onProviderProbeTimeout,
    });

    const timedOutCheck = service.runHealthCheck();
    await jest.advanceTimersByTimeAsync(10_000);
    await expect(timedOutCheck).resolves.toMatchObject({
      detectedStatus: Status.connecting,
      session_ready: false,
    });
    expect(oldClient.getState).toHaveBeenCalledTimes(1);
    expect(onProviderProbeTimeout).toHaveBeenCalledTimes(1);

    await expect(service.runHealthCheck()).resolves.toMatchObject({
      session_ready: false,
    });
    expect(oldClient.getState).toHaveBeenCalledTimes(1);
    expect(onProviderProbeTimeout).toHaveBeenCalledTimes(2);

    rejectStateProbe(new Error('late state failure'));
    await Promise.resolve();
    await Promise.resolve();
    expect(console.warn).toHaveBeenCalledWith(
      '[WhatsappProviderAuxiliary] operation_rejected_after_timeout',
      expect.objectContaining({
        provider: 'wwebjs',
        operation: 'health:getState',
      })
    );

    const freshClient = {
      info: {
        wid: { _serialized: '5511777777777@c.us' },
      },
      getState: jest.fn(async () => 'CONNECTED'),
      pupPage: {
        evaluate: jest.fn(async () => true),
      },
      getNumberId: jest.fn(async () => ({
        _serialized: '5511777777777@c.us',
      })),
    };
    activeClient = freshClient;
    await expect(service.runHealthCheck()).resolves.toMatchObject({
      detectedStatus: Status.connected,
      session_ready: true,
      can_send: true,
    });
    expect(freshClient.getState).toHaveBeenCalledTimes(1);
    expect(freshClient.pupPage.evaluate).toHaveBeenCalledTimes(1);
    expect(freshClient.getNumberId).toHaveBeenCalledTimes(1);
  });

  it('never reports a saturated provider as online without prior strict readiness', async () => {
    const { service, centrifugo, balanceWorkerStatusGrpcClientService } =
      makeService();
    const onProviderProbeTimeout = jest.fn();
    const client = {
      getState: jest.fn(async () => 'CONNECTED'),
    };
    const admission = new ProviderInvocationSingleFlight();
    const leases = Array.from({ length: 4 }, () => admission.acquire(client));
    service.configure({
      getClient: () => client as never,
      getStatus: () => Status.connected,
      getCode: () => ECodeMessage.connectionEstablished,
      reconnect: jest.fn(),
      isConnected: () => true,
      hasSession: () => true,
      isEventBridgeAttached: () => true,
      onProviderProbeTimeout,
    });

    try {
      await expect(service.runHealthCheck()).resolves.toMatchObject({
        isHealthy: true,
        detectedStatus: Status.connecting,
        workerStatus: EWorkerStatus.disponible,
        provider_state: 'probe_deferred_backpressure',
        degraded_reason: 'provider_capacity_saturated',
        session_ready: false,
        can_send: false,
      });
      expect(client.getState).not.toHaveBeenCalled();
      expect(onProviderProbeTimeout).not.toHaveBeenCalled();
      expect(centrifugo.publishSub).not.toHaveBeenCalled();
      expect(
        balanceWorkerStatusGrpcClientService.notifyWorkerStatus
      ).not.toHaveBeenCalled();
    } finally {
      leases.forEach((lease) => lease?.releaseBeforeStart());
    }
  });

  it('retains recent strict readiness during temporary provider capacity backpressure', async () => {
    const { service } = makeService();
    const onProviderProbeTimeout = jest.fn();
    const client = {
      info: { wid: { _serialized: '5511777777777@c.us' } },
      getState: jest.fn(async () => 'CONNECTED'),
      pupPage: { evaluate: jest.fn(async () => true) },
      getNumberId: jest.fn(async () => ({
        _serialized: '5511777777777@c.us',
      })),
    };
    service.configure({
      getClient: () => client as never,
      getStatus: () => Status.connected,
      getCode: () => ECodeMessage.connectionEstablished,
      reconnect: jest.fn(),
      isConnected: () => true,
      hasSession: () => true,
      hasCentralOnlineAcknowledgement: () => true,
      isEventBridgeAttached: () => true,
      onProviderProbeTimeout,
    });

    await expect(service.runHealthCheck()).resolves.toMatchObject({
      session_ready: true,
      can_send: true,
    });

    const admission = new ProviderInvocationSingleFlight();
    const leases = Array.from({ length: 4 }, () => admission.acquire(client));
    try {
      await expect(service.runHealthCheck()).resolves.toMatchObject({
        isHealthy: true,
        detectedStatus: Status.connected,
        workerStatus: EWorkerStatus.online,
        session_ready: true,
        can_send: true,
        reason:
          'Session readiness retained. State probe deferred while provider capacity is saturated',
      });
      expect(onProviderProbeTimeout).not.toHaveBeenCalled();
    } finally {
      leases.forEach((lease) => lease?.releaseBeforeStart());
    }
  });

  it('retains same-client strict readiness during pre-ack backpressure while native status is online', async () => {
    const { service } = makeService();
    const client = {
      info: { wid: { _serialized: '5511777777777@c.us' } },
      getState: jest.fn(async () => 'CONNECTED'),
      pupPage: { evaluate: jest.fn(async () => true) },
      getNumberId: jest.fn(async () => ({
        _serialized: '5511777777777@c.us',
      })),
    };
    const isNativeConnectionOnline = jest.fn(() => true);
    service.configure({
      getClient: () => client as never,
      getStatus: () => Status.connecting,
      getCode: () => ECodeMessage.awaitConnection,
      reconnect: jest.fn(),
      isConnected: () => false,
      isNativeConnectionOnline,
      hasSession: () => true,
      hasCentralOnlineAcknowledgement: () => false,
      isEventBridgeAttached: () => true,
    });

    await expect(service.verifyCurrentSession()).resolves.toMatchObject({
      session_ready: true,
      can_send: true,
    });

    const admission = new ProviderInvocationSingleFlight();
    const leases = Array.from({ length: 4 }, () => admission.acquire(client));
    try {
      await expect(service.verifyCurrentSession()).resolves.toMatchObject({
        detectedStatus: Status.connected,
        workerStatus: EWorkerStatus.online,
        session_ready: true,
        can_send: true,
        reason:
          'Session readiness retained. State probe deferred while provider capacity is saturated',
      });
      expect(isNativeConnectionOnline).toHaveBeenCalledWith(client);
    } finally {
      leases.forEach((lease) => lease?.releaseBeforeStart());
    }
  });

  it('does not retain pre-ack readiness after native status leaves online', async () => {
    const { service } = makeService();
    const client = {
      info: { wid: { _serialized: '5511777777777@c.us' } },
      getState: jest.fn(async () => 'CONNECTED'),
      pupPage: { evaluate: jest.fn(async () => true) },
      getNumberId: jest.fn(async () => ({
        _serialized: '5511777777777@c.us',
      })),
    };
    let nativeOnline = true;
    service.configure({
      getClient: () => client as never,
      getStatus: () => Status.connecting,
      getCode: () => ECodeMessage.awaitConnection,
      reconnect: jest.fn(),
      isConnected: () => false,
      isNativeConnectionOnline: () => nativeOnline,
      hasSession: () => true,
      isEventBridgeAttached: () => true,
    });

    await expect(service.verifyCurrentSession()).resolves.toMatchObject({
      session_ready: true,
    });
    nativeOnline = false;

    const admission = new ProviderInvocationSingleFlight();
    const leases = Array.from({ length: 4 }, () => admission.acquire(client));
    try {
      await expect(service.verifyCurrentSession()).resolves.toMatchObject({
        detectedStatus: Status.connecting,
        workerStatus: EWorkerStatus.disponible,
        provider_state: 'probe_deferred_backpressure',
        degraded_reason: 'provider_capacity_saturated',
        session_ready: false,
        can_send: false,
      });
    } finally {
      leases.forEach((lease) => lease?.releaseBeforeStart());
    }
  });

  it('treats Store probe capacity as inconclusive without status demotion', async () => {
    const { service, centrifugo, balanceWorkerStatusGrpcClientService } =
      makeService();
    const onProviderProbeTimeout = jest.fn();
    const client = {
      info: { wid: { _serialized: '5511777777777@c.us' } },
      pupPage: { evaluate: jest.fn(async () => true) },
      getNumberId: jest.fn(async () => ({
        _serialized: '5511777777777@c.us',
      })),
    };
    const sut = service as unknown as {
      getStateWithTimeout: () => Promise<string | undefined>;
    };
    jest.spyOn(sut, 'getStateWithTimeout').mockResolvedValue('CONNECTED');
    service.configure({
      getClient: () => client as never,
      getStatus: () => Status.connected,
      getCode: () => ECodeMessage.connectionEstablished,
      reconnect: jest.fn(),
      isConnected: () => true,
      hasSession: () => true,
      isEventBridgeAttached: () => true,
      onProviderProbeTimeout,
    });
    const admission = new ProviderInvocationSingleFlight();
    const leases = Array.from({ length: 4 }, () => admission.acquire(client));

    try {
      await expect(service.runHealthCheck()).resolves.toMatchObject({
        isHealthy: true,
        detectedStatus: Status.connecting,
        workerStatus: EWorkerStatus.disponible,
        provider_state: 'probe_deferred_backpressure',
        degraded_reason: 'provider_capacity_saturated',
        session_ready: false,
      });
      expect(client.pupPage.evaluate).not.toHaveBeenCalled();
      expect(onProviderProbeTimeout).not.toHaveBeenCalled();
      expect(centrifugo.publishSub).not.toHaveBeenCalled();
      expect(
        balanceWorkerStatusGrpcClientService.notifyWorkerStatus
      ).not.toHaveBeenCalled();
    } finally {
      leases.forEach((lease) => lease?.releaseBeforeStart());
    }
  });

  it('treats self-probe capacity as inconclusive without reconnect or status demotion', async () => {
    const { service, centrifugo, balanceWorkerStatusGrpcClientService } =
      makeService();
    const onProviderProbeTimeout = jest.fn();
    const client = {
      info: { wid: { _serialized: '5511777777777@c.us' } },
      getNumberId: jest.fn(async () => ({
        _serialized: '5511777777777@c.us',
      })),
    };
    const sut = service as unknown as {
      getStateWithTimeout: () => Promise<string | undefined>;
      isStoreReady: () => Promise<boolean | undefined>;
    };
    jest.spyOn(sut, 'getStateWithTimeout').mockResolvedValue('CONNECTED');
    jest.spyOn(sut, 'isStoreReady').mockResolvedValue(true);
    service.configure({
      getClient: () => client as never,
      getStatus: () => Status.connected,
      getCode: () => ECodeMessage.connectionEstablished,
      reconnect: jest.fn(),
      isConnected: () => true,
      hasSession: () => true,
      isEventBridgeAttached: () => true,
      onProviderProbeTimeout,
    });
    const admission = new ProviderInvocationSingleFlight();
    const leases = Array.from({ length: 4 }, () => admission.acquire(client));

    try {
      await expect(service.runHealthCheck()).resolves.toMatchObject({
        isHealthy: true,
        detectedStatus: Status.connecting,
        workerStatus: EWorkerStatus.disponible,
        provider_state: 'probe_deferred_backpressure',
        degraded_reason: 'provider_capacity_saturated',
        session_ready: false,
      });
      expect(client.getNumberId).not.toHaveBeenCalled();
      expect(onProviderProbeTimeout).not.toHaveBeenCalled();
      expect(centrifugo.publishSub).not.toHaveBeenCalled();
      expect(
        balanceWorkerStatusGrpcClientService.notifyWorkerStatus
      ).not.toHaveBeenCalled();
    } finally {
      leases.forEach((lease) => lease?.releaseBeforeStart());
    }
  });

  it('does not publish the first online transition before central runtime acknowledgement', async () => {
    const { service, centrifugo, balanceWorkerStatusGrpcClientService } =
      makeService();
    const client = {
      info: { wid: { _serialized: '5511777777777@c.us' } },
      getState: jest.fn(async () => 'CONNECTED'),
      pupPage: { evaluate: jest.fn(async () => true) },
      getNumberId: jest.fn(async () => ({
        _serialized: '5511777777777@c.us',
      })),
    };
    service.configure({
      getClient: () => client as never,
      getStatus: () => Status.connecting,
      getCode: () => ECodeMessage.awaitConnection,
      reconnect: jest.fn(),
      isConnected: () => false,
      hasSession: () => true,
      hasCentralOnlineAcknowledgement: () => false,
      isEventBridgeAttached: () => true,
    });

    await expect(service.runHealthCheck()).resolves.toMatchObject({
      session_ready: true,
      can_send: true,
      can_receive_runtime: true,
    });
    expect(centrifugo.publishSub).not.toHaveBeenCalled();
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).not.toHaveBeenCalled();
  });

  it('keeps launch states as connecting while WWebJS is still starting', async () => {
    const { service } = makeService();
    const mismatch = jest.fn();
    const client = {
      getState: jest.fn(async () => 'UNLAUNCHED'),
    };

    service.configure({
      getClient: () => client as never,
      getStatus: () => Status.connecting,
      getCode: () => ECodeMessage.awaitConnection,
      reconnect: jest.fn(),
      isConnected: () => false,
      hasSession: () => true,
      onStatusMismatch: mismatch,
    });

    await expect(service.runHealthCheck()).resolves.toMatchObject({
      isHealthy: true,
      reason: 'Connection is launching (UNLAUNCHED)',
      detectedStatus: Status.connecting,
      workerStatus: EWorkerStatus.disponible,
      provider_state: 'UNLAUNCHED',
      degraded_reason: 'connection_launching',
      session_ready: false,
      authenticated: false,
      can_send: false,
      can_receive_runtime: false,
    });
    expect(mismatch).not.toHaveBeenCalled();
  });

  it('reports runtime readiness as connecting during client bootstrap', async () => {
    const { service } = makeService();

    service.configure({
      getClient: () => undefined,
      getStatus: () => Status.connecting,
      getCode: () => ECodeMessage.awaitConnection,
      reconnect: jest.fn(),
      isConnected: () => false,
      hasSession: () => true,
    });

    await expect(service.verifyCurrentSession()).resolves.toMatchObject({
      isHealthy: true,
      reason: 'Connection is launching (client not ready yet)',
      detectedStatus: Status.connecting,
      workerStatus: EWorkerStatus.disponible,
      provider_state: 'client_launching',
      degraded_reason: 'connection_launching',
    });
  });

  it('keeps a reported connected client in connecting state on transient state check failure', async () => {
    const { service, centrifugo, balanceWorkerStatusGrpcClientService } =
      makeService();

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

    await expect(service.runHealthCheck()).resolves.toMatchObject({
      isHealthy: true,
      reason: 'Transient disconnect tolerated (Failed to get state)',
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

  it('tolerates one transient Store reload after connected and reconnects only if it persists', async () => {
    const { service, centrifugo, balanceWorkerStatusGrpcClientService } =
      makeService();
    const mismatch = jest.fn();
    const page = {
      evaluate: jest.fn(async () => false),
    };
    const client = {
      info: {
        wid: {
          _serialized: '5511777777777@c.us',
        },
      },
      getState: jest.fn(async () => 'CONNECTED'),
      pupPage: page,
    };

    service.configure({
      getClient: () => client as never,
      getStatus: () => Status.connected,
      getCode: () => ECodeMessage.connectionEstablished,
      reconnect: jest.fn(),
      isConnected: () => true,
      hasSession: () => true,
      isEventBridgeAttached: () => true,
      onStatusMismatch: mismatch,
    });

    (service as any).lastKnownStatus = Status.connected;
    (service as any).lastKnownWorkerStatus = EWorkerStatus.online;

    await expect(service.runHealthCheck()).resolves.toMatchObject({
      isHealthy: true,
      reason:
        'Transient disconnect tolerated (Connected state but Store WWebJS is not ready)',
      detectedStatus: Status.connecting,
      workerStatus: EWorkerStatus.disponible,
      degraded_reason: 'store_wwebjs_not_ready',
      session_ready: false,
    });
    expect(mismatch).not.toHaveBeenCalled();
    expect(centrifugo.publishSub).not.toHaveBeenCalled();
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).not.toHaveBeenCalled();

    await expect(service.runHealthCheck()).resolves.toMatchObject({
      isHealthy: false,
      reason: 'Connected state but Store WWebJS is not ready',
      detectedStatus: Status.connecting,
      workerStatus: EWorkerStatus.disponible,
      degraded_reason: 'store_wwebjs_not_ready',
      session_ready: false,
    });
    expect(mismatch).toHaveBeenCalledTimes(1);
    expect(mismatch).toHaveBeenCalledWith(
      Status.connecting,
      EWorkerStatus.disponible
    );
  });

  it('refreshes an asynchronous PostgreSQL session before fresh-process bootstrap decides whether it can restore', async () => {
    jest.useFakeTimers();
    const { service } = makeService();
    let sessionKnown = false;
    const prepareSession = jest.fn(async () => {
      await Promise.resolve();
      sessionKnown = true;
    });
    const hasSession = jest.fn(() => sessionKnown);
    const reconnect = jest.fn();

    service.configure({
      getClient: () => undefined,
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
    expect(prepareSession.mock.invocationCallOrder[0]).toBeLessThan(
      hasSession.mock.invocationCallOrder[0]
    );

    await jest.advanceTimersByTimeAsync(15_001);
    expect(reconnect).toHaveBeenCalledWith({
      initial_connection: true,
      requested_by_user: false,
      from_disconnect_restart: true,
      runtime_generation: 17,
    });
  });

  it('keeps bootstrap dormant after a tombstone without inspecting or reconnecting the profile', async () => {
    const { service, balanceWorkerStatusGrpcClientService } = makeService();
    const prepareSession = jest.fn(async () => false);
    const hasSession = jest.fn(() => true);
    const reconnect = jest.fn();

    service.configure({
      getClient: () => undefined,
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

  it('recovers when a destroyed client leaves a stale connected status in the singleton', async () => {
    jest.useFakeTimers();
    const { service } = makeService();
    const reconnect = jest.fn();

    service.configure({
      getClient: () => undefined,
      getStatus: () => Status.connected,
      getCode: () => ECodeMessage.connectionEstablished,
      reconnect,
      isConnected: () => false,
      prepareSession: jest.fn(async () => undefined),
      hasSession: () => true,
    });

    await expect(service.bootstrapConnection()).resolves.toBeUndefined();
    expect(reconnect).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(15_001);
    expect(reconnect).toHaveBeenCalledWith({
      initial_connection: true,
      requested_by_user: false,
      from_disconnect_restart: true,
      runtime_generation: 17,
    });
  });

  it('fails bootstrap closed and reports only safe diagnostics when PostgreSQL session refresh fails', async () => {
    const {
      service,
      balanceWorkerStatusGrpcClientService,
      elasticDatabaseService,
    } = makeService();
    const secret =
      'postgres://worker:password@database/session capability-secret qr-payload';
    const reportSecret = 'elastic://report-secret';
    const prepareSession = jest.fn(async () => {
      throw Object.assign(new Error(secret), { code: '42501' });
    });
    const hasSession = jest.fn(() => false);
    const reconnect = jest.fn();

    service.configure({
      getClient: () => undefined,
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
      'wwebjs_bootstrap_session_refresh_failed:42501'
    );

    expect(prepareSession).toHaveBeenCalledTimes(1);
    expect(hasSession).not.toHaveBeenCalled();
    expect(reconnect).not.toHaveBeenCalled();
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        status: Status.disconnected,
        code: ECodeMessage.connectionLost,
        worker_status_id: EWorkerStatus.offline,
        session_ready: false,
        provider_state: 'bootstrap_session_refresh_failed',
        degraded_reason: 'wwebjs_bootstrap_session_refresh_failed:42501',
      })
    );
    expect(service.getReadinessSnapshot()).toMatchObject({
      isHealthy: false,
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.offline,
      provider_state: 'bootstrap_session_refresh_failed',
      degraded_reason: 'wwebjs_bootstrap_session_refresh_failed:42501',
    });
    expect(JSON.stringify(jest.mocked(console.error).mock.calls)).not.toContain(
      secret
    );
    expect(JSON.stringify(jest.mocked(console.error).mock.calls)).not.toContain(
      reportSecret
    );
  });

  it('does not downgrade a connection that becomes current while bootstrap refresh is pending', async () => {
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
    const reconnect = jest.fn();

    service.configure({
      getClient: () => undefined,
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
        runtime_generation: 17,
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
      runtime_generation: 17,
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
    ).resolves.toMatchObject({
      isHealthy: false,
      reason: 'No client instance',
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.offline,
      session_ready: false,
    });

    const secret =
      'postgres://worker:password@database:5432/underchat capability-secret qr-secret session-secret';
    jest
      .spyOn(sut, 'getStateWithTimeout')
      .mockRejectedValueOnce(
        Object.assign(new Error(secret), { code: '57P01' })
      )
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('CONNECTED')
      .mockResolvedValueOnce('CONNECTED')
      .mockResolvedValueOnce('UNPAIRED');

    const stateFailure = await sut.checkConnectivity(
      { info: {} },
      Status.disconnected
    );
    expect(stateFailure).toMatchObject({
      isHealthy: false,
      reason: 'Failed to get state',
      degraded_reason: 'state_probe_failed:57p01',
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.offline,
      session_ready: false,
    });
    expect(JSON.stringify(stateFailure)).not.toContain(secret);

    await expect(
      sut.checkConnectivity({ info: {} }, Status.connecting)
    ).resolves.toMatchObject({
      isHealthy: true,
      reason: 'Connecting (state not yet available)',
      detectedStatus: Status.connecting,
      workerStatus: EWorkerStatus.disponible,
      session_ready: false,
    });

    await expect(
      sut.checkConnectivity({ info: {} }, Status.disconnected)
    ).resolves.toMatchObject({
      isHealthy: false,
      reason: 'State not available',
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.offline,
      session_ready: false,
    });

    await expect(
      sut.checkConnectivity({}, Status.disconnected)
    ).resolves.toMatchObject({
      isHealthy: false,
      reason: 'Connected state but no client info',
      detectedStatus: Status.connecting,
      workerStatus: EWorkerStatus.disponible,
      session_ready: false,
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
    ).resolves.toMatchObject({
      isHealthy: false,
      reason: 'Connected state but event bridge is not attached',
      detectedStatus: Status.connecting,
      workerStatus: EWorkerStatus.disponible,
      session_ready: false,
      degraded_reason: 'event_bridge_not_attached',
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
    ).resolves.toMatchObject({
      isHealthy: false,
      reason: 'Not paired: UNPAIRED',
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.disponible,
      session_ready: false,
    });

    expect(sut.mapWAStateToStatus('OPENING')).toMatchObject({
      isHealthy: true,
      reason: 'State: OPENING',
      detectedStatus: Status.connecting,
      workerStatus: EWorkerStatus.disponible,
    });

    expect(sut.mapWAStateToStatus('PAIRING')).toMatchObject({
      isHealthy: true,
      reason: 'State: PAIRING',
      detectedStatus: Status.connecting,
      workerStatus: EWorkerStatus.disponible,
    });

    expect(sut.mapWAStateToStatus('UNPAIRED_IDLE')).toMatchObject({
      isHealthy: false,
      reason: 'Not paired: UNPAIRED_IDLE',
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.disponible,
    });

    expect(sut.mapWAStateToStatus('CONFLICT')).toMatchObject({
      isHealthy: false,
      reason: 'Session conflict - another device connected',
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.mismatched,
    });

    expect(sut.mapWAStateToStatus('DEPRECATED_VERSION')).toMatchObject({
      isHealthy: false,
      reason: 'Deprecated WhatsApp Web version',
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.mismatched,
    });

    expect(sut.mapWAStateToStatus('TIMEOUT')).toMatchObject({
      isHealthy: false,
      reason: 'Connection timeout',
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.offline,
    });

    expect(sut.mapWAStateToStatus('PROXYBLOCK')).toMatchObject({
      isHealthy: false,
      reason: 'Blocked: PROXYBLOCK',
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.mismatched,
    });

    expect(sut.mapWAStateToStatus('TOS_BLOCK')).toMatchObject({
      isHealthy: false,
      reason: 'Blocked: TOS_BLOCK',
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.mismatched,
    });

    expect(sut.mapWAStateToStatus('SMB_TOS_BLOCK')).toMatchObject({
      isHealthy: false,
      reason: 'Blocked: SMB_TOS_BLOCK',
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.mismatched,
    });

    expect(sut.mapWAStateToStatus('UNLAUNCHED')).toMatchObject({
      isHealthy: false,
      reason: 'Client not launched',
      detectedStatus: Status.disconnected,
      workerStatus: EWorkerStatus.offline,
    });

    expect(sut.mapWAStateToStatus('UNKNOWN' as never)).toMatchObject({
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
    await expect(timeoutPromise).rejects.toThrow(
      'wwebjs auxiliary provider operation health:getState timed out'
    );

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

    expect(centrifugo.publishSub).not.toHaveBeenCalled();
    expect(
      balanceWorkerStatusGrpcClientService.notifyWorkerStatus
    ).toHaveBeenCalled();

    const secret =
      'postgres://worker:password@database:5432/underchat capability-secret qr-secret session-secret';
    balanceWorkerStatusGrpcClientService.notifyWorkerStatus.mockRejectedValueOnce(
      Object.assign(new Error(secret), { code: '57P01' })
    );

    await expect(
      sut.notifyStatusChange(undefined, {
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
