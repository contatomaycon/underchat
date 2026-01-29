import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { MessageMarkReadConsume } from '@core/consumer/worker/MessageMarkRead.consume';

export function startMarkMessageReadConsume(
  server: FastifyInstance
): MessageMarkReadConsume {
  const t0 = Date.now();
  console.log(
    '[worker_baileys:init] markMessageRead.consume: startMarkMessageReadConsume iniciado',
    { ts: t0 }
  );
  const messageMarkReadConsume = container.resolve(MessageMarkReadConsume);
  messageMarkReadConsume.execute().catch((error: unknown) => {
    server.log.error(
      { err: error },
      'Error starting message mark read consume'
    );
  });
  console.log(
    '[worker_baileys:init] markMessageRead.consume: startMarkMessageReadConsume retornando',
    { ms: Date.now() - t0, ts: Date.now() }
  );

  return messageMarkReadConsume;
}
