import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { PresenceCentrifugoConsume } from '@core/consumer/presence/PresenceCentrifugo.consume';

const presenceCentrifugoPlugin = async (fastify: FastifyInstance) => {
  try {
    const presenceConsumer = container.resolve(PresenceCentrifugoConsume);
    await presenceConsumer.start();

    fastify.addHook('onClose', async () => {
      await presenceConsumer.stop();
    });
  } catch (error) {
    fastify.log.error(error, 'Failed to start presence Centrifugo consumer');
  }
};

export default fp(presenceCentrifugoPlugin, { name: 'presence-centrifugo' });
