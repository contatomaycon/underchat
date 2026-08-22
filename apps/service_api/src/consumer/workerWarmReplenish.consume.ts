import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { WorkerWarmReplenishConsume } from '@core/consumer/worker/WorkerWarmReplenish.consume';
import { launchServiceApiConsumerStartup } from './startupAttempt';

export function startWorkerWarmReplenishConsume(
  server: FastifyInstance
): WorkerWarmReplenishConsume {
  const consume = container.resolve(WorkerWarmReplenishConsume);

  return launchServiceApiConsumerStartup(
    consume,
    () => consume.execute(),
    (error) =>
      server.log.error(
        { err: error },
        'Error starting worker warm replenish consume'
      )
  );
}
