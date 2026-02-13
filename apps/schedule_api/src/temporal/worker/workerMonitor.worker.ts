import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FastifyInstance } from 'fastify';
import { Worker } from '@temporalio/worker';
import { container } from 'tsyringe';
import { WorkerMonitorActivity } from '@core/temporal/activities/workerMonitor.activities';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const workerMonitorWorker = async (fastify: FastifyInstance) => {
  const activity = container.resolve(WorkerMonitorActivity);

  const worker = await Worker.create({
    connection: fastify.temporal.nativeConnection,
    workflowsPath: path.resolve(
      __dirname,
      '../../../../../packages/temporal/workflows/workerMonitor.workflow.ts'
    ),
    activities: {
      monitor: activity.monitor,
    },
    taskQueue: 'worker-monitor-queue',
  });

  fastify.temporal.registerWorker(worker);

  worker.run().catch((err) => {
    fastify.log.error(err, 'Worker monitor worker failed');
  });
};
