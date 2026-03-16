import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { PresenceService } from '@core/services/presence.service';
import { createRedisLeaderElection } from '@/plugins/shared/redisLeaderElection';

const presenceMonitorPlugin = async (fastify: FastifyInstance) => {
  try {
    const presenceService = container.resolve(PresenceService);
    const election = createRedisLeaderElection({
      redis: fastify.Redis,
      logger: fastify.log,
      lockKey: 'leader:manager:presence-monitor',
      onLeaderAcquire: () => {
        presenceService.startMonitoring();
      },
      onLeaderLose: () => {
        presenceService.stopMonitoring();
      },
    });

    election.start();

    fastify.addHook('onClose', async () => {
      await election.stop();
    });
  } catch (error) {
    fastify.log.error(error, 'Failed to start presence monitor');
  }
};

export default fp(presenceMonitorPlugin, { name: 'presence-monitor' });
