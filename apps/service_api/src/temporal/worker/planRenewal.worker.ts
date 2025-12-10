import { FastifyInstance } from 'fastify';
import { Worker } from '@temporalio/worker';
import * as activities from '@core/temporal/activities/planRenewal.activities';
import '@core/temporal/workflows/planRenewal.workflow';

export const planRenewalWorker = async (fastify: FastifyInstance) => {
  const worker = await Worker.create({
    connection: fastify.temporal.nativeConnection,
    workflowsPath:
      require.resolve('@core/temporal/workflows/planRenewal.workflow'),
    activities,
    taskQueue: 'plan-renewal-queue',
  });

  worker.run();
};
