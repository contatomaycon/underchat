import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { planListPermissions } from '@/permissions';
import PlanController from '@/controllers/plan';
import { listPlanSchema } from '@core/schema/plan/listPlan';

export default async function planRoutes(server: FastifyInstance) {
  const planController = container.resolve(PlanController);

  server.get('/plan', {
    schema: listPlanSchema,
    handler: planController.listPlan,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planListPermissions),
    ],
  });
}
