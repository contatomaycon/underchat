import { FastifyInstance } from 'fastify';
import healthRoutes from '@/routes/health.route';

export default function registerRoutes(server: FastifyInstance) {
  const t0 = Date.now();
  console.log('[worker_baileys:init] routes/index: registerRoutes iniciado', {
    ts: t0,
  });
  server.register(healthRoutes);
  console.log('[worker_baileys:init] routes/index: healthRoutes registrado', {
    ms: Date.now() - t0,
    ts: Date.now(),
  });
}
