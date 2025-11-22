import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import {
  planViewPermissions,
  planCreatePermissions,
  planUpdatePermissions,
  planDeletePermissions,
} from '@/permissions';
import PlanCrossSellController from '@/controllers/planCrossSell';
import { listCrossSellSchema } from '@core/schema/planCrossSell/listCrossSell';
import { createCrossSellSchema } from '@core/schema/planCrossSell/createCrossSell';
import { updateCrossSellSchema } from '@core/schema/planCrossSell/updateCrossSell';
import { deleteCrossSellSchema } from '@core/schema/planCrossSell/deleteCrossSell';
import { createCrossSellAccountSchema } from '@core/schema/planCrossSell/createCrossSellAccount';
import { listCrossSellAccountSchema } from '@core/schema/planCrossSell/listCrossSellAccount';
import { deleteCrossSellAccountSchema } from '@core/schema/planCrossSell/deleteCrossSellAccount';

export default function planCrossSellRoutes(server: FastifyInstance) {
  const planCrossSellController = container.resolve(PlanCrossSellController);

  server.get('/plan-cross-sell', {
    schema: listCrossSellSchema,
    handler: planCrossSellController.listCrossSell,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planViewPermissions),
    ],
  });

  server.post('/plan-cross-sell', {
    schema: createCrossSellSchema,
    handler: planCrossSellController.createCrossSell,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planCreatePermissions),
    ],
  });

  server.patch('/plan-cross-sell/:plan_cross_sell_id', {
    schema: updateCrossSellSchema,
    handler: planCrossSellController.updateCrossSell,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planUpdatePermissions),
    ],
  });

  server.delete('/plan-cross-sell/:plan_cross_sell_id', {
    schema: deleteCrossSellSchema,
    handler: planCrossSellController.deleteCrossSell,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planDeletePermissions),
    ],
  });

  server.post('/plan-cross-sell/account', {
    schema: createCrossSellAccountSchema,
    handler: planCrossSellController.createCrossSellAccount,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planCreatePermissions),
    ],
  });

  server.get('/plan-cross-sell/:plan_cross_sell_id/account', {
    schema: listCrossSellAccountSchema,
    handler: planCrossSellController.listCrossSellAccount,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planViewPermissions),
    ],
  });

  server.delete('/plan-cross-sell/account/:plan_cross_sell_account_id', {
    schema: deleteCrossSellAccountSchema,
    handler: planCrossSellController.deleteCrossSellAccount,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planDeletePermissions),
    ],
  });
}
