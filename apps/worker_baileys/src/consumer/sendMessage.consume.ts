import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { MessageSendConsume } from '@core/consumer/message/MessageSend.consume';

export default fp(
  async (fastify: FastifyInstance) => {
    const messageSendConsume = container.resolve(MessageSendConsume);

    messageSendConsume.execute().catch((error) => {
      throw error;
    });

    fastify.addHook('onClose', async () => {
      await messageSendConsume.close();
    });
  },
  { name: 'send-message-consume' }
);
