import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { MessageUpsertConsume } from '@core/consumer/message/MessageUpsert.consume';
import { launchServiceApiConsumerStartup } from './startupAttempt';

export function startMessageUpsertConsume(
  server: FastifyInstance
): MessageUpsertConsume {
  const messageUpsertConsume = container.resolve(MessageUpsertConsume);

  return launchServiceApiConsumerStartup(
    messageUpsertConsume,
    () => messageUpsertConsume.execute(server.i18n),
    (error) =>
      server.log.error({ err: error }, 'Error starting message upsert consume')
  );
}
