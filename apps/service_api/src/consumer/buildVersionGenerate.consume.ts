import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { BuildVersionGenerateConsume } from '@core/consumer/build/BuildVersionGenerate.consume';
import { launchServiceApiConsumerStartup } from './startupAttempt';

export function startBuildVersionGenerateConsume(
  server: FastifyInstance
): BuildVersionGenerateConsume {
  const consume = container.resolve(BuildVersionGenerateConsume);

  return launchServiceApiConsumerStartup(
    consume,
    () => consume.execute(server),
    (error) =>
      server.log.error(
        { err: error },
        'Error starting build version generate consume'
      )
  );
}
