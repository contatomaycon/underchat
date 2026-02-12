import { FastifyInstance } from 'fastify';
import { Worker } from '@temporalio/worker';
import { container } from 'tsyringe';
import { WorkerMonitorActivity } from '@core/temporal/activities/workerMonitor.activities';
import '@core/temporal/workflows/workerMonitor.workflow';

export const workerMonitorWorker = async (fastify: FastifyInstance) => {
  const activity = container.resolve(WorkerMonitorActivity);

  const worker = await Worker.create({
    connection: fastify.temporal.nativeConnection,
    workflowsPath:
      require.resolve('@core/temporal/workflows/workerMonitor.workflow'),
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
