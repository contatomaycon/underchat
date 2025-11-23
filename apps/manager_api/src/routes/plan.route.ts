import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import {
  planViewPermissions,
  planCreatePermissions,
  planUpdatePermissions,
  planDeletePermissions,
} from '@/permissions';
import PlanController from '@/controllers/plan';
import { listPlanSchema } from '@core/schema/plan/listPlan';
import { listPlanAllSchema } from '@core/schema/plan/listPlanAll';
import { createPlanSchema } from '@core/schema/plan/createPlan';
import { updatePlanSchema } from '@core/schema/plan/updatePlan';
import { deletePlanSchema } from '@core/schema/plan/deletePlan';
import { createPlanItemSchema } from '@core/schema/plan/createPlanItem';
import { listPlanItemsSchema } from '@core/schema/plan/listPlanItems';
import { deletePlanItemSchema } from '@core/schema/plan/deletePlanItem';
import { listPlanProductAllSchema } from '@core/schema/plan/listPlanProductAll';
import { listSalesReportSchema } from '@core/schema/plan/listSalesReport/schema';

export default function planRoutes(server: FastifyInstance) {
  const planController = container.resolve(PlanController);

  server.get('/plan', {
    schema: listPlanSchema,
    handler: planController.listPlan,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planViewPermissions),
    ],
  });

  server.get('/plan/all', {
    schema: listPlanAllSchema,
    handler: planController.listPlanAll,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planViewPermissions),
    ],
  });

  server.post('/plan', {
    schema: createPlanSchema,
    handler: planController.createPlan,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planCreatePermissions),
    ],
  });

  server.patch('/plan/:plan_id', {
    schema: updatePlanSchema,
    handler: planController.updatePlan,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planUpdatePermissions),
    ],
  });

  server.delete('/plan/:plan_id', {
    schema: deletePlanSchema,
    handler: planController.deletePlan,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planDeletePermissions),
    ],
  });

  server.post('/plan/item', {
    schema: createPlanItemSchema,
    handler: planController.createPlanItem,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planCreatePermissions),
    ],
  });

  server.get('/plan/:plan_id/items', {
    schema: listPlanItemsSchema,
    handler: planController.listPlanItems,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planViewPermissions),
    ],
  });

  server.delete('/plan/item/:plan_item_id', {
    schema: deletePlanItemSchema,
    handler: planController.deletePlanItem,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planDeletePermissions),
    ],
  });

  server.get('/plan/product/all', {
    schema: listPlanProductAllSchema,
    handler: planController.listPlanProductAll,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planViewPermissions),
    ],
  });

  server.get('/plan/sales-report', {
    schema: listSalesReportSchema,
    handler: planController.listSalesReport,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planViewPermissions),
    ],
  });
}
