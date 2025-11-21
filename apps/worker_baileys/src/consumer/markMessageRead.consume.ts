import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { MessageMarkReadConsume } from '@core/consumer/worker/MessageMarkRead.consume';

export default fp(
  async (fastify: FastifyInstance) => {
    const messageMarkReadConsume = container.resolve(MessageMarkReadConsume);

    messageMarkReadConsume.execute().catch((error) => {
      throw error;
    });

    fastify.addHook('onClose', async () => {
      await messageMarkReadConsume.close();
    });
  },
  { name: 'message-mark-read-consume' }
);
