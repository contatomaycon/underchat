import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { MessageUpsertConsume } from '@core/consumer/message/MessageUpsert.consume';

export function startMessageUpsertConsume(
  server: FastifyInstance
): MessageUpsertConsume {
  const messageUpsertConsume = container.resolve(MessageUpsertConsume);

  messageUpsertConsume.execute(server.i18n).catch((error: unknown) => {
    server.log.error({ err: error }, 'Error starting message upsert consume');
  });

  return messageUpsertConsume;
}
