import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { WorkerConnectionConsume } from '@core/consumer/worker/WorkerConnection.consume';

export function startWorkerConsume(
  server: FastifyInstance
): WorkerConnectionConsume {
  const workerConnectionConsume = container.resolve(WorkerConnectionConsume);

  workerConnectionConsume.execute().catch((error: unknown) => {
    server.log.error(
      { err: error },
      'Error starting worker connection consume'
    );
  });

  return workerConnectionConsume;
}
