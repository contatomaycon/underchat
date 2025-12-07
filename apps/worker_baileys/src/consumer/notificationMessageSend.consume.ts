import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { NotificationMessageSendConsume } from '@core/consumer/notification/NotificationMessageSend.consume';

export default fp(
  async (fastify: FastifyInstance) => {
    const notificationMessageSendConsume = container.resolve(
      NotificationMessageSendConsume
    );

    notificationMessageSendConsume.execute().catch((error) => {
      throw error;
    });

    fastify.addHook('onClose', async () => {
      await notificationMessageSendConsume.close();
    });
  },
  { name: 'notification-message-send-consume' }
);
