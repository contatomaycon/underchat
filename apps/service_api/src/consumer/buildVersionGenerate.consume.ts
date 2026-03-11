import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { BuildVersionGenerateConsume } from '@core/consumer/build/BuildVersionGenerate.consume';

export function startBuildVersionGenerateConsume(
  server: FastifyInstance
): BuildVersionGenerateConsume {
  const consume = container.resolve(BuildVersionGenerateConsume);

  consume.execute(server).catch((error: unknown) => {
    server.log.error(
      { err: error },
      'Error starting build version generate consume'
    );
  });

  return consume;
}
