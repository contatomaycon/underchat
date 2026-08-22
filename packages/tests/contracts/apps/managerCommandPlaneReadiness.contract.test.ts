import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import type { JetStreamManager, StreamConfig } from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/transport-node';
import { container } from 'tsyringe';

type Component =
  | 'deferred_relay'
  | 'queued_reconciler'
  | 'deadline_reconciler'
  | 'message_recovery_drainer';

interface ReadinessRegistry {
  observeElection(
    component: Component,
    snapshot: ReturnType<typeof election>
  ): void;
  markRunning(component: Component, running: boolean): void;
  recordSuccess(component: Component): void;
  recordFailure(component: Component, error: unknown): void;
  markNatsReady(component: Component, checkedAt: string): void;
  markNatsFailed(component: Component, error: unknown): void;
  snapshot(): {
    ready: boolean;
    components: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
  reset(): void;
}

interface NatsHealthProbeContract {
  check(contracts: string[]): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

// These sources belong to the manager_api TS project. Runtime require keeps
// this root contract from pulling another composite project's files into the
// root TypeScript file list; manager's own tsc validates their implementation.
const { viewHealth } =
  require('../../../../apps/manager_api/src/controllers/health/methods/viewHealth') as {
    viewHealth(request: unknown, reply: unknown): Promise<unknown>;
  };
const {
  WORKER_COMMAND_PLANE_COMPONENTS,
  WorkerCommandPlaneReadinessRegistry,
  workerCommandPlaneReadinessRegistry,
} =
  require('../../../../apps/manager_api/src/plugins/shared/workerCommandPlaneReadiness') as {
    WORKER_COMMAND_PLANE_COMPONENTS: readonly Component[];
    WorkerCommandPlaneReadinessRegistry: new () => ReadinessRegistry;
    workerCommandPlaneReadinessRegistry: ReadinessRegistry;
  };
const { WorkerCommandNatsHealthProbe } =
  require('../../../../apps/manager_api/src/plugins/shared/workerCommandNatsHealthProbe') as {
    WorkerCommandNatsHealthProbe: new (
      dependencies: Record<string, unknown>
    ) => NatsHealthProbeContract;
  };

function election(
  role: 'electing' | 'leader' | 'standby' | 'stopped',
  healthy = true
) {
  return {
    role,
    running: role !== 'stopped',
    leader: role === 'leader',
    healthy,
    last_checked_at: new Date().toISOString(),
    last_error_at: healthy ? null : new Date().toISOString(),
  } as const;
}

function makeAllStandby(registry: ReadinessRegistry): void {
  for (const component of WORKER_COMMAND_PLANE_COMPONENTS) {
    registry.observeElection(component, election('standby'));
  }
}

function buildReply() {
  const reply = {
    request: { id: 'health-request-1' },
    code: jest.fn(),
    send: jest.fn(),
  };
  reply.code.mockReturnValue(reply);
  return reply;
}

function sentData(
  reply: ReturnType<typeof buildReply>
): Record<string, unknown> {
  return (reply.send.mock.calls[0]?.[0] as { data: Record<string, unknown> })
    .data;
}

describe('manager command-plane readiness', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    workerCommandPlaneReadinessRegistry.reset();
  });

  it('blocks electing/stopped/unhealthy elections and allows only a healthy standby', () => {
    const registry = new WorkerCommandPlaneReadinessRegistry();
    expect(registry.snapshot().ready).toBe(false);

    makeAllStandby(registry);
    expect(registry.snapshot()).toMatchObject({
      ready: true,
      role: 'standby',
      blocking_components: [],
    });

    registry.observeElection('deadline_reconciler', election('standby', false));
    expect(registry.snapshot()).toMatchObject({
      ready: false,
      blocking_components: ['deadline_reconciler'],
    });

    registry.observeElection('deadline_reconciler', election('stopped'));
    expect(registry.snapshot().ready).toBe(false);
  });

  it('requires a leader runtime and every applicable NATS contract snapshot', () => {
    const registry = new WorkerCommandPlaneReadinessRegistry();
    makeAllStandby(registry);
    registry.observeElection('deferred_relay', election('leader'));

    expect(registry.snapshot()).toMatchObject({
      ready: false,
      blocking_components: ['deferred_relay'],
    });

    registry.markRunning('deferred_relay', true);
    expect(registry.snapshot().ready).toBe(false);

    registry.markNatsReady('deferred_relay', new Date().toISOString());
    registry.recordSuccess('deferred_relay');
    expect(registry.snapshot()).toMatchObject({
      ready: true,
      role: 'mixed',
    });

    registry.markNatsFailed(
      'deferred_relay',
      Object.assign(new Error('probe failed'), {
        code: 'WORKER_COMMAND_NATS_PROBE_FAILED',
      })
    );
    const failed = registry.snapshot();
    expect(failed.ready).toBe(false);
    expect(failed.components[0]).toMatchObject({
      state: 'failed',
      failure_count: 1,
      nats: {
        state: 'failed',
        connected: false,
        contract_valid: false,
      },
    });
  });

  it('latches a leader runtime failure until a complete cycle succeeds', () => {
    const registry = new WorkerCommandPlaneReadinessRegistry();
    makeAllStandby(registry);
    registry.observeElection('message_recovery_drainer', election('leader'));
    registry.markRunning('message_recovery_drainer', true);
    registry.recordSuccess('message_recovery_drainer');
    expect(registry.snapshot().ready).toBe(true);

    registry.recordFailure(
      'message_recovery_drainer',
      new Error('continuous downstream failure')
    );
    expect(registry.snapshot()).toMatchObject({
      ready: false,
      blocking_components: ['message_recovery_drainer'],
    });

    registry.recordSuccess('message_recovery_drainer');
    expect(registry.snapshot()).toMatchObject({
      ready: true,
      blocking_components: [],
    });
  });

  it('returns 200 for a healthy standby and includes barrier and telemetry snapshots', async () => {
    makeAllStandby(workerCommandPlaneReadinessRegistry);
    jest.spyOn(container, 'resolve').mockReturnValue({
      getStatus: jest.fn().mockResolvedValue({
        state: 'active',
        generation: 7,
        active_permits: 2,
      }),
    } as never);
    const reply = buildReply();

    await viewHealth({} as never, reply as never);

    expect(reply.code).toHaveBeenCalledWith(200);
    expect(sentData(reply)).toMatchObject({
      ready: true,
      command_plane: { ready: true, role: 'standby' },
      worker_command_operational_barrier: {
        available: true,
        ready: true,
        state: 'active',
        generation: 7,
        active_permits: 2,
      },
      worker_command_telemetry: {
        publish: expect.any(Object),
        deferred: expect.any(Object),
      },
    });
  });

  it('fails closed when the barrier is paused or Redis cannot read it', async () => {
    makeAllStandby(workerCommandPlaneReadinessRegistry);
    const getStatus = jest.fn().mockResolvedValue({
      state: 'paused',
      generation: 8,
      active_permits: 0,
    });
    jest.spyOn(container, 'resolve').mockReturnValue({ getStatus } as never);
    const pausedReply = buildReply();
    await viewHealth({} as never, pausedReply as never);
    expect(pausedReply.code).toHaveBeenCalledWith(503);
    expect(sentData(pausedReply)).toMatchObject({
      ready: false,
      worker_command_operational_barrier: {
        available: true,
        ready: false,
        state: 'paused',
      },
    });

    getStatus.mockRejectedValueOnce(
      Object.assign(new Error('redis unavailable'), { code: 'ECONNREFUSED' })
    );
    const unavailableReply = buildReply();
    await viewHealth({} as never, unavailableReply as never);
    expect(unavailableReply.code).toHaveBeenCalledWith(503);
    expect(sentData(unavailableReply)).toMatchObject({
      ready: false,
      worker_command_operational_barrier: {
        available: false,
        ready: false,
        state: 'unavailable',
        last_error: { error_code: 'econnrefused' },
      },
    });
  });

  it('registers all four leader-aware plugins and observes relay execution failures', () => {
    const pluginRoot = path.resolve(
      process.cwd(),
      'apps/manager_api/src/plugins'
    );
    const files = [
      'workerCommandDeferredRelay/index.ts',
      'workerCommandQueuedReconciler/index.ts',
      'workerCommandDeadlineReconciler/index.ts',
      'messageSendRecoveryDrainer/index.ts',
    ].map((file) => fs.readFileSync(path.join(pluginRoot, file), 'utf8'));

    for (const source of files) {
      expect(source).toContain('observeElection(COMPONENT, snapshot)');
      expect(source).toContain('markRunning');
      expect(source).toContain('recordFailure');
      expect(source).toContain('recordSuccess');
    }
    expect(files[0]).toContain('await relay.execute()');
    expect(files[0]).toContain('relay.health()');
  });
});

describe('manager NATS contract probe', () => {
  const loadStream = (name: string): StreamConfig =>
    JSON.parse(
      fs.readFileSync(
        path.resolve(process.cwd(), `infra/nats/streams/${name}.json`),
        'utf8'
      )
    ) as StreamConfig;

  const configurations: Record<string, StreamConfig> = {
    UC_WORKER_COMMANDS_V1: loadStream('worker-commands'),
    UC_WORKER_DEFERRED_V1: loadStream('worker-deferred'),
    UC_WORKER_FAILURES_V1: loadStream('worker-failures'),
    KV_UC_WORKER_EPOCH_V1: {
      name: 'KV_UC_WORKER_EPOCH_V1',
      subjects: ['$KV.UC_WORKER_EPOCH_V1.>'],
      retention: 'limits',
      storage: 'file',
      compression: 's2',
      num_replicas: 3,
      max_msgs_per_subject: 1,
      max_age: 0,
      max_bytes: 64 * 1024 * 1024,
      max_msg_size: 1024,
    } as StreamConfig,
  };

  function buildProbe(overrides: Partial<Record<string, StreamConfig>> = {}) {
    const connection = {
      isClosed: jest.fn().mockReturnValue(false),
      closed: jest.fn().mockReturnValue(new Promise<void>(() => undefined)),
      drain: jest.fn().mockResolvedValue(undefined),
    } as unknown as NatsConnection;
    const info = jest.fn(async (stream: string) => ({
      config: overrides[stream] ?? configurations[stream],
    }));
    const manager = { streams: { info } } as unknown as JetStreamManager;
    const probe = new WorkerCommandNatsHealthProbe({
      options: () => ({ servers: ['nats://127.0.0.1:4222'] }),
      connect: jest.fn().mockResolvedValue(connection),
      manager: jest.fn().mockResolvedValue(manager),
      now: () => new Date('2026-08-13T12:00:00.000Z'),
    });
    return { probe, info };
  }

  it('checks every stream/KV contract and returns a cached-ready payload', async () => {
    const { probe, info } = buildProbe();
    await expect(
      probe.check(['commands', 'deferred', 'failures', 'epoch'])
    ).resolves.toEqual({
      connected: true,
      contract_valid: true,
      contracts: ['commands', 'deferred', 'epoch', 'failures'],
      checked_at: '2026-08-13T12:00:00.000Z',
    });
    expect(info).toHaveBeenCalledTimes(4);
    await probe.close();
  });

  it('rejects stream drift instead of declaring the leader ready', async () => {
    const drifted = {
      ...configurations.UC_WORKER_COMMANDS_V1,
      num_replicas: 1,
    } as StreamConfig;
    const { probe } = buildProbe({ UC_WORKER_COMMANDS_V1: drifted });
    await expect(probe.check(['commands'])).rejects.toThrow(
      'worker_command_commands_stream_contract_drift'
    );
    await probe.close();
  });
});
