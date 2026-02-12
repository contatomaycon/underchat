import { FastifyInstance } from 'fastify';
import { Worker } from '@temporalio/worker';
import { container } from 'tsyringe';
import { BalanceMonitorActivity } from '@core/temporal/activities/balanceMonitor.activities';
import '@core/temporal/workflows/balanceMonitor.workflow';

export const balanceMonitorWorker = async (fastify: FastifyInstance) => {
  const activity = container.resolve(BalanceMonitorActivity);

  const worker = await Worker.create({
    connection: fastify.temporal.nativeConnection,
    workflowsPath:
      require.resolve('@core/temporal/workflows/balanceMonitor.workflow'),
    activities: {
      monitor: activity.monitor,
    },
    taskQueue: 'balance-monitor-queue',
  });

  fastify.temporal.registerWorker(worker);

  worker.run().catch((err) => {
    fastify.log.error(err, 'Balance monitor worker failed');
  });
};
