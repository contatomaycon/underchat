import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { WorkerConnectionStatusConsume } from '@core/consumer/worker/WorkerConnectionStatus.consume';

export default fp(
  async (fastify: FastifyInstance) => {
    const consumer = container.resolve(WorkerConnectionStatusConsume);

    consumer.execute().catch((error) => {
      console.error('Error executing consumer:', error);

      throw error;
    });

    fastify.addHook('onClose', async () => {
      await consumer.close();
    });
  },
  { name: 'connection-consume' }
);
