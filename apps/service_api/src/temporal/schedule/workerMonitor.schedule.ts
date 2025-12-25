import { FastifyInstance } from 'fastify';
import { getHandleSchedule } from '@core/common/functions/getHandleSchedule';
import { container } from 'tsyringe';
import { Client } from '@temporalio/client';
import Redis from 'ioredis';
import { withLock } from '@core/common/functions/withLock';

export const workerMonitorSchedule = async (fastify: FastifyInstance) => {
  const clientTemporal = container.resolve<Client>('TemporalClient');
  const redis = container.resolve<Redis>('Redis');
  const scheduleId = 'worker-monitor-schedule';

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
            intervals: [{ every: '600s' }],
          },
          action: {
            type: 'startWorkflow',
            workflowType: 'workerMonitorWorkflow',
            taskQueue: 'worker-monitor-queue',
            args: [],
          },
        });

        fastify.log.info('Schedule "worker-monitor-schedule" created');
      } catch (err) {
        fastify.log.error(
          'Error creating worker monitor schedule:',
          err instanceof Error ? err.message : String(err)
        );
      }
    },
    {
      ttlMs: 30000,
      retryMs: 100,
    }
  );
};
