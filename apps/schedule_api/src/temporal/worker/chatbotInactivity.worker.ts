import { FastifyInstance } from 'fastify';
import { Worker } from '@temporalio/worker';
import { container } from 'tsyringe';
import { ChatbotInactivityActivity } from '@core/temporal/activities/chatbotInactivity.activities';
import '@core/temporal/workflows/chatbotInactivity.workflow';

export const chatbotInactivityWorker = async (fastify: FastifyInstance) => {
  const activity = container.resolve(ChatbotInactivityActivity);

  const worker = await Worker.create({
    connection: fastify.temporal.nativeConnection,
    workflowsPath:
      require.resolve('@core/temporal/workflows/chatbotInactivity.workflow'),
    activities: {
      processScheduledInactivityChecks:
        activity.processScheduledInactivityChecks,
    },
    taskQueue: 'chatbot-inactivity-queue',
  });

  fastify.temporal.registerWorker(worker);

  worker.run().catch((err) => {
    fastify.log.error(err, 'Chatbot inactivity worker failed');
  });
};
