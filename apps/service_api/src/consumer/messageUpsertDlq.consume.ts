import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { MessageUpsertDlqConsume } from '@core/consumer/message/MessageUpsertDlq.consume';

export function startMessageUpsertDlqConsume(
  server: FastifyInstance
): MessageUpsertDlqConsume {
  const messageUpsertDlqConsume = container.resolve(MessageUpsertDlqConsume);

  messageUpsertDlqConsume.execute(server.i18n).catch((error: unknown) => {
    server.log.error(
      { err: error },
      'Error starting message upsert DLQ consume'
    );
  });

  return messageUpsertDlqConsume;
}
