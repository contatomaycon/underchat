import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { WorkerConfigUpdateConsume } from '@core/consumer/worker/WorkerConfigUpdate.consume';

export function startWorkerConfigUpdateConsume(
  server: FastifyInstance
): WorkerConfigUpdateConsume {
  const workerConfigUpdateConsume = container.resolve(
    WorkerConfigUpdateConsume
  );

  workerConfigUpdateConsume.execute().catch((error: unknown) => {
    server.log.error(
      { err: error },
      'Error starting worker config update consume'
    );
  });

  return workerConfigUpdateConsume;
}
