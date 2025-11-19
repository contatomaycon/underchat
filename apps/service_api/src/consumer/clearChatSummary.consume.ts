import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { ChatSummaryClearConsume } from '@core/consumer/message/ChatSummaryClear.consume';

export default fp(
  async (fastify: FastifyInstance) => {
    const chatSummaryClearConsume = container.resolve(ChatSummaryClearConsume);

    chatSummaryClearConsume.execute().catch((error) => {
      throw error;
    });

    fastify.addHook('onClose', async () => {
      await chatSummaryClearConsume.close();
    });
  },
  { name: 'chat-summary-clear-consume' }
);
