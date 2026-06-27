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

  it('does not request self-heal while healthy and clears pending recovery', async () => {
    const deps = buildMonitor();
    deps.store.set(
      'worker:self-heal:recovery:worker-1',
      JSON.stringify({
        worker_id: 'worker-1',
        requested_at: new Date().toISOString(),
        deadline_at: new Date(Date.now() + 60_000).toISOString(),
        recovery_window_seconds: 600,
      })
    );
    deps.start({
      getReadiness: async () => ({
        session_ready: true,
        can_send: true,
        can_receive_runtime: true,
        authenticated: true,
        provider_state: 'connected',
      }),
    });

    await deps.monitor.runOnce();

    expect(deps.store.has('worker:self-heal:recovery:worker-1')).toBe(false);
    expect(deps.balance.requestWorkerSelfHealing).not.toHaveBeenCalled();
    deps.monitor.stop();
  });

  it('publishes offline when recovery deadline expires without healthy runtime', async () => {
    const deps = buildMonitor();
    deps.store.set(
      'worker:self-heal:recovery:worker-1',
      JSON.stringify({
        worker_id: 'worker-1',
        requested_at: new Date(Date.now() - 900_000).toISOString(),
        deadline_at: new Date(Date.now() - 60_000).toISOString(),
        recovery_window_seconds: 600,
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
    expect(deps.store.has('worker:self-heal:recovery:worker-1')).toBe(false);
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

  it('uses WORKER_DAILY_MAINTENANCE_HOUR for the daily maintenance window', async () => {
    const previousHour = process.env.WORKER_DAILY_MAINTENANCE_HOUR;
    process.env.WORKER_DAILY_MAINTENANCE_HOUR = '3';
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-27T03:15:00.000Z'));
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
      jest.useRealTimers();
    }
  });

  it('defaults daily maintenance to 02:00 when no env is configured', async () => {
    const previousHour = process.env.WORKER_DAILY_MAINTENANCE_HOUR;
    delete process.env.WORKER_DAILY_MAINTENANCE_HOUR;
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
        }),
      });

      await deps.monitor.runOnce();

      expect(deps.balance.requestWorkerSelfHealing).toHaveBeenCalledWith(
        expect.objectContaining({
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
      jest.useRealTimers();
    }
  });
});
