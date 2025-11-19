import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { ChatSummaryClearCentrifugoService } from '@core/services/chatSummaryClearCentrifugo.service';

export default fp(
  async (fastify: FastifyInstance) => {
    const chatSummaryClearCentrifugoService = container.resolve(
      ChatSummaryClearCentrifugoService
    );

    chatSummaryClearCentrifugoService.startListening().catch((error) => {
      throw error;
    });

    fastify.addHook('onClose', async () => {
      await chatSummaryClearCentrifugoService.close();
    });
  },
  { name: 'chat-summary-clear-centrifugo' }
);
