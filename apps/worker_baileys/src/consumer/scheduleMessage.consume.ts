import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { ScheduleMessageConsume } from '@core/consumer/schedule/ScheduleMessage.consume';

export default fp(
  async (fastify: FastifyInstance) => {
    const scheduleMessageConsume = container.resolve(ScheduleMessageConsume);

    scheduleMessageConsume.execute().catch((error) => {
      throw error;
    });

    fastify.addHook('onClose', async () => {
      await scheduleMessageConsume.close();
    });
  },
  { name: 'schedule-message-consume' }
);
