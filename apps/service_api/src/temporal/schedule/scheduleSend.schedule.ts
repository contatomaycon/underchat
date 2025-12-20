import { FastifyInstance } from 'fastify';
import { getHandleSchedule } from '@core/common/functions/getHandleSchedule';
import { container } from 'tsyringe';
import { Client } from '@temporalio/client';

export const scheduleSendSchedule = async (fastify: FastifyInstance) => {
  const clientTemporal = container.resolve<Client>('TemporalClient');
  const scheduleId = 'schedule-send-schedule';

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
    } catch {
      fastify.log.error('Error creating schedule send schedule');
    }
  }
};
