import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { WorkerConnectionStatusConsume } from '@core/consumer/worker/WorkerConnectionStatus.consume';

export default fp(
  async (fastify: FastifyInstance) => {
    const workerConnectionStatusConsume = container.resolve(
      WorkerConnectionStatusConsume
    );

    workerConnectionStatusConsume.execute().catch((error) => {
      throw error;
    });

    fastify.addHook('onClose', async () => {
      await workerConnectionStatusConsume.close();
    });
  },
  { name: 'connection-consume' }
);
