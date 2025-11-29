import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { PresenceService } from '@core/services/presence.service';

const presenceMonitorPlugin = async (fastify: FastifyInstance) => {
  try {
    const presenceService = container.resolve(PresenceService);
    presenceService.startMonitoring();

    fastify.addHook('onClose', async () => {
      presenceService.stopMonitoring();
    });
  } catch (error) {
    fastify.log.error(error, 'Failed to start presence monitor');
  }
};

export default fp(presenceMonitorPlugin, { name: 'presence-monitor' });
