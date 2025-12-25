import { FastifyInstance } from 'fastify';
import { getHandleSchedule } from '@core/common/functions/getHandleSchedule';
import { container } from 'tsyringe';
import { Client } from '@temporalio/client';
import Redis from 'ioredis';
import { withLock } from '@core/common/functions/withLock';

export const profileStatusRenewalSchedule = async (
  fastify: FastifyInstance
) => {
  const clientTemporal = container.resolve<Client>('TemporalClient');
  const redis = container.resolve<Redis>('Redis');
  const scheduleId = 'profile-status-renewal-schedule';

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
              intervals: [{ every: '1h' }],
            },
            action: {
              type: 'startWorkflow',
              workflowType: 'profileStatusRenewalWorkflow',
              taskQueue: 'profile-status-renewal-queue',
              args: [],
            },
          });

          fastify.log.info('Schedule "profile-status-renewal-schedule" created');
        } catch (err) {
          fastify.log.error(
            'Error creating profile status renewal schedule:',
            err instanceof Error ? err.message : String(err)
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
