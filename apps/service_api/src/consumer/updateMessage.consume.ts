import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { MessageUpdateConsume } from '@core/consumer/message/MessageUpdate.consume';

export default fp(
  async (fastify: FastifyInstance) => {
    const messageUpdateConsume = container.resolve(MessageUpdateConsume);

    messageUpdateConsume.execute().catch((error) => {
      throw error;
    });

    fastify.addHook('onClose', async () => {
      await messageUpdateConsume.close();
    });
  },
  { name: 'message-update-consume' }
);
