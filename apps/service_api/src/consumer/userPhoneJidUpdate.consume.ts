import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { UserPhoneJidUpdateConsume } from '@core/consumer/user/UserPhoneJidUpdate.consume';
import { launchServiceApiConsumerStartup } from './startupAttempt';

export function startUserPhoneJidUpdateConsume(
  server: FastifyInstance
): UserPhoneJidUpdateConsume {
  const userPhoneJidUpdateConsume = container.resolve(
    UserPhoneJidUpdateConsume
  );

  return launchServiceApiConsumerStartup(
    userPhoneJidUpdateConsume,
    () => userPhoneJidUpdateConsume.execute(),
    (error) =>
      server.log.error(
        { err: error },
        'Error starting user phone jid update consume'
      )
  );
}
