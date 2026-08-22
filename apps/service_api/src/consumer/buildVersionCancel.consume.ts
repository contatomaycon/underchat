import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { BuildVersionCancelConsume } from '@core/consumer/build/BuildVersionCancel.consume';
import { launchServiceApiConsumerStartup } from './startupAttempt';

export function startBuildVersionCancelConsume(
  server: FastifyInstance
): BuildVersionCancelConsume {
  const consume = container.resolve(BuildVersionCancelConsume);

  return launchServiceApiConsumerStartup(
    consume,
    () => consume.execute(server),
    (error) =>
      server.log.error(
        { err: error },
        'Error starting build version cancel consume'
      )
  );
}
