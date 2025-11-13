import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { planListPermissions } from '@/permissions';
import PlanController from '@/controllers/plan';
import { listPlanSchema } from '@core/schema/plan/listPlan';
import { listPlanAllSchema } from '@core/schema/plan/listPlanAll';

export default function planRoutes(server: FastifyInstance) {
  const planController = container.resolve(PlanController);

  server.get('/plan', {
    schema: listPlanSchema,
    handler: planController.listPlan,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planListPermissions),
    ],
  });

  server.get('/plan/all', {
    schema: listPlanAllSchema,
    handler: planController.listPlanAll,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planListPermissions),
    ],
  });
}
