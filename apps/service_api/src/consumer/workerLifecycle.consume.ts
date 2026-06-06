import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { WorkerLifecycleConsume } from '@core/consumer/worker/WorkerLifecycle.consume';

export function startWorkerLifecycleConsume(
  server: FastifyInstance
): WorkerLifecycleConsume {
  const consume = container.resolve(WorkerLifecycleConsume);
  consume.execute(server).catch((error: unknown) => {
    server.log.error(error);
  });
  return consume;
}
