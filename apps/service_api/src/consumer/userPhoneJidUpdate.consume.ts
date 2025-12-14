import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { UserPhoneJidUpdateConsume } from '@core/consumer/user/UserPhoneJidUpdate.consume';

export default fp(
  async (fastify: FastifyInstance) => {
    const userPhoneJidUpdateConsume = container.resolve(
      UserPhoneJidUpdateConsume
    );

    userPhoneJidUpdateConsume.execute().catch((error) => {
      throw error;
    });

    fastify.addHook('onClose', async () => {
      await userPhoneJidUpdateConsume.close();
    });
  },
  { name: 'user-phone-jid-update-consume' }
);
