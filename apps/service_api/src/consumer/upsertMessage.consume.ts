import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { MessageUpsertConsume } from '@core/consumer/message/MessageUpsert.consume';

export default fp(
  async (fastify: FastifyInstance) => {
    const messageUpsertConsume = container.resolve(MessageUpsertConsume);

    messageUpsertConsume.execute().catch((error) => {
      throw error;
    });

    fastify.addHook('onClose', async () => {
      await messageUpsertConsume.close();
    });
  },
  { name: 'message-upsert-consume' }
);
