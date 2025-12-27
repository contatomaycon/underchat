import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { WorkerConnectionStatusConsume } from '@core/consumer/worker/WorkerConnectionStatus.consume';

export function startConnectionConsume(
  server: FastifyInstance
): WorkerConnectionStatusConsume {
  const workerConnectionStatusConsume = container.resolve(
    WorkerConnectionStatusConsume
  );

  workerConnectionStatusConsume.execute().catch((error: unknown) => {
    server.log.error(
      { err: error },
      'Error starting worker connection status consume'
    );
  });

  return workerConnectionStatusConsume;
}
