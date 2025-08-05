import { FastifyInstance } from 'fastify';
import { Worker } from '@temporalio/worker';
import * as activities from '@core/temporal/activities/server.activities';

export const serverWorker = async (fastify: FastifyInstance) => {
  const worker = await Worker.create({
    connection: fastify.temporal.nativeConnection,
    workflowsPath: require.resolve('@core/temporal/workflows/server.workflow'),
    activities: activities,
    taskQueue: 'server-queue',
  });

  worker.run();
};
