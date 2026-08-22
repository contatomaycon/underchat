import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { ConfigChannelsRecreateAllConsume } from '@core/consumer/config/ConfigChannelsRecreateAll.consume';
import { launchServiceApiConsumerStartup } from './startupAttempt';

export function startConfigChannelsRecreateAllConsume(
  server: FastifyInstance
): ConfigChannelsRecreateAllConsume {
  const consume = container.resolve(ConfigChannelsRecreateAllConsume);

  return launchServiceApiConsumerStartup(
    consume,
    () => consume.execute(),
    (error) =>
      server.log.error(
        { err: error },
        'Error starting config channels recreate all consume'
      )
  );
}
