import { FastifyInstance } from 'fastify';
import { getHandleSchedule } from '@core/common/functions/getHandleSchedule';
import { container } from 'tsyringe';
import { Client } from '@temporalio/client';

export const workerCreationSchedule = async (fastify: FastifyInstance) => {
  const clientTemporal = container.resolve<Client>('TemporalClient');
  const scheduleId = 'worker-creation-schedule';

  const handleSchedule = clientTemporal.schedule.getHandle(scheduleId);
  const statusSchedule = await getHandleSchedule(handleSchedule);

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
    } catch {
      fastify.log.error('Error creating worker creation schedule');
    }
  }
};
