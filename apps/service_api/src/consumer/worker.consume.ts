import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { WorkerConnectionConsume } from '@core/consumer/worker/WorkerConnection.consume';

export default fp(
  async (fastify: FastifyInstance) => {
    const workerConnectionConsume = container.resolve(WorkerConnectionConsume);

    workerConnectionConsume.execute().catch((error) => {
      throw error;
    });

    fastify.addHook('onClose', async () => {
      await workerConnectionConsume.close();
    });
  },
  { name: 'worker-connection-consume' }
);
