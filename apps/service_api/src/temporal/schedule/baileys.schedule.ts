import { FastifyInstance } from 'fastify';
import { getHandleSchedule } from '@core/common/functions/getHandleSchedule';
import { container } from 'tsyringe';
import { Client } from '@temporalio/client';

export const baileysSchedule = async (fastify: FastifyInstance) => {
  const clientTemporal = container.resolve<Client>('TemporalClient');
  const scheduleId = 'baileys-schedule';

  const handleSchedule = clientTemporal.schedule.getHandle(scheduleId);
  const statusBaileysSchedule = await getHandleSchedule(handleSchedule);

  if (!statusBaileysSchedule) {
    try {
      await clientTemporal.schedule.create({
        scheduleId,
        spec: {
          intervals: [{ every: '600s' }],
        },
        action: {
          type: 'startWorkflow',
          workflowType: 'baileysWorkflow',
          taskQueue: 'baileys-queue',
          args: [],
        },
      });

      fastify.log.info('Schedule "baileys-schedule" created');
    } catch {
      fastify.log.error('Error creating schedule');
    }
  }
};
