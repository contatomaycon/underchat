import { FastifyInstance } from 'fastify';
import {
  getHandleSchedule,
  isScheduleTimeoutError,
} from '@core/common/functions/getHandleSchedule';
import { container } from 'tsyringe';
import { Client } from '@temporalio/client';
import Redis from 'ioredis';
import { withLock } from '@core/common/functions/withLock';

export const workerCreationSchedule = async (fastify: FastifyInstance) => {
  const clientTemporal = container.resolve<Client>('TemporalClient');
  const redis = container.resolve<Redis>('Redis');
  const scheduleId = 'worker-creation-schedule';

  await withLock(
    redis,
    `temporal-schedule-${scheduleId}`,
    async () => {
      const handleSchedule = clientTemporal.schedule.getHandle(scheduleId);
      let statusSchedule: boolean;
      try {
        statusSchedule = await getHandleSchedule(handleSchedule);
      } catch (err) {
        if (isScheduleTimeoutError(err)) {
          fastify.log.warn(
            `Timeout describing schedule "${scheduleId}", skipping creation`
          );
          return;
        }

        fastify.log.error(
          err,
          `Error describing schedule "${scheduleId}", skipping creation`
        );
        return;
      }

      if (!statusSchedule) {
        try {
          await clientTemporal.schedule.create({
            scheduleId,
            spec: {
              intervals: [{ every: '60s' }],
            },
            action: {
              type: 'startWorkflow',
              workflowType: 'workerCreationWorkflow',
              taskQueue: 'worker-creation-queue',
              args: [],
            },
          });

          fastify.log.info('Schedule "worker-creation-schedule" created');
        } catch (err) {
          fastify.log.error(err, 'Error creating worker creation schedule');
        }
      }
    },
    {
      ttlMs: 30000,
      retryMs: 100,
    }
  );
};
