import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { MessageStatusUpdateConsume } from '@core/consumer/message/MessageStatusUpdate.consume';

export default fp(
  async (fastify: FastifyInstance) => {
    const messageStatusUpdateConsume = container.resolve(
      MessageStatusUpdateConsume
    );

    messageStatusUpdateConsume.execute().catch((error) => {
      throw error;
    });

    fastify.addHook('onClose', async () => {
      await messageStatusUpdateConsume.close();
    });
  },
  { name: 'message-status-update-consume' }
);
