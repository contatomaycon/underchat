import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { PresenceCentrifugoConsume } from '@core/consumer/presence/PresenceCentrifugo.consume';
import { createRedisLeaderElection } from '@/plugins/shared/redisLeaderElection';

const presenceCentrifugoPlugin = async (fastify: FastifyInstance) => {
  try {
    const presenceConsumer = container.resolve(PresenceCentrifugoConsume);
    const election = createRedisLeaderElection({
      redis: fastify.Redis,
      logger: fastify.log,
      lockKey: 'leader:manager:presence-centrifugo-consumer',
      onLeaderAcquire: async () => {
        await presenceConsumer.start();
      },
      onLeaderLose: async () => {
        await presenceConsumer.stop();
      },
    });

    election.start();

    fastify.addHook('onClose', async () => {
      await election.stop();
    });
  } catch (error) {
    fastify.log.error(error, 'Failed to start presence Centrifugo consumer');
  }
};

export default fp(presenceCentrifugoPlugin, { name: 'presence-centrifugo' });
