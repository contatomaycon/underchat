import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { ScheduleStatusUpdateConsume } from '@core/consumer/schedule/ScheduleStatusUpdate.consume';

export function startScheduleStatusUpdateConsume(
  server: FastifyInstance
): ScheduleStatusUpdateConsume {
  const scheduleStatusUpdateConsume = container.resolve(
    ScheduleStatusUpdateConsume
  );

  scheduleStatusUpdateConsume.execute().catch((error: unknown) => {
    server.log.error(
      { err: error },
      'Error starting schedule status update consume'
    );
  });

  return scheduleStatusUpdateConsume;
}
