import { FastifyInstance } from 'fastify';
import { getHandleSchedule } from '@core/common/functions/getHandleSchedule';
import { container } from 'tsyringe';
import { Client } from '@temporalio/client';
import Redis from 'ioredis';
import { withLock } from '@core/common/functions/withLock';

export const scheduleSendSchedule = async (fastify: FastifyInstance) => {
  const clientTemporal = container.resolve<Client>('TemporalClient');
  const redis = container.resolve<Redis>('Redis');
  const scheduleId = 'schedule-send-schedule';

  await withLock(
    redis,
    `temporal-schedule-${scheduleId}`,
    async () => {
      const handleSchedule = clientTemporal.schedule.getHandle(scheduleId);
      const statusSchedule = await getHandleSchedule(handleSchedule);

      if (!statusSchedule) {
        try {
          await clientTemporal.schedule.create({
            scheduleId,
            spec: {
              intervals: [{ every: '1 minute' }],
            },
            action: {
              type: 'startWorkflow',
              workflowType: 'scheduleSendWorkflow',
              taskQueue: 'schedule-send-queue',
              args: [],
            },
          });

          fastify.log.info('Schedule "schedule-send-schedule" created');
        } catch (err) {
          fastify.log.error(err, 'Error creating schedule send schedule');
        }
      }
    },
    {
      ttlMs: 30000,
      retryMs: 100,
    }
  );
};
