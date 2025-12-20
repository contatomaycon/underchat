import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { ScheduleStatusUpdateConsume } from '@core/consumer/schedule/ScheduleStatusUpdate.consume';

export default fp(
  async (fastify: FastifyInstance) => {
    const scheduleStatusUpdateConsume = container.resolve(
      ScheduleStatusUpdateConsume
    );

    scheduleStatusUpdateConsume.execute().catch((error) => {
      throw error;
    });

    fastify.addHook('onClose', async () => {
      await scheduleStatusUpdateConsume.close();
    });
  },
  { name: 'schedule-status-update-consume' }
);
