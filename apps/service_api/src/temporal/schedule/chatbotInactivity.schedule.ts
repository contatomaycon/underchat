import { FastifyInstance } from 'fastify';
import { getHandleSchedule } from '@core/common/functions/getHandleSchedule';
import { container } from 'tsyringe';
import { Client } from '@temporalio/client';

export const chatbotInactivitySchedule = async (fastify: FastifyInstance) => {
  const clientTemporal = container.resolve<Client>('TemporalClient');
  const scheduleId = 'chatbot-inactivity-schedule';

  const handleSchedule = clientTemporal.schedule.getHandle(scheduleId);
  const statusSchedule = await getHandleSchedule(handleSchedule);

  if (!statusSchedule) {
    try {
      await clientTemporal.schedule.create({
        scheduleId,
        spec: {
          intervals: [{ every: '30s' }],
        },
        action: {
          type: 'startWorkflow',
          workflowType: 'chatbotInactivityWorkflow',
          taskQueue: 'chatbot-inactivity-queue',
          args: [],
        },
      });

      fastify.log.info('Schedule "chatbot-inactivity-schedule" created');
    } catch {
      fastify.log.error('Error creating chatbot inactivity schedule');
    }
  }
};
