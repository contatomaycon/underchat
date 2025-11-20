import { FastifyInstance } from 'fastify';
import { Worker } from '@temporalio/worker';
import * as activities from '@core/temporal/activities/baileys.activities';
import '@core/temporal/workflows/baileys.workflow';

export const baileysWorker = async (fastify: FastifyInstance) => {
  const worker = await Worker.create({
    connection: fastify.temporal.nativeConnection,
    workflowsPath: require.resolve('@core/temporal/workflows/baileys.workflow'),
    activities,
    taskQueue: 'baileys-queue',
  });

  worker.run();
};
