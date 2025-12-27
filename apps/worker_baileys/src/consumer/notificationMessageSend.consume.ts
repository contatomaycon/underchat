import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { NotificationMessageSendConsume } from '@core/consumer/notification/NotificationMessageSend.consume';

export function startNotificationMessageSendConsume(
  server: FastifyInstance
): NotificationMessageSendConsume {
  const notificationMessageSendConsume = container.resolve(
    NotificationMessageSendConsume
  );

  notificationMessageSendConsume.execute().catch((error: unknown) => {
    server.log.error(
      { err: error },
      'Error starting notification message send consume'
    );
  });

  return notificationMessageSendConsume;
}
