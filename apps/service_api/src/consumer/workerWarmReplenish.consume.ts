import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { WorkerWarmReplenishConsume } from '@core/consumer/worker/WorkerWarmReplenish.consume';

export function startWorkerWarmReplenishConsume(
  server: FastifyInstance
): WorkerWarmReplenishConsume {
  const consume = container.resolve(WorkerWarmReplenishConsume);

  consume.execute(server).catch((error: unknown) => {
    server.log.error(
      { err: error },
      'Error starting worker warm replenish consume'
    );
  });

  return consume;
}
