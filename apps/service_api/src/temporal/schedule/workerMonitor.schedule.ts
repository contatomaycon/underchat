import { FastifyInstance } from 'fastify';
import { getHandleSchedule } from '@core/common/functions/getHandleSchedule';
import { container } from 'tsyringe';
import { Client } from '@temporalio/client';

export const workerMonitorSchedule = async (fastify: FastifyInstance) => {
  const clientTemporal = container.resolve<Client>('TemporalClient');
  const scheduleId = 'worker-monitor-schedule';

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
    return;
  } catch {
    fastify.log.error('Error creating worker monitor schedule');
  }
};
