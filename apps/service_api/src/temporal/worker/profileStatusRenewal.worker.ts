import { FastifyInstance } from 'fastify';
import { Worker } from '@temporalio/worker';
import * as activities from '@core/temporal/activities/profileStatusRenewal.activities';
import '@core/temporal/workflows/server-queue.workflows';

export const profileStatusRenewalWorker = async (fastify: FastifyInstance) => {
  const worker = await Worker.create({
    connection: fastify.temporal.nativeConnection,
    workflowsPath: require.resolve(
      '@core/temporal/workflows/server-queue.workflows'
    ),
    activities: activities,
    taskQueue: 'server-queue',
  });

  worker.run();
};
