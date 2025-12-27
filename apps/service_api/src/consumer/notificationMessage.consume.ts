import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { NotificationMessageConsume } from '@core/consumer/notification/NotificationMessage.consume';

export function startNotificationMessageConsume(
  server: FastifyInstance
): NotificationMessageConsume {
  const notificationMessageConsume = container.resolve(
    NotificationMessageConsume
  );

  notificationMessageConsume.execute().catch((error: unknown) => {
    server.log.error(
      { err: error },
      'Error starting notification message consume'
    );
  });

  return notificationMessageConsume;
}
