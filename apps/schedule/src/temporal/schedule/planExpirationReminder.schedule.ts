import { FastifyInstance } from 'fastify';
import { getHandleSchedule } from '@core/common/functions/getHandleSchedule';
import { container } from 'tsyringe';
import { Client } from '@temporalio/client';
import Redis from 'ioredis';
import { withLock } from '@core/common/functions/withLock';

export const planExpirationReminderSchedule = async (
  fastify: FastifyInstance
) => {
  const clientTemporal = container.resolve<Client>('TemporalClient');
  const redis = container.resolve<Redis>('Redis');
  const scheduleId = 'plan-expiration-reminder-schedule';

  await withLock(
    redis,
    `temporal-schedule-${scheduleId}`,
    async () => {
      const handleSchedule = clientTemporal.schedule.getHandle(scheduleId);
      let statusSchedule: boolean;
      try {
        statusSchedule = await getHandleSchedule(handleSchedule);
      } catch (err) {
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
              intervals: [{ every: '1h' }],
            },
            action: {
              type: 'startWorkflow',
              workflowType: 'planExpirationReminderWorkflow',
              taskQueue: 'plan-expiration-reminder-queue',
              args: [],
            },
          });

          fastify.log.info(
            'Schedule "plan-expiration-reminder-schedule" created'
          );
        } catch (err) {
          fastify.log.error(
            err,
            'Error creating plan expiration reminder schedule'
          );
        }
      }
    },
    {
      ttlMs: 30000,
      retryMs: 100,
    }
  );
};
