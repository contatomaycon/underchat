import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import type Redis from 'ioredis';
import { container } from 'tsyringe';
import { createRedisLeaderElection } from '@/plugins/shared/redisLeaderElection';
import {
  createWorkerCommandNatsMonitor,
  workerCommandPlaneReadinessRegistry,
} from '@/plugins/shared/workerCommandPlaneReadiness';
import { WorkerCommandQueuedReconcilerService } from '@core/services/workerCommandQueuedReconciler.service';

const COMPONENT = 'queued_reconciler' as const;
const SUPERVISOR_INTERVAL_MS = 1_000;

const workerCommandQueuedReconcilerPlugin: FastifyPluginAsync = async (
  server
) => {
  const redis = container.resolve<Redis>('Redis');
  const reconciler = container.resolve(WorkerCommandQueuedReconcilerService);
  const natsMonitor = createWorkerCommandNatsMonitor({
    component: COMPONENT,
    contracts: ['commands', 'epoch'],
    logger: server.log,
  });
  let supervisor: ReturnType<typeof setInterval> | null = null;
  const election = createRedisLeaderElection({
    redis,
    logger: server.log,
    lockKey: 'worker-command:queued-reconciler:v1:leader',
    lockTtlSeconds: 30,
    refreshIntervalMs: 10_000,
    onLeaderAcquire: () => {
      workerCommandPlaneReadinessRegistry.markStarting(COMPONENT);
      reconciler.start({
        onSuccess: () =>
          workerCommandPlaneReadinessRegistry.recordSuccess(COMPONENT),
        onError: (error: unknown) => {
          workerCommandPlaneReadinessRegistry.recordFailure(COMPONENT, error);
          server.log.error(
            { err: error, type: 'worker_command_queued_reconcile_failed' },
            'Worker command queued reconciliation failed'
          );
        },
      });
      workerCommandPlaneReadinessRegistry.markRunning(
        COMPONENT,
        reconciler.getStatus().running
      );
      natsMonitor.start();
      supervisor = setInterval(() => {
        workerCommandPlaneReadinessRegistry.markRunning(
          COMPONENT,
          reconciler.getStatus().running
        );
      }, SUPERVISOR_INTERVAL_MS);
      supervisor.unref?.();
    },
    onLeaderLose: async () => {
      natsMonitor.stop();
      if (supervisor) clearInterval(supervisor);
      supervisor = null;
      await reconciler.close();
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

export default fp(workerCommandQueuedReconcilerPlugin, {
  name: 'worker-command-queued-reconciler',
  dependencies: ['redis', 'databaseElastic'],
});
