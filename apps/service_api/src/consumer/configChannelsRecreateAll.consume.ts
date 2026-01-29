import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { ConfigChannelsRecreateAllConsume } from '@core/consumer/config/ConfigChannelsRecreateAll.consume';

export function startConfigChannelsRecreateAllConsume(
  server: FastifyInstance
): ConfigChannelsRecreateAllConsume {
  const consume = container.resolve(ConfigChannelsRecreateAllConsume);

  consume.execute().catch((error: unknown) => {
    server.log.error(
      { err: error },
      'Error starting config channels recreate all consume'
    );
  });

  return consume;
}
