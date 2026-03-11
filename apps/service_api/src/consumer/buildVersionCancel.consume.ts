import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { BuildVersionCancelConsume } from '@core/consumer/build/BuildVersionCancel.consume';

export function startBuildVersionCancelConsume(
  server: FastifyInstance
): BuildVersionCancelConsume {
  const consume = container.resolve(BuildVersionCancelConsume);

  consume.execute(server).catch((error: unknown) => {
    server.log.error(
      { err: error },
      'Error starting build version cancel consume'
    );
  });

  return consume;
}
