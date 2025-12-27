import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { ProfileStatusExternalIdUpdateConsume } from '@core/consumer/worker/ProfileStatusExternalIdUpdate.consume';

export function startProfileStatusExternalIdUpdateConsume(
  server: FastifyInstance
): ProfileStatusExternalIdUpdateConsume {
  const profileStatusExternalIdUpdateConsume = container.resolve(
    ProfileStatusExternalIdUpdateConsume
  );

  profileStatusExternalIdUpdateConsume.execute().catch((error: unknown) => {
    server.log.error(
      { err: error },
      'Error starting profile status external id update consume'
    );
  });

  return profileStatusExternalIdUpdateConsume;
}
