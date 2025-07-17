import { Client } from '@temporalio/client';
import { FastifyInstance } from 'fastify';
import { getHandleSchedule } from '../helpers/getHandleSchedule';

export const loadBalanceSchedule = async (fastify: FastifyInstance) => {
  const clientTemporal: Client = fastify.temporal.client;
  const scheduleId = 'load-balance-schedule';

  const handleSchedule = clientTemporal.schedule.getHandle(scheduleId);
  const statusSchendule = await getHandleSchedule(handleSchedule);

  if (!statusSchendule) {
    try {
      await clientTemporal.schedule.create({
        scheduleId,
        spec: {
          intervals: [{ every: '10s' }],
        },
        action: {
          type: 'startWorkflow',
          workflowType: 'loadBalanceQueueWorkflow',
          taskQueue: 'load-balance-queue',
          args: [],
        },
      });

      fastify.log.info('Schedule "load-balance-schedule" created');
    } catch {
      fastify.log.error('Error creating schedule');
    }
  }
};
