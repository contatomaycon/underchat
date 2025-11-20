import { FastifyInstance } from 'fastify';
import { getHandleSchedule } from '@core/common/functions/getHandleSchedule';
import { container } from 'tsyringe';
import { Client } from '@temporalio/client';

export const profileStatusRenewalSchedule = async (
  fastify: FastifyInstance
) => {
  const clientTemporal = container.resolve<Client>('TemporalClient');
  const scheduleId = 'profile-status-renewal-schedule';

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
    } catch {
      fastify.log.error('Error creating profile status renewal schedule');
    }
  }
};
