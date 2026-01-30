import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { WorkerConnectionStatusConsume } from '@core/consumer/worker/WorkerConnectionStatus.consume';

export function startConnectionConsume(_server: FastifyInstance): {
  close: () => Promise<void>;
} {
  const t0 = Date.now();
  console.log(
    '[worker_baileys:init] connection.consume: startConnectionConsume iniciado',
    { ts: t0 }
  );
  const workerConnectionStatusConsume = container.resolve(
    WorkerConnectionStatusConsume
  );
  console.log(
    '[worker_baileys:init] connection.consume: startConnectionConsume retornando',
    { msTotal: Date.now() - t0, ts: Date.now() }
  );

  return {
    close: () => workerConnectionStatusConsume.close(),
  };
}
