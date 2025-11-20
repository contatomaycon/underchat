import { FastifyInstance } from 'fastify';
import { Worker } from '@temporalio/worker';
import * as serverActivities from '@core/temporal/activities/server.activities';
import * as profileStatusRenewalActivities from '@core/temporal/activities/profileStatusRenewal.activities';

export const serverWorker = async (fastify: FastifyInstance) => {
  const worker = await Worker.create({
    connection: fastify.temporal.nativeConnection,
    workflowsPath: require.resolve('@core/temporal/workflows/server.workflow'),
    activities: {
      ...serverActivities,
      ...profileStatusRenewalActivities,
    },
    taskQueue: 'server-queue',
  });

  worker.run();
};
