import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { WorkerConsume } from '@core/consumer/worker/Worker.consume';

export default fp(
  async (fastify: FastifyInstance) => {
    const workerconsume = container.resolve(WorkerConsume);

    setImmediate(() => {
      workerconsume.execute().catch((error) => {
        console.error('Error starting workerconsume:', error);
      });
    });

    fastify.addHook('onClose', async () => {
      await workerconsume.close();
    });
  },
  { name: 'workerconsume-consume' }
);
