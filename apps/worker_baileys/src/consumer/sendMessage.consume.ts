import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { WorkerSendMessageConsume } from '@core/consumer/worker/WorkerSendMessage.consume';

export default fp(
  async (fastify: FastifyInstance) => {
    const workerSendMessageConsume = container.resolve(
      WorkerSendMessageConsume
    );

    workerSendMessageConsume.execute().catch((error) => {
      throw error;
    });

    fastify.addHook('onClose', async () => {
      await workerSendMessageConsume.close();
    });
  },
  { name: 'send-message-consume' }
);
