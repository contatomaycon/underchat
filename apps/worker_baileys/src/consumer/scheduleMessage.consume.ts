import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { ScheduleMessageConsume } from '@core/consumer/schedule/ScheduleMessage.consume';

export function startScheduleMessageConsume(
  server: FastifyInstance
): ScheduleMessageConsume {
  const scheduleMessageConsume = container.resolve(ScheduleMessageConsume);

  scheduleMessageConsume.execute().catch((error: unknown) => {
    server.log.error({ err: error }, 'Error starting schedule message consume');
  });

  return scheduleMessageConsume;
}
