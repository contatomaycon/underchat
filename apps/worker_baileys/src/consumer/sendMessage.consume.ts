import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { MessageSendConsume } from '@core/consumer/message/MessageSend.consume';

export function startSendMessageConsume(
  server: FastifyInstance
): MessageSendConsume {
  const t0 = Date.now();
  console.log(
    '[worker_baileys:init] sendMessage.consume: startSendMessageConsume iniciado',
    { ts: t0 }
  );
  const messageSendConsume = container.resolve(MessageSendConsume);
  messageSendConsume.execute().catch((error: unknown) => {
    server.log.error({ err: error }, 'Error starting message send consume');
  });
  console.log(
    '[worker_baileys:init] sendMessage.consume: startSendMessageConsume retornando',
    { ms: Date.now() - t0, ts: Date.now() }
  );

  return messageSendConsume;
}
