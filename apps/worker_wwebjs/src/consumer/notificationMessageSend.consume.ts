import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { NotificationMessageSendWwebjsConsume } from '@core/consumer/notification/NotificationMessageSendWwebjs.consume';

export function startNotificationMessageSendWwebjsConsume(
  server: FastifyInstance
): NotificationMessageSendWwebjsConsume {
  const consume = container.resolve(NotificationMessageSendWwebjsConsume);

  consume.execute().catch((error: unknown) => {
    server.log.error(
      { err: error },
      'Error starting notification message send consume'
    );
  });

  return consume;
}
