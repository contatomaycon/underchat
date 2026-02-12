import path from 'path';
import { FastifyInstance } from 'fastify';
import { Worker } from '@temporalio/worker';
import { container } from 'tsyringe';
import { WorkerCreationActivity } from '@core/temporal/activities/workerCreation.activities';

export const workerCreationWorker = async (fastify: FastifyInstance) => {
  const activity = container.resolve(WorkerCreationActivity);

  const worker = await Worker.create({
    connection: fastify.temporal.nativeConnection,
    workflowsPath: path.resolve(
      __dirname,
      '../../../../../packages/temporal/workflows/workerCreation.workflow'
    ),
    activities: {
      listWorkerNewStatusActivities: activity.listWorkerNewStatusActivities,
      processWorkerCreation: activity.processWorkerCreation,
    },
    taskQueue: 'worker-creation-queue',
  });

  fastify.temporal.registerWorker(worker);

  worker.run().catch((err) => {
    fastify.log.error(err, 'Worker creation worker failed');
  });
};
