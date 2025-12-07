import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { NotificationMessageConsume } from '@core/consumer/notification/NotificationMessage.consume';

export default fp(
  async (fastify: FastifyInstance) => {
    const notificationMessageConsume = container.resolve(
      NotificationMessageConsume
    );

    notificationMessageConsume.execute().catch((error) => {
      throw error;
    });

    fastify.addHook('onClose', async () => {
      await notificationMessageConsume.close();
    });
  },
  { name: 'notification-message-consume' }
);
