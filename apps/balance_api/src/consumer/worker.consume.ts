import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { WorkerConsume } from '@core/consumer/webhook/WorkerConsume';

export default fp(
  async (fastify: FastifyInstance) => {
    const workerconsume = container.resolve(WorkerConsume);

    // Execute in background - don't block startup
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
