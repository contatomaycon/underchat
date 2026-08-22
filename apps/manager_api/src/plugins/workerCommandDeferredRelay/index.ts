import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import type Redis from 'ioredis';
import { container } from 'tsyringe';
import { createRedisLeaderElection } from '@/plugins/shared/redisLeaderElection';
import {
  createWorkerCommandNatsMonitor,
  workerCommandPlaneReadinessRegistry,
} from '@/plugins/shared/workerCommandPlaneReadiness';
import { WorkerCommandDeferredRelayService } from '@core/services/workerCommandDeferredRelay.service';
import { WorkerCommandOperationalBarrierService } from '@core/services/workerCommandOperationalBarrier.service';

const SUPERVISOR_INTERVAL_MS = 1_000;
const COMPONENT = 'deferred_relay' as const;

const workerCommandDeferredRelayPlugin: FastifyPluginAsync = async (server) => {
  const redis = container.resolve<Redis>('Redis');
  const barrier = container.resolve(WorkerCommandOperationalBarrierService);
  const relay = new WorkerCommandDeferredRelayService(
    undefined,
    undefined,
    barrier
  );
  const natsMonitor = createWorkerCommandNatsMonitor({
    component: COMPONENT,
    contracts: ['commands', 'deferred', 'failures'],
    logger: server.log,
  });
  let supervisor: ReturnType<typeof setInterval> | null = null;
  let starting = false;
  let observedRelayError = '';

  const ensureRunning = async (): Promise<void> => {
    if (starting) return;
    starting = true;
    try {
      const barrierStatus = await barrier.getStatus();
      if (barrierStatus.state !== 'active') {
        if (relay.health().running) await relay.close();
        workerCommandPlaneReadinessRegistry.markRunning(COMPONENT, false);
        return;
      }
      const health = relay.health();
      workerCommandPlaneReadinessRegistry.markRunning(
        COMPONENT,
        health.running && health.connected
      );
      if (health.running && health.connected && !health.last_error) {
        workerCommandPlaneReadinessRegistry.recordSuccess(COMPONENT);
      }
      if (health.last_error && health.last_error !== observedRelayError) {
        observedRelayError = health.last_error;
        workerCommandPlaneReadinessRegistry.recordFailure(
          COMPONENT,
          Object.assign(
            new Error('worker_command_deferred_relay_loop_failed'),
            { code: 'WORKER_COMMAND_DEFERRED_RELAY_LOOP_FAILED' }
          )
        );
      }
      if (health.running) return;
      workerCommandPlaneReadinessRegistry.markStarting(COMPONENT);
      await relay.execute();
      const started = relay.health();
      workerCommandPlaneReadinessRegistry.markRunning(
        COMPONENT,
        started.running && started.connected
      );
      if (started.running && started.connected && !started.last_error) {
        workerCommandPlaneReadinessRegistry.recordSuccess(COMPONENT);
      }
    } catch (error) {
      if (relay.health().running) await relay.close().catch(() => undefined);
      workerCommandPlaneReadinessRegistry.markRunning(COMPONENT, false);
      workerCommandPlaneReadinessRegistry.recordFailure(COMPONENT, error);
      server.log.error(
        { err: error, type: 'worker_command_deferred_relay_start_failed' },
        'Deferred worker-command relay failed to start'
      );
    } finally {
      starting = false;
    }
  };

  const election = createRedisLeaderElection({
    redis,
    logger: server.log,
    lockKey: 'worker-command:deferred-relay:v1:leader',
    lockTtlSeconds: 30,
    refreshIntervalMs: 10_000,
    onLeaderAcquire: () => {
      natsMonitor.start();
      void ensureRunning();
      supervisor = setInterval(
        () => void ensureRunning(),
        SUPERVISOR_INTERVAL_MS
      );
      supervisor.unref?.();
    },
    onLeaderLose: async () => {
      natsMonitor.stop();
      if (supervisor) {
        clearInterval(supervisor);
        supervisor = null;
      }
      await relay.close();
      workerCommandPlaneReadinessRegistry.markRunning(COMPONENT, false);
    },
    onStateChange: (snapshot) =>
      workerCommandPlaneReadinessRegistry.observeElection(COMPONENT, snapshot),
  });

  server.addHook('onListen', () => election.start());
  server.addHook('onClose', async () => {
    natsMonitor.stop();
    await election.stop();
  });
};

export default fp(workerCommandDeferredRelayPlugin, {
  name: 'worker-command-deferred-relay',
  dependencies: ['redis'],
});
