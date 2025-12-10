import { FastifyInstance } from 'fastify';
import { Worker } from '@temporalio/worker';
import * as activities from '@core/temporal/activities/chatbotInactivity.activities';
import '@core/temporal/workflows/chatbotInactivity.workflow';

export const chatbotInactivityWorker = async (fastify: FastifyInstance) => {
  const worker = await Worker.create({
    connection: fastify.temporal.nativeConnection,
    workflowsPath:
      require.resolve('@core/temporal/workflows/chatbotInactivity.workflow'),
    activities,
    taskQueue: 'chatbot-inactivity-queue',
  });

  worker.run();
};
