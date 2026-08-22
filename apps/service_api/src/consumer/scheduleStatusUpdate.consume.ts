import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { ScheduleStatusUpdateConsume } from '@core/consumer/schedule/ScheduleStatusUpdate.consume';
import { launchServiceApiConsumerStartup } from './startupAttempt';

export function startScheduleStatusUpdateConsume(
  server: FastifyInstance
): ScheduleStatusUpdateConsume {
  const scheduleStatusUpdateConsume = container.resolve(
    ScheduleStatusUpdateConsume
  );

  return launchServiceApiConsumerStartup(
    scheduleStatusUpdateConsume,
    () => scheduleStatusUpdateConsume.execute(),
    (error) =>
      server.log.error(
        { err: error },
        'Error starting schedule status update consume'
      )
  );
}
