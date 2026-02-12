import path from 'path';
import { FastifyInstance } from 'fastify';
import { Worker } from '@temporalio/worker';
import { container } from 'tsyringe';
import { ScheduleSendActivity } from '@core/temporal/activities/scheduleSend.activities';

export const scheduleSendWorker = async (fastify: FastifyInstance) => {
  const activity = container.resolve(ScheduleSendActivity);

  const worker = await Worker.create({
    connection: fastify.temporal.nativeConnection,
    workflowsPath: path.resolve(
      __dirname,
      '../../../../../packages/temporal/workflows/scheduleSend.workflow'
    ),
    activities: {
      processScheduleSends: activity.processScheduleSends,
    },
    taskQueue: 'schedule-send-queue',
  });

  fastify.temporal.registerWorker(worker);

  worker.run().catch((err) => {
    fastify.log.error(err, 'Schedule send worker failed');
  });
};
