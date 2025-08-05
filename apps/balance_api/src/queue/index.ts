import { KafkaBalanceQueueService } from '@core/services/kafkaBalanceQueue.service';
import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { balanceEnvironment } from '@core/config/environments';

export default fp(
  async (fastify: FastifyInstance) => {
    const kafkaBalanceQueueService = container.resolve(
      KafkaBalanceQueueService
    );

    kafkaBalanceQueueService
      .create(balanceEnvironment.serverId)
      .catch((error) => {
        throw error;
      });

    fastify.addHook('onClose', async () => {
      await kafkaBalanceQueueService.close();
    });
  },
  { name: 'kafka-balance-queue' }
);
