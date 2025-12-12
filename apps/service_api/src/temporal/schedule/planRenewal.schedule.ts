import { FastifyInstance } from 'fastify';
import { getHandleSchedule } from '@core/common/functions/getHandleSchedule';
import { container } from 'tsyringe';
import { Client } from '@temporalio/client';

export const planRenewalSchedule = async (fastify: FastifyInstance) => {
  const clientTemporal = container.resolve<Client>('TemporalClient');
  const scheduleId = 'plan-renewal-schedule';

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
          workflowType: 'planRenewalWorkflow',
          taskQueue: 'plan-renewal-queue',
          args: [],
        },
      });

      fastify.log.info('Schedule "plan-renewal-schedule" created');
    } catch {
      fastify.log.error('Error creating plan renewal schedule');
    }
  }
};
