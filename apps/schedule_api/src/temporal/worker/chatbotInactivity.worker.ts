import path from 'path';
import { FastifyInstance } from 'fastify';
import { Worker } from '@temporalio/worker';
import { container } from 'tsyringe';
import { ChatbotInactivityActivity } from '@core/temporal/activities/chatbotInactivity.activities';

export const chatbotInactivityWorker = async (fastify: FastifyInstance) => {
  const activity = container.resolve(ChatbotInactivityActivity);

  const worker = await Worker.create({
    connection: fastify.temporal.nativeConnection,
    workflowsPath: path.resolve(
      __dirname,
      '../../../../../packages/temporal/workflows/chatbotInactivity.workflow'
    ),
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
