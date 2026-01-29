import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { WorkerConnectionStatusConsume } from '@core/consumer/worker/WorkerConnectionStatus.consume';

export function startConnectionConsume(
  server: FastifyInstance
): WorkerConnectionStatusConsume {
  const t0 = Date.now();
  console.log(
    '[worker_baileys:init] connection.consume: startConnectionConsume iniciado',
    { ts: t0 }
  );
  const tResolve = Date.now();
  const workerConnectionStatusConsume = container.resolve(
    WorkerConnectionStatusConsume
  );
  console.log(
    '[worker_baileys:init] connection.consume: WorkerConnectionStatusConsume resolvido',
    { ms: Date.now() - tResolve, ts: Date.now() }
  );

  const tExecute = Date.now();
  workerConnectionStatusConsume.execute().catch((error: unknown) => {
    console.log(
      '[worker_baileys:init] connection.consume: execute() rejeitou',
      { err: error, ts: Date.now() }
    );
    server.log.error(
      { err: error },
      'Error starting worker connection status consume'
    );
  });
  console.log(
    '[worker_baileys:init] connection.consume: execute() chamado (assíncrono)',
    { ms: Date.now() - tExecute, ts: Date.now() }
  );
  console.log(
    '[worker_baileys:init] connection.consume: startConnectionConsume retornando',
    { msTotal: Date.now() - t0, ts: Date.now() }
  );

  return workerConnectionStatusConsume;
}
