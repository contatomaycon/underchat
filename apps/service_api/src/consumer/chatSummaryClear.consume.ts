import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { ChatSummaryClearConsume } from '@core/consumer/message/ChatSummaryClear.consume';
import { launchServiceApiConsumerStartup } from './startupAttempt';

export function startChatSummaryClearConsume(
  server: FastifyInstance
): ChatSummaryClearConsume {
  const chatSummaryClearConsume = container.resolve(ChatSummaryClearConsume);

  return launchServiceApiConsumerStartup(
    chatSummaryClearConsume,
    () => chatSummaryClearConsume.execute(),
    (error) =>
      server.log.error(
        { err: error },
        'Error starting chat summary clear consume'
      )
  );
}
