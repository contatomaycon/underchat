import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { ChatSummaryClearConsume } from '@core/consumer/message/ChatSummaryClear.consume';

export function startChatSummaryClearConsume(
  server: FastifyInstance
): ChatSummaryClearConsume {
  const chatSummaryClearConsume = container.resolve(ChatSummaryClearConsume);

  chatSummaryClearConsume.execute().catch((error: unknown) => {
    server.log.error(
      { err: error },
      'Error starting chat summary clear consume'
    );
  });

  return chatSummaryClearConsume;
}
