import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { UserPhoneJidUpdateConsume } from '@core/consumer/user/UserPhoneJidUpdate.consume';

export function startUserPhoneJidUpdateConsume(
  server: FastifyInstance
): UserPhoneJidUpdateConsume {
  const userPhoneJidUpdateConsume = container.resolve(
    UserPhoneJidUpdateConsume
  );

  userPhoneJidUpdateConsume.execute().catch((error: unknown) => {
    server.log.error(
      { err: error },
      'Error starting user phone jid update consume'
    );
  });

  return userPhoneJidUpdateConsume;
}
