import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { ScheduleMessageWwebjsConsume } from '@core/consumer/schedule/ScheduleMessageWwebjs.consume';

export function startScheduleMessageWwebjsConsume(
  server: FastifyInstance
): ScheduleMessageWwebjsConsume {
  const consume = container.resolve(ScheduleMessageWwebjsConsume);

  consume.execute().catch((error: unknown) => {
    server.log.error({ err: error }, 'Error starting schedule message consume');
  });

  return consume;
}
