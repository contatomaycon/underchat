import { FastifyInstance } from 'fastify';
import { Worker } from '@temporalio/worker';
import * as queue from '@core/temporal/activities/index';

export const serverWorker = async (fastify: FastifyInstance) => {
  const worker = await Worker.create({
    connection: fastify.temporal.nativeConnection,
    workflowsPath: require.resolve('@core/temporal/workflows/index.workflow'),
    activities: queue,
    taskQueue: 'server-queue',
  });

  worker.run();
};
