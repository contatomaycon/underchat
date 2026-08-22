import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { WorkerLifecycleConsume } from '@core/consumer/worker/WorkerLifecycle.consume';
import { launchServiceApiConsumerStartup } from './startupAttempt';

export function startWorkerLifecycleConsume(
  server: FastifyInstance
): WorkerLifecycleConsume {
  const consume = container.resolve(WorkerLifecycleConsume);
  return launchServiceApiConsumerStartup(
    consume,
    () => consume.execute(server),
    (error) => server.log.error(error)
  );
}
