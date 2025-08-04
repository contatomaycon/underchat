import { KafkaBalanceQueueService } from '@core/services/kafkaBalanceQueue.service';
import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';

export default fp(
  async (fastify: FastifyInstance) => {
    const kafkaBalanceQueueService = container.resolve(
      KafkaBalanceQueueService
    );

    kafkaBalanceQueueService.create().catch((error) => {
      throw error;
    });

    fastify.addHook('onClose', async () => {
      await kafkaBalanceQueueService.close();
    });
  },
  { name: 'kafka-balance-queue' }
);
