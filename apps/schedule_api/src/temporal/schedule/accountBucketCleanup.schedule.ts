import { FastifyInstance } from 'fastify';
import {
  getHandleSchedule,
  isScheduleTimeoutError,
} from '@core/common/functions/getHandleSchedule';
import { container } from 'tsyringe';
import { Client } from '@temporalio/client';
import Redis from 'ioredis';
import { withLock } from '@core/common/functions/withLock';

export const accountBucketCleanupSchedule = async (
  fastify: FastifyInstance
) => {
  const clientTemporal = container.resolve<Client>('TemporalClient');
  const redis = container.resolve<Redis>('Redis');
  const scheduleId = 'account-bucket-cleanup-schedule';

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

      if (statusSchedule) {
        return;
      }

      try {
        await clientTemporal.schedule.create({
          scheduleId,
          spec: {
            intervals: [{ every: '24h' }],
            timezone: 'America/Sao_Paulo',
          },
          action: {
            type: 'startWorkflow',
            workflowType: 'accountBucketCleanupWorkflow',
            taskQueue: 'account-bucket-cleanup-queue',
            args: [],
          },
        });

        fastify.log.info('Schedule "account-bucket-cleanup-schedule" created');
      } catch (err) {
        fastify.log.error(
          err,
          'Error creating account bucket cleanup schedule'
        );
      }
    },
    {
      ttlMs: 30000,
      retryMs: 100,
    }
  );
};
