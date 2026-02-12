import { FastifyInstance } from 'fastify';
import { Worker } from '@temporalio/worker';
import { container } from 'tsyringe';
import { PlanRenewalActivity } from '@core/temporal/activities/planRenewal.activities';
import '@core/temporal/workflows/planRenewal.workflow';

export const planRenewalWorker = async (fastify: FastifyInstance) => {
  const activity = container.resolve(PlanRenewalActivity);

  const worker = await Worker.create({
    connection: fastify.temporal.nativeConnection,
    workflowsPath:
      require.resolve('@core/temporal/workflows/planRenewal.workflow'),
    activities: {
      processPlanRenewals: activity.processPlanRenewals,
    },
    taskQueue: 'plan-renewal-queue',
  });

  fastify.temporal.registerWorker(worker);

  worker.run().catch((err) => {
    fastify.log.error(err, 'Plan renewal worker failed');
  });
};
