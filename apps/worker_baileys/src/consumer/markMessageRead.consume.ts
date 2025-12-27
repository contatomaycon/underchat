import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { MessageMarkReadConsume } from '@core/consumer/worker/MessageMarkRead.consume';

export function startMarkMessageReadConsume(
  server: FastifyInstance
): MessageMarkReadConsume {
  const messageMarkReadConsume = container.resolve(MessageMarkReadConsume);

  messageMarkReadConsume.execute().catch((error: unknown) => {
    server.log.error(
      { err: error },
      'Error starting message mark read consume'
    );
  });

  return messageMarkReadConsume;
}
