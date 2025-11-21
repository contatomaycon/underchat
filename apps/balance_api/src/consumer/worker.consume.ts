import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { WorkerConsume } from '@core/consumer/worker/Worker.consume';

export default fp(
  async (fastify: FastifyInstance) => {
    const workerConsume = container.resolve(WorkerConsume);

    workerConsume.execute().catch((error) => {
      throw error;
    });

    fastify.addHook('onClose', async () => {
      await workerConsume.close();
    });
  },
  { name: 'worker-consume' }
);
