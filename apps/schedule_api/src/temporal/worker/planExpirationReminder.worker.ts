import path from 'path';
import { FastifyInstance } from 'fastify';
import { Worker } from '@temporalio/worker';
import { container } from 'tsyringe';
import { PlanExpirationReminderActivity } from '@core/temporal/activities/planExpirationReminder.activities';

export const planExpirationReminderWorker = async (
  fastify: FastifyInstance
) => {
  const activity = container.resolve(PlanExpirationReminderActivity);

  const worker = await Worker.create({
    connection: fastify.temporal.nativeConnection,
    workflowsPath: path.resolve(
      __dirname,
      '../../../../../packages/temporal/workflows/planExpirationReminder.workflow'
    ),
    activities: {
      processPlanExpirationReminders: activity.processPlanExpirationReminders,
    },
    taskQueue: 'plan-expiration-reminder-queue',
  });

  fastify.temporal.registerWorker(worker);

  worker.run().catch((err) => {
    fastify.log.error(err, 'Plan expiration reminder worker failed');
  });
};
