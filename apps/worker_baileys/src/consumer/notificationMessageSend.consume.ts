import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { NotificationMessageSendConsume } from '@core/consumer/notification/NotificationMessageSend.consume';

export function startNotificationMessageSendConsume(
  server: FastifyInstance
): NotificationMessageSendConsume {
  const t0 = Date.now();
  console.log(
    '[worker_baileys:init] notificationMessageSend.consume: startNotificationMessageSendConsume iniciado',
    { ts: t0 }
  );
  const notificationMessageSendConsume = container.resolve(
    NotificationMessageSendConsume
  );
  notificationMessageSendConsume.execute().catch((error: unknown) => {
    server.log.error(
      { err: error },
      'Error starting notification message send consume'
    );
  });
  console.log(
    '[worker_baileys:init] notificationMessageSend.consume: startNotificationMessageSendConsume retornando',
    { ms: Date.now() - t0, ts: Date.now() }
  );

  return notificationMessageSendConsume;
}
