import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { WorkerConfigUpdateWwebjsConsume } from '@core/consumer/worker/WorkerConfigUpdateWwebjs.consume';

export function startWorkerConfigUpdateWwebjsConsume(
  server: FastifyInstance
): WorkerConfigUpdateWwebjsConsume {
  const consume = container.resolve(WorkerConfigUpdateWwebjsConsume);

  consume.execute().catch((error: unknown) => {
    server.log.error(
      { err: error },
      'Error starting worker config update consume'
    );
  });

  return consume;
}
