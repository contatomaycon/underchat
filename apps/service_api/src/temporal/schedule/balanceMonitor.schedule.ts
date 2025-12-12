import { FastifyInstance } from 'fastify';
import { getHandleSchedule } from '@core/common/functions/getHandleSchedule';
import { container } from 'tsyringe';
import { Client } from '@temporalio/client';

export const balanceMonitorSchedule = async (fastify: FastifyInstance) => {
  const clientTemporal = container.resolve<Client>('TemporalClient');
  const scheduleId = 'balance-monitor-schedule';

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
    return;
  } catch {
    fastify.log.error('Error creating balance monitor schedule');
  }
};
