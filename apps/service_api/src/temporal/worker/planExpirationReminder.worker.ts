import { FastifyInstance } from 'fastify';
import { Worker } from '@temporalio/worker';
import * as activities from '@core/temporal/activities/planExpirationReminder.activities';
import '@core/temporal/workflows/planExpirationReminder.workflow';

export const planExpirationReminderWorker = async (
  fastify: FastifyInstance
) => {
  const worker = await Worker.create({
    connection: fastify.temporal.nativeConnection,
    workflowsPath:
      require.resolve('@core/temporal/workflows/planExpirationReminder.workflow'),
    activities,
    taskQueue: 'plan-expiration-reminder-queue',
  });

  worker.run();
};
