import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { NotificationMessageConsume } from '@core/consumer/notification/NotificationMessage.consume';
import { launchServiceApiConsumerStartup } from './startupAttempt';

export function startNotificationMessageConsume(
  server: FastifyInstance
): NotificationMessageConsume {
  const notificationMessageConsume = container.resolve(
    NotificationMessageConsume
  );

  return launchServiceApiConsumerStartup(
    notificationMessageConsume,
    () => notificationMessageConsume.execute(),
    (error) =>
      server.log.error(
        { err: error },
        'Error starting notification message consume'
      )
  );
}
