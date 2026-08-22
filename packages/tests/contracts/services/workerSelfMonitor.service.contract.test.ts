import 'reflect-metadata';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { WorkerSelfMonitorService } from '@core/services/workerSelfMonitor.service';

function buildRedis() {
  const store = new Map<string, string>();
  const redis = {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && store.has(key)) {
        return null;
      }
      store.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async (...keys: string[]) => {
      let deleted = 0;
      for (const key of keys) {
        if (store.delete(key)) {
          deleted += 1;
        }
      }
      return deleted;
    }),
  };

  return { redis, store };
}

function buildMonitor() {
  const { redis, store } = buildRedis();
  const balance = {
    requestWorkerSelfHealing: jest.fn(async () => undefined),
    notifyWorkerStatus: jest.fn(async () => undefined),
  };
  const monitor = new WorkerSelfMonitorService(
    redis as never,
    balance as never
  );

  const start = (overrides: Partial<Parameters<typeof monitor.start>[0]>) => {
    monitor.start({
      provider: EWorkerType.wwebjs,
      workerId: 'worker-1',
      accountId: 'account-1',
      workerTypeId: EWorkerType.wwebjs,
      runtimeGeneration: 3,
      intervalMs: 60 * 60 * 1000,
      initialDelayMs: 60 * 60 * 1000,
      failureThreshold: 2,
      recoveryWindowSeconds: 600,
      dailyMaintenanceHour: 25,
      getReadiness: async () => ({
        session_ready: true,
        can_send: false,
        can_receive_runtime: true,
        authenticated: true,
        provider_state: 'connected',
        degraded_reason: 'send_probe_failed',
      }),
      hasUnhealthyKafkaConsumer: () => false,
      ...overrides,
    });
  };

  return { monitor, balance, redis, store, start };
}

describe('WorkerSelfMonitorService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('requests self-heal after consecutive unhealthy checks', async () => {
    const deps = buildMonitor();
    deps.start({});

    await deps.monitor.runOnce();
    expect(deps.balance.requestWorkerSelfHealing).not.toHaveBeenCalled();

    await deps.monitor.runOnce();
    expect(deps.balance.requestWorkerSelfHealing).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        source: 'health_monitor',
        reason: 'send_probe_failed',
        recovery_window_seconds: 600,
      })
    );

    deps.monitor.stop();
  });

  it('continues self-heal evaluation when Redis recovery coordination is unavailable', async () => {
    const deps = buildMonitor();
    deps.redis.get.mockRejectedValue(new Error('redis unavailable'));
    deps.start({ failureThreshold: 1 });

    await deps.monitor.runOnce();

    expect(deps.balance.requestWorkerSelfHealing).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: 'worker-1',
        source: 'health_monitor',
        reason: 'send_probe_failed',
      })
    );
    deps.monitor.stop();
  });

  it('never exposes coordination or readiness secrets in worker logs', async () => {
    const deps = buildMonitor();
    const secret =
      'postgres://worker:password@database:5432/underchat capability-secret qr-secret session-secret';
    const log = {
      warn: jest.fn(),
      error: jest.fn(),
    };
    deps.redis.get.mockRejectedValue(
      Object.assign(new Error(secret), { code: 'ECONNRESET' })
    );
    deps.start({
      failureThreshold: 99,
      log,
      getReadiness: async () => {
        throw Object.assign(new Error(secret), { code: '57P01' });
      },
    });

    await deps.monitor.runOnce();

    const serializedLogs = JSON.stringify({
      warn: log.warn.mock.calls,
      error: log.error.mock.calls,
    });
    expect(serializedLogs).not.toContain(secret);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        error_name: 'error',
        error_code: '57p01',
      }),
      'Worker readiness probe failed'
    );
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'recovery_window',
        error_name: 'error',
        error_code: 'econnreset',
      }),
      'Worker self monitor coordination failed; local health evaluation continues'
    );
    deps.monitor.stop();
  });

  it('bounds a stuck readiness provider and self-heals from retained session evidence', async () => {
    const deps = buildMonitor();
    let readinessCalls = 0;
    deps.start({
      failureThreshold: 1,
      readinessTimeoutMs: 10,
      getReadiness: async () => {
        readinessCalls += 1;
        if (readinessCalls === 1) {
          return {
            session_ready: true,
            can_send: true,
            can_receive_runtime: true,
            authenticated: true,
            provider_state: 'connected',
            phone: '556192037138',
          };
        }
        return new Promise<never>(() => undefined);
      },
    });

    await deps.monitor.runOnce();
    await deps.monitor.runOnce();
    await deps.monitor.runOnce();

    expect(deps.balance.requestWorkerSelfHealing).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: 'worker-1',
        source: 'health_monitor',
        reason: 'readiness_probe_failed',
      })
    );
    expect(readinessCalls).toBe(2);
    deps.monitor.stop();
  });

  it('retains a previously active session across getState timeouts and self-heals', async () => {
    const deps = buildMonitor();
    const readinessSequence = [
      {
        session_ready: true,
        can_send: true,
        can_receive_runtime: true,
        authenticated: true,
        provider_state: 'CONNECTED',
        phone: '556192037138',
      },
      {
        session_ready: false,
        can_send: false,
        can_receive_runtime: false,
        authenticated: false,
        provider_state: 'state_error',
        degraded_reason: 'getState_timeout',
        reason: 'Failed to get state: WWebJS getState timeout after 10000ms',
      },
      {
        session_ready: false,
        can_send: false,
        can_receive_runtime: false,
        authenticated: false,
        provider_state: 'state_error',
        degraded_reason: 'getState_timeout',
        reason: 'Failed to get state: WWebJS getState timeout after 10000ms',
      },
    ];
    let readinessIndex = 0;
    deps.start({
      failureThreshold: 2,
      getReadiness: async () =>
        readinessSequence[
          Math.min(readinessIndex++, readinessSequence.length - 1)
        ],
    });

    await deps.monitor.runOnce();
    await deps.monitor.runOnce();
    expect(deps.balance.requestWorkerSelfHealing).not.toHaveBeenCalled();

    await deps.monitor.runOnce();

    expect(deps.balance.requestWorkerSelfHealing).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'health_monitor',
        reason: 'getState_timeout',
        authenticated: false,
      })
    );
    deps.monitor.stop();
  });

  it('self-heals a Baileys missing socket only when its retained session is recoverable', async () => {
    const deps = buildMonitor();
    const readinessSequence = [
      {
        session_ready: true,
        can_send: true,
        can_receive_runtime: true,
        authenticated: true,
        provider_state: 'open',
        phone: '556192037138',
        recoverable_session: true,
      },
      {
        session_ready: false,
        can_send: false,
        can_receive_runtime: false,
        authenticated: false,
        provider_state: 'missing_socket',
        degraded_reason: 'No socket instance',
        recoverable_session: true,
      },
      {
        session_ready: false,
        can_send: false,
        can_receive_runtime: false,
        authenticated: false,
        provider_state: 'missing_socket',
        degraded_reason: 'No socket instance',
        recoverable_session: true,
      },
    ];
    let readinessIndex = 0;
    deps.start({
      provider: EWorkerType.baileys,
      workerTypeId: EWorkerType.baileys,
      failureThreshold: 2,
      getReadiness: async () =>
        readinessSequence[
          Math.min(readinessIndex++, readinessSequence.length - 1)
        ],
    });

    await deps.monitor.runOnce();
    await deps.monitor.runOnce();
    expect(deps.balance.requestWorkerSelfHealing).not.toHaveBeenCalled();

    await deps.monitor.runOnce();

    expect(deps.balance.requestWorkerSelfHealing).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_type_id: EWorkerType.baileys,
        source: 'health_monitor',
        reason: 'No socket instance',
        provider_state: 'missing_socket',
        authenticated: false,
      })
    );
    deps.monitor.stop();
  });

  it('does not self-heal a missing socket after an explicit Baileys disconnect', async () => {
    const deps = buildMonitor();
    const readinessSequence = [
      {
        session_ready: true,
        can_send: true,
        can_receive_runtime: true,
        authenticated: true,
        provider_state: 'open',
        phone: '556192037138',
        recoverable_session: true,
      },
      {
        session_ready: false,
        can_send: false,
        can_receive_runtime: false,
        authenticated: false,
        provider_state: 'missing_socket',
        degraded_reason: 'No socket instance',
        recoverable_session: false,
      },
    ];
    let readinessIndex = 0;
    deps.start({
      provider: EWorkerType.baileys,
      workerTypeId: EWorkerType.baileys,
      failureThreshold: 1,
      getReadiness: async () =>
        readinessSequence[
          Math.min(readinessIndex++, readinessSequence.length - 1)
        ],
    });

    await deps.monitor.runOnce();
    await deps.monitor.runOnce();
    await deps.monitor.runOnce();

    expect(deps.balance.requestWorkerSelfHealing).not.toHaveBeenCalled();
    deps.monitor.stop();
  });

  it('self-heals a definitely closed provider runtime when its persisted session remains recoverable', async () => {
    const deps = buildMonitor();
    deps.start({
      provider: EWorkerType.baileys,
      workerTypeId: EWorkerType.baileys,
      failureThreshold: 1,
      getReadiness: async () => ({
        session_ready: false,
        can_send: false,
        can_receive_runtime: false,
        authenticated: false,
        provider_state: 'closed',
        degraded_reason: 'WebSocket client state: CLOSED',
        recoverable_session: true,
      }),
    });

    await deps.monitor.runOnce();

    expect(deps.balance.requestWorkerSelfHealing).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_type_id: EWorkerType.baileys,
        source: 'health_monitor',
        provider_state: 'closed',
      })
    );
    deps.monitor.stop();
  });

  it('does not self-heal a closed provider runtime without recoverable session evidence', async () => {
    const deps = buildMonitor();
    deps.start({
      provider: EWorkerType.baileys,
      workerTypeId: EWorkerType.baileys,
      failureThreshold: 1,
      getReadiness: async () => ({
        session_ready: false,
        can_send: false,
        can_receive_runtime: false,
        authenticated: false,
        provider_state: 'closed',
        degraded_reason: 'WebSocket client state: CLOSED',
        recoverable_session: false,
      }),
    });

    await deps.monitor.runOnce();

    expect(deps.balance.requestWorkerSelfHealing).not.toHaveBeenCalled();
    deps.monitor.stop();
  });

  it('does not infer an active session from probe failures alone', async () => {
    const deps = buildMonitor();
    deps.start({
      failureThreshold: 1,
      getReadiness: async () => ({
        session_ready: false,
        can_send: false,
        can_receive_runtime: false,
        authenticated: false,
        provider_state: 'state_error',
        degraded_reason: 'getState_timeout',
      }),
    });

    await deps.monitor.runOnce();
    await deps.monitor.runOnce();

    expect(deps.balance.requestWorkerSelfHealing).not.toHaveBeenCalled();
    expect(
      (deps.monitor as unknown as { consecutiveFailures: number })
        .consecutiveFailures
    ).toBe(0);
    deps.monitor.stop();
  });

  it('clears retained session evidence after a definitive disconnect', async () => {
    const deps = buildMonitor();
    const readinessSequence = [
      {
        session_ready: true,
        can_send: true,
        can_receive_runtime: true,
        authenticated: true,
        provider_state: 'CONNECTED',
        phone: '556192037138',
      },
      {
        session_ready: false,
        can_send: false,
        can_receive_runtime: false,
        authenticated: false,
        provider_state: 'disconnected',
        degraded_reason: 'connection_closed',
      },
      {
        session_ready: false,
        can_send: false,
        can_receive_runtime: false,
        authenticated: false,
        provider_state: 'state_error',
        degraded_reason: 'getState_timeout',
      },
    ];
    let readinessIndex = 0;
    deps.start({
      failureThreshold: 1,
      getReadiness: async () =>
        readinessSequence[
          Math.min(readinessIndex++, readinessSequence.length - 1)
        ],
    });

    await deps.monitor.runOnce();
    await deps.monitor.runOnce();
    await deps.monitor.runOnce();

    expect(deps.balance.requestWorkerSelfHealing).not.toHaveBeenCalled();
    deps.monitor.stop();
  });

  it('does not request self-heal while a worker connection is launching', async () => {
    const deps = buildMonitor();
    deps.start({
      failureThreshold: 1,
      getReadiness: async () => ({
        session_ready: false,
        can_send: false,
        can_receive_runtime: false,
        authenticated: false,
        provider_state: 'client_launching',
        degraded_reason: 'connection_launching',
      }),
    });

    await deps.monitor.runOnce();

    expect(deps.balance.requestWorkerSelfHealing).not.toHaveBeenCalled();
    expect(
      (deps.monitor as unknown as { consecutiveFailures: number })
        .consecutiveFailures
    ).toBe(0);
    deps.monitor.stop();
  });

  it('does not request self-heal while healthy and retains recovery for manager fencing', async () => {
    const deps = buildMonitor();
    deps.store.set(
      'worker:self-heal:recovery:worker-1',
      JSON.stringify({
        worker_id: 'worker-1',
        requested_at: new Date().toISOString(),
        deadline_at: new Date(Date.now() + 60_000).toISOString(),
        recovery_window_seconds: 600,
        runtime_generation: 3,
      })
    );
    deps.start({
      getReadiness: async () => ({
        session_ready: true,
        can_send: true,
        can_receive_runtime: true,
        authenticated: true,
        provider_state: 'connected',
        phone: '556192037138',
      }),
    });

    await deps.monitor.runOnce();

    expect(deps.store.has('worker:self-heal:recovery:worker-1')).toBe(true);
    expect(deps.balance.requestWorkerSelfHealing).not.toHaveBeenCalled();
    deps.monitor.stop();
  });

  it('publishes offline without locally deleting recovery when its deadline expires', async () => {
    const deps = buildMonitor();
    deps.store.set(
      'worker:self-heal:recovery:worker-1',
      JSON.stringify({
        worker_id: 'worker-1',
        requested_at: new Date(Date.now() - 900_000).toISOString(),
        deadline_at: new Date(Date.now() - 60_000).toISOString(),
        recovery_window_seconds: 600,
        runtime_generation: 3,
      })
    );
    deps.start({ failureThreshold: 99 });

    await deps.monitor.runOnce();

    expect(deps.balance.notifyWorkerStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: 'worker-1',
        account_id: 'account-1',
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.offline,
        degraded_reason: 'self_heal_recovery_timeout',
        session_ready: false,
        can_send: false,
        can_receive_runtime: false,
        authenticated: false,
      })
    );
    expect(deps.store.has('worker:self-heal:recovery:worker-1')).toBe(true);
    deps.monitor.stop();
  });

  it('treats persistent Kafka degradation as self-heal eligible', async () => {
    const deps = buildMonitor();
    deps.start({
      failureThreshold: 1,
      getReadiness: async () => ({
        session_ready: true,
        can_send: true,
        can_receive_runtime: true,
        authenticated: true,
        provider_state: 'connected',
        phone: '556192037138',
      }),
      hasUnhealthyKafkaConsumer: () => true,
    });

    await deps.monitor.runOnce();

    expect(deps.balance.requestWorkerSelfHealing).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'health_monitor',
        reason: 'kafka_unhealthy',
        kafka_unhealthy: true,
      })
    );
    deps.monitor.stop();
  });

  it('does not escalate Kafka startup health without an active authenticated session', async () => {
    const deps = buildMonitor();
    deps.start({
      failureThreshold: 1,
      getReadiness: async () => ({
        session_ready: false,
        can_send: false,
        can_receive_runtime: false,
        authenticated: false,
        provider_state: 'not_initialized',
        degraded_reason: 'runtime_not_initialized',
      }),
      hasUnhealthyKafkaConsumer: () => true,
    });

    await deps.monitor.runOnce();
    await deps.monitor.runOnce();

    expect(deps.balance.requestWorkerSelfHealing).not.toHaveBeenCalled();
    expect(
      (deps.monitor as unknown as { consecutiveFailures: number })
        .consecutiveFailures
    ).toBe(0);
    deps.monitor.stop();
  });

  it('does not escalate a stale authenticated flag for a disconnected session', async () => {
    const deps = buildMonitor();
    deps.start({
      failureThreshold: 1,
      getReadiness: async () => ({
        session_ready: true,
        can_send: false,
        can_receive_runtime: false,
        authenticated: true,
        provider_state: 'disconnected',
        degraded_reason: 'connection_closed',
        phone: '556192037138',
      }),
      hasUnhealthyKafkaConsumer: () => true,
    });

    await deps.monitor.runOnce();

    expect(deps.balance.requestWorkerSelfHealing).not.toHaveBeenCalled();
    deps.monitor.stop();
  });

  it('self-heals a structurally healthy runtime when dispatch authorization stalls past the grace window', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-31T15:00:00.000Z'));
    const deps = buildMonitor();
    const isKafkaDispatchAuthorized = jest.fn(() => false);

    try {
      deps.start({
        failureThreshold: 1,
        dispatchAuthorizationGraceMs: 1_000,
        isKafkaDispatchAuthorized,
        getReadiness: async () => ({
          session_ready: true,
          can_send: true,
          can_receive_runtime: true,
          authenticated: true,
          provider_state: 'connected',
          phone: '556192037138',
        }),
      });

      await deps.monitor.runOnce();
      expect(deps.balance.requestWorkerSelfHealing).not.toHaveBeenCalled();

      jest.advanceTimersByTime(999);
      await deps.monitor.runOnce();
      expect(deps.balance.requestWorkerSelfHealing).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      await deps.monitor.runOnce();

      expect(deps.balance.requestWorkerSelfHealing).toHaveBeenCalledWith(
        expect.objectContaining({
          worker_id: 'worker-1',
          source: 'health_monitor',
          reason: 'dispatch_authorization_stalled',
          session_ready: false,
          can_send: false,
          can_receive_runtime: false,
          authenticated: true,
          kafka_unhealthy: false,
        })
      );
    } finally {
      deps.monitor.stop();
      jest.useRealTimers();
    }
  });

  it('resets the dispatch-authorization grace window after authorization recovers', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-31T15:00:00.000Z'));
    const deps = buildMonitor();
    let authorized = false;

    try {
      deps.start({
        failureThreshold: 1,
        dispatchAuthorizationGraceMs: 1_000,
        isKafkaDispatchAuthorized: () => authorized,
        getReadiness: async () => ({
          session_ready: true,
          can_send: true,
          can_receive_runtime: true,
          authenticated: true,
          provider_state: 'connected',
          phone: '556192037138',
        }),
      });

      await deps.monitor.runOnce();
      jest.advanceTimersByTime(900);
      authorized = true;
      await deps.monitor.runOnce();

      authorized = false;
      jest.advanceTimersByTime(900);
      await deps.monitor.runOnce();

      expect(deps.balance.requestWorkerSelfHealing).not.toHaveBeenCalled();
    } finally {
      deps.monitor.stop();
      jest.useRealTimers();
    }
  });

  it('ignores recovery state owned by another runtime generation', async () => {
    const deps = buildMonitor();
    deps.store.set(
      'worker:self-heal:recovery:worker-1',
      JSON.stringify({
        worker_id: 'worker-1',
        requested_at: new Date(Date.now() - 900_000).toISOString(),
        deadline_at: new Date(Date.now() - 60_000).toISOString(),
        recovery_window_seconds: 600,
        runtime_generation: 2,
      })
    );
    deps.start({ failureThreshold: 99 });

    await deps.monitor.runOnce();

    expect(deps.balance.notifyWorkerStatus).not.toHaveBeenCalled();
    expect(deps.store.has('worker:self-heal:recovery:worker-1')).toBe(true);
    deps.monitor.stop();
  });

  it('uses WORKER_DAILY_MAINTENANCE_HOUR with HH:mm for the daily maintenance window', async () => {
    const previousHour = process.env.WORKER_DAILY_MAINTENANCE_HOUR;
    const previousTime = process.env.WORKER_DAILY_MAINTENANCE_TIME;
    process.env.WORKER_DAILY_MAINTENANCE_HOUR = '13:40';
    delete process.env.WORKER_DAILY_MAINTENANCE_TIME;
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-27T13:40:00.000Z'));
    const deps = buildMonitor();

    try {
      deps.start({
        dailyMaintenanceHour: undefined,
        dailyMaintenanceEnabled: true,
        timeZone: 'UTC',
        getReadiness: async () => ({
          session_ready: true,
          can_send: true,
          can_receive_runtime: true,
          authenticated: true,
          provider_state: 'connected',
          phone: '556192037138',
        }),
      });

      await deps.monitor.runOnce();

      expect(deps.balance.requestWorkerSelfHealing).toHaveBeenCalledWith(
        expect.objectContaining({
          worker_id: 'worker-1',
          account_id: 'account-1',
          worker_type_id: EWorkerType.wwebjs,
          source: 'daily_maintenance',
        })
      );
    } finally {
      deps.monitor.stop();
      if (previousHour === undefined) {
        delete process.env.WORKER_DAILY_MAINTENANCE_HOUR;
      } else {
        process.env.WORKER_DAILY_MAINTENANCE_HOUR = previousHour;
      }
      if (previousTime === undefined) {
        delete process.env.WORKER_DAILY_MAINTENANCE_TIME;
      } else {
        process.env.WORKER_DAILY_MAINTENANCE_TIME = previousTime;
      }
      jest.useRealTimers();
    }
  });

  it('keeps daily maintenance disabled by default', async () => {
    const previousHour = process.env.WORKER_DAILY_MAINTENANCE_HOUR;
    const previousTime = process.env.WORKER_DAILY_MAINTENANCE_TIME;
    delete process.env.WORKER_DAILY_MAINTENANCE_HOUR;
    delete process.env.WORKER_DAILY_MAINTENANCE_TIME;
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-27T02:15:00.000Z'));
    const deps = buildMonitor();

    try {
      deps.start({
        dailyMaintenanceHour: undefined,
        timeZone: 'UTC',
        getReadiness: async () => ({
          session_ready: true,
          can_send: true,
          can_receive_runtime: true,
          authenticated: true,
          provider_state: 'connected',
          phone: '556192037138',
        }),
      });

      await deps.monitor.runOnce();

      expect(deps.balance.requestWorkerSelfHealing).not.toHaveBeenCalled();
    } finally {
      deps.monitor.stop();
      if (previousHour === undefined) {
        delete process.env.WORKER_DAILY_MAINTENANCE_HOUR;
      } else {
        process.env.WORKER_DAILY_MAINTENANCE_HOUR = previousHour;
      }
      if (previousTime === undefined) {
        delete process.env.WORKER_DAILY_MAINTENANCE_TIME;
      } else {
        process.env.WORKER_DAILY_MAINTENANCE_TIME = previousTime;
      }
      jest.useRealTimers();
    }
  });
});
