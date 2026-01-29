import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { WorkerConfigUpdateConsume } from '@core/consumer/worker/WorkerConfigUpdate.consume';

export function startWorkerConfigUpdateConsume(
  server: FastifyInstance
): WorkerConfigUpdateConsume {
  const t0 = Date.now();
  console.log(
    '[worker_baileys:init] workerConfigUpdate.consume: startWorkerConfigUpdateConsume iniciado',
    { ts: t0 }
  );
  const workerConfigUpdateConsume = container.resolve(
    WorkerConfigUpdateConsume
  );
  workerConfigUpdateConsume.execute().catch((error: unknown) => {
    server.log.error(
      { err: error },
      'Error starting worker config update consume'
    );
  });
  console.log(
    '[worker_baileys:init] workerConfigUpdate.consume: startWorkerConfigUpdateConsume retornando',
    { ms: Date.now() - t0, ts: Date.now() }
  );

  return workerConfigUpdateConsume;
}
