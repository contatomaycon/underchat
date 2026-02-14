import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { MessageMarkReadWwebjsConsume } from '@core/consumer/worker/MessageMarkReadWwebjs.consume';

export function startMarkMessageReadWwebjsConsume(
  server: FastifyInstance
): MessageMarkReadWwebjsConsume {
  const consume = container.resolve(MessageMarkReadWwebjsConsume);

  consume.execute().catch((error: unknown) => {
    server.log.error(
      { err: error },
      'Error starting message mark read consume'
    );
  });

  return consume;
}
