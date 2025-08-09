import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { baileysEnvironment } from '@core/config/environments';
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';

export default fp(
  async (fastify: FastifyInstance) => {
    const kafkaBaileysQueueService = container.resolve(
      KafkaBaileysQueueService
    );

    kafkaBaileysQueueService
      .create(baileysEnvironment.baileysWorkerId)
      .catch((error) => {
        throw error;
      });

    fastify.addHook('onClose', async () => {
      await kafkaBaileysQueueService.close();
    });
  },
  { name: 'kafka-baileys-queue' }
);
