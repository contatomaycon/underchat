import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { ScheduleMessageConsume } from '@core/consumer/schedule/ScheduleMessage.consume';

export function startScheduleMessageConsume(
  server: FastifyInstance
): ScheduleMessageConsume {
  const t0 = Date.now();
  console.log(
    '[worker_baileys:init] scheduleMessage.consume: startScheduleMessageConsume iniciado',
    { ts: t0 }
  );
  const scheduleMessageConsume = container.resolve(ScheduleMessageConsume);
  scheduleMessageConsume.execute().catch((error: unknown) => {
    server.log.error({ err: error }, 'Error starting schedule message consume');
  });
  console.log(
    '[worker_baileys:init] scheduleMessage.consume: startScheduleMessageConsume retornando',
    { ms: Date.now() - t0, ts: Date.now() }
  );

  return scheduleMessageConsume;
}
