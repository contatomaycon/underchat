import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';

export default fp(
  async (fastify: FastifyInstance) => {
    const kafkaServiceQueueService = container.resolve(
      KafkaServiceQueueService
    );

    kafkaServiceQueueService.create().catch((error) => {
      throw error;
    });

    fastify.addHook('onClose', async () => {
      await kafkaServiceQueueService.close();
    });
  },
  { name: 'kafka-service-queue' }
);
