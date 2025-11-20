import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { ProfileStatusExternalIdUpdateConsume } from '@core/consumer/worker/ProfileStatusExternalIdUpdate.consume';

export default fp(
  async (fastify: FastifyInstance) => {
    const profileStatusExternalIdUpdateConsume = container.resolve(
      ProfileStatusExternalIdUpdateConsume
    );

    profileStatusExternalIdUpdateConsume.execute().catch((error) => {
      throw error;
    });

    fastify.addHook('onClose', async () => {
      await profileStatusExternalIdUpdateConsume.close();
    });
  },
  { name: 'profile-status-external-id-update-consume' }
);
