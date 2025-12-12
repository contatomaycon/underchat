import { FastifyInstance } from 'fastify';
import { Worker } from '@temporalio/worker';
import { container } from 'tsyringe';
import { PlanExpirationReminderActivity } from '@core/temporal/activities/planExpirationReminder.activities';
import '@core/temporal/workflows/planExpirationReminder.workflow';

export const planExpirationReminderWorker = async (
  fastify: FastifyInstance
) => {
  const activity = container.resolve(PlanExpirationReminderActivity);

  const worker = await Worker.create({
    connection: fastify.temporal.nativeConnection,
    workflowsPath:
      require.resolve('@core/temporal/workflows/planExpirationReminder.workflow'),
    activities: {
      processPlanExpirationReminders: activity.processPlanExpirationReminders,
    },
    taskQueue: 'plan-expiration-reminder-queue',
  });

  worker.run();
};
