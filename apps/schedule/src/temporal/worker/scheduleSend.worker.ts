import { FastifyInstance } from 'fastify';
import { Worker } from '@temporalio/worker';
import { container } from 'tsyringe';
import { ScheduleSendActivity } from '@core/temporal/activities/scheduleSend.activities';
import '@core/temporal/workflows/scheduleSend.workflow';

export const scheduleSendWorker = async (fastify: FastifyInstance) => {
  const activity = container.resolve(ScheduleSendActivity);

  const worker = await Worker.create({
    connection: fastify.temporal.nativeConnection,
    workflowsPath:
      require.resolve('@core/temporal/workflows/scheduleSend.workflow'),
    activities: {
      processScheduleSends: activity.processScheduleSends,
    },
    taskQueue: 'schedule-send-queue',
  });

  fastify.temporal.registerWorker(worker);
  worker.run();
};
