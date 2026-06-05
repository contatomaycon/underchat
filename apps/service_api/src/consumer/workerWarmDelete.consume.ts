import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { WorkerWarmDeleteConsume } from '@core/consumer/worker/WorkerWarmDelete.consume';

export function startWorkerWarmDeleteConsume(
  server: FastifyInstance
): WorkerWarmDeleteConsume {
  const consume = container.resolve(WorkerWarmDeleteConsume);

  consume.execute(server).catch((error: unknown) => {
    server.log.error(
      { err: error },
      'Error starting worker warm delete consume'
    );
  });

  return consume;
}
