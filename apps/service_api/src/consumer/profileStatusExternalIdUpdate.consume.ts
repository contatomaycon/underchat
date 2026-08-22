import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { ProfileStatusExternalIdUpdateConsume } from '@core/consumer/worker/ProfileStatusExternalIdUpdate.consume';
import { launchServiceApiConsumerStartup } from './startupAttempt';

export function startProfileStatusExternalIdUpdateConsume(
  server: FastifyInstance
): ProfileStatusExternalIdUpdateConsume {
  const profileStatusExternalIdUpdateConsume = container.resolve(
    ProfileStatusExternalIdUpdateConsume
  );

  return launchServiceApiConsumerStartup(
    profileStatusExternalIdUpdateConsume,
    () => profileStatusExternalIdUpdateConsume.execute(),
    (error) =>
      server.log.error(
        { err: error },
        'Error starting profile status external id update consume'
      )
  );
}
