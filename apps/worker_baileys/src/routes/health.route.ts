import HealthController from '@/controllers/health';
import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { healthCheckSchema } from '@core/schema/health';

export default function healthRoutes(server: FastifyInstance) {
  const t0 = Date.now();
  console.log(
    '[worker_baileys:init] routes/health.route: healthRoutes iniciado',
    { ts: t0 }
  );
  const tResolve = Date.now();
  const healthController = container.resolve(HealthController);
  console.log(
    '[worker_baileys:init] routes/health.route: HealthController resolvido',
    { ms: Date.now() - tResolve, ts: Date.now() }
  );

  server.get('/health/check', {
    schema: healthCheckSchema,
    handler: healthController.view,
  });

  server.get('/connection/health/check', {
    schema: healthCheckSchema,
    handler: healthController.viewConnectionHealth,
  });
  console.log('[worker_baileys:init] routes/health.route: rotas registradas', {
    msTotal: Date.now() - t0,
    ts: Date.now(),
  });
}
