import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { WorkerWarmDeleteConsume } from '@core/consumer/worker/WorkerWarmDelete.consume';
import { launchServiceApiConsumerStartup } from './startupAttempt';

export function startWorkerWarmDeleteConsume(
  server: FastifyInstance
): WorkerWarmDeleteConsume {
  const consume = container.resolve(WorkerWarmDeleteConsume);

  return launchServiceApiConsumerStartup(
    consume,
    () => consume.execute(),
    (error) =>
      server.log.error(
        { err: error },
        'Error starting worker warm delete consume'
      )
  );
}
