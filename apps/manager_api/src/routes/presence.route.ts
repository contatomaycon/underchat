import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import PresenceController from '@/controllers/presence';
import {
  presenceOnlineSchema,
  presenceHeartbeatSchema,
  presenceOfflineSchema,
  presenceAwaySchema,
  presenceBusySchema,
  presenceDoNotDisturbSchema,
} from '@core/schema/presence';

export default function presenceRoutes(server: FastifyInstance) {
  const presenceController = container.resolve(PresenceController);

  server.post('/presence/online', {
    schema: presenceOnlineSchema,
    handler: presenceController.setOnline,
    preHandler: [(request, reply) => server.authenticateJwt(request, reply)],
  });

  server.post('/presence/heartbeat', {
    schema: presenceHeartbeatSchema,
    handler: presenceController.heartbeat,
    preHandler: [(request, reply) => server.authenticateJwt(request, reply)],
  });

  server.post('/presence/offline', {
    schema: presenceOfflineSchema,
    handler: presenceController.setOffline,
    preHandler: [(request, reply) => server.authenticateJwt(request, reply)],
  });

  server.post('/presence/away', {
    schema: presenceAwaySchema,
    handler: presenceController.setAway,
    preHandler: [(request, reply) => server.authenticateJwt(request, reply)],
  });

  server.post('/presence/busy', {
    schema: presenceBusySchema,
    handler: presenceController.setBusy,
    preHandler: [(request, reply) => server.authenticateJwt(request, reply)],
  });

  server.post('/presence/do-not-disturb', {
    schema: presenceDoNotDisturbSchema,
    handler: presenceController.setDoNotDisturb,
    preHandler: [(request, reply) => server.authenticateJwt(request, reply)],
  });
}
