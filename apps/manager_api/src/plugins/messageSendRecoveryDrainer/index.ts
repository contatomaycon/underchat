import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import type Redis from 'ioredis';
import { container } from 'tsyringe';
import { createRedisLeaderElection } from '@/plugins/shared/redisLeaderElection';
import { workerCommandPlaneReadinessRegistry } from '@/plugins/shared/workerCommandPlaneReadiness';
import { MessageSendRecoveryDrainerService } from '@core/services/messageSendRecoveryDrainer.service';

const COMPONENT = 'message_recovery_drainer' as const;
const SUPERVISOR_INTERVAL_MS = 1_000;

const messageSendRecoveryDrainerPlugin: FastifyPluginAsync = async (server) => {
  const redis = container.resolve<Redis>('Redis');
  const drainer = container.resolve(MessageSendRecoveryDrainerService);
  let supervisor: ReturnType<typeof setInterval> | null = null;
  const election = createRedisLeaderElection({
    redis,
    logger: server.log,
    lockKey: 'message-send:recovery-drainer:v4:leader',
    lockTtlSeconds: 30,
    refreshIntervalMs: 10_000,
    onLeaderAcquire: () => {
      workerCommandPlaneReadinessRegistry.markStarting(COMPONENT);
      drainer.start({
        onSuccess: () =>
          workerCommandPlaneReadinessRegistry.recordSuccess(COMPONENT),
        onError: (error: unknown) => {
          workerCommandPlaneReadinessRegistry.recordFailure(COMPONENT, error);
          server.log.error(
            { err: error, type: 'message_send_recovery_drain_failed' },
            'Message-send global recovery failed'
          );
        },
      });
      workerCommandPlaneReadinessRegistry.markRunning(
        COMPONENT,
        drainer.getStatus().running
      );
      supervisor = setInterval(() => {
        workerCommandPlaneReadinessRegistry.markRunning(
          COMPONENT,
          drainer.getStatus().running
        );
      }, SUPERVISOR_INTERVAL_MS);
      supervisor.unref?.();
    },
    onLeaderLose: () => {
      if (supervisor) clearInterval(supervisor);
      supervisor = null;
      drainer.close();
      workerCommandPlaneReadinessRegistry.markRunning(COMPONENT, false);
    },
    onStateChange: (snapshot) =>
      workerCommandPlaneReadinessRegistry.observeElection(COMPONENT, snapshot),
  });

  server.addHook('onListen', () => election.start());
  server.addHook('onClose', () => election.stop());
};

export default fp(messageSendRecoveryDrainerPlugin, {
  name: 'message-send-recovery-drainer',
  dependencies: ['redis', 'kafkaStreams'],
});
