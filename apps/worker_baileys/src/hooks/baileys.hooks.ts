import { BaileysService } from '@core/services/baileys';
import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';

export default fp(
  async (fastify: FastifyInstance) => {
    fastify.addHook('onReady', async () => {
      const baileysService = container.resolve(BaileysService);
      try {
        await baileysService.connect({ initial_connection: true });
        fastify.log.info('Baileys connection started on worker startup');
      } catch (error) {
        fastify.log.error({ err: error }, 'Failed to start Baileys connection');
        throw error;
      }
    });
  },
  { name: 'baileys-hooks' }
);
