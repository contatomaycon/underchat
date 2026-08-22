import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { container } from 'tsyringe';
import { PushDeliveryQueueService } from '@core/services/pushDeliveryQueue.service';

const pushDeliveryPlugin = async (fastify: FastifyInstance): Promise<void> => {
  const pushDeliveryQueueService = container.resolve(PushDeliveryQueueService);

  fastify.addHook('onListen', () => {
    pushDeliveryQueueService.start((error: unknown) => {
      fastify.log.warn(
        { err: error, type: 'push_delivery_queue_drain_failed' },
        'Push delivery queue drain failed; the worker will retry'
      );
    });
    fastify.log.info('Push delivery queue worker started');
  });

  fastify.addHook('onClose', async () => {
    pushDeliveryQueueService.stop();
  });
};

export default fp(pushDeliveryPlugin, { name: 'push-delivery-plugin' });
