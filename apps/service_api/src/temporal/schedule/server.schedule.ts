import { FastifyInstance } from 'fastify';
import { getHandleSchedule } from '@core/common/functions/getHandleSchedule';
import { container } from 'tsyringe';
import { Client } from '@temporalio/client';

export const serverSchedule = async (fastify: FastifyInstance) => {
  const clientTemporal = container.resolve<Client>('TemporalClient');
  const scheduleId = 'server-schedule';

  const handleSchedule = clientTemporal.schedule.getHandle(scheduleId);
  const statusServerSchendule = await getHandleSchedule(handleSchedule);

  if (!statusServerSchendule) {
    try {
      await clientTemporal.schedule.create({
        scheduleId,
        spec: {
          intervals: [{ every: '60s' }],
        },
        action: {
          type: 'startWorkflow',
          workflowType: 'serverWorkflow',
          taskQueue: 'server-queue',
          args: [],
        },
      });

      fastify.log.info('Schedule "server-schedule" created');
    } catch {
      fastify.log.error('Error creating schedule');
    }
  }
};
