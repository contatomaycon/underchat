import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import PushController from '@/controllers/push';
import { registerPushSubscriptionSchema } from '@core/schema/push/registerSubscription';
import { getPushPublicKeySchema } from '@core/schema/push/getPublicKey';
import { deletePushSubscriptionSchema } from '@core/schema/push/deleteSubscription';

export default function pushRoutes(server: FastifyInstance) {
  const pushController = container.resolve(PushController);

  server.post('/push/subscribe', {
    schema: registerPushSubscriptionSchema,
    handler: pushController.registerSubscription,
    preHandler: (request, reply) => server.authenticateJwt(request, reply),
  });

  server.get('/push/public-key', {
    schema: getPushPublicKeySchema,
    handler: pushController.getPublicKey,
  });

  server.delete('/push/unsubscribe', {
    schema: deletePushSubscriptionSchema,
    handler: pushController.deleteSubscription,
    preHandler: (request, reply) => server.authenticateJwt(request, reply),
  });
}
