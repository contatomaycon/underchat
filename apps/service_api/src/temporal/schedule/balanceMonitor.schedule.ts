import { FastifyInstance } from 'fastify';
import { getHandleSchedule } from '@core/common/functions/getHandleSchedule';
import { container } from 'tsyringe';
import { Client } from '@temporalio/client';
import Redis from 'ioredis';
import { withLock } from '@core/common/functions/withLock';

export const balanceMonitorSchedule = async (fastify: FastifyInstance) => {
  const clientTemporal = container.resolve<Client>('TemporalClient');
  const redis = container.resolve<Redis>('Redis');
  const scheduleId = 'balance-monitor-schedule';

  await withLock(
    redis,
    `temporal-schedule-${scheduleId}`,
    async () => {
      const handleSchedule = clientTemporal.schedule.getHandle(scheduleId);
      const statusSchedule = await getHandleSchedule(handleSchedule);

      if (statusSchedule) {
        return;
      }

      try {
        await clientTemporal.schedule.create({
          scheduleId,
          spec: {
            intervals: [{ every: '60s' }],
          },
          action: {
            type: 'startWorkflow',
            workflowType: 'balanceMonitorWorkflow',
            taskQueue: 'balance-monitor-queue',
            args: [],
          },
        });

        fastify.log.info('Schedule "balance-monitor-schedule" created');
      } catch (err) {
        fastify.log.error(err, 'Error creating balance monitor schedule');
      }
    },
    {
      ttlMs: 30000,
      retryMs: 100,
    }
  );
};
