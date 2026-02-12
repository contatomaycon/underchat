import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FastifyInstance } from 'fastify';
import { Worker } from '@temporalio/worker';
import { container } from 'tsyringe';
import { BalanceMonitorActivity } from '@core/temporal/activities/balanceMonitor.activities';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const balanceMonitorWorker = async (fastify: FastifyInstance) => {
  const activity = container.resolve(BalanceMonitorActivity);

  const worker = await Worker.create({
    connection: fastify.temporal.nativeConnection,
    workflowsPath: path.resolve(
      __dirname,
      '../../../../../packages/temporal/workflows/balanceMonitor.workflow'
    ),
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
