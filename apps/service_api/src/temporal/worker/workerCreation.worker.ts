import { FastifyInstance } from 'fastify';
import { Worker } from '@temporalio/worker';
import {
  listWorkerNewStatusActivities,
  processWorkerCreation,
} from '@core/temporal/activities/workerCreation.activities';

export const workerCreationWorker = async (fastify: FastifyInstance) => {
  const worker = await Worker.create({
    connection: fastify.temporal.nativeConnection,
    workflowsPath:
      require.resolve('@core/temporal/workflows/workerCreation.workflow'),
    activities: {
      listWorkerNewStatusActivities,
      processWorkerCreation,
    },
    taskQueue: 'worker-creation-queue',
  });

  worker.run();
};
