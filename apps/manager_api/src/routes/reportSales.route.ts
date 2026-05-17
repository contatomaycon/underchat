import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import SectorController from '@/controllers/sector';
import PlanController from '@/controllers/plan';
import { salesViewPermissions } from '@/permissions/sales.permissions';
import { listSectorSchema } from '@core/schema/sector/listSector';
import { listPlanAllSchema } from '@core/schema/plan/listPlanAll';
import { listPlanSalesSchema } from '@core/schema/plan/listPlanSales';
import { listPlanSalesSummarySchema } from '@core/schema/plan/listPlanSalesSummary';
import { planGuard } from '@/plugins/planGuard';
import { planStatus } from '@/plugins/planStatus';

export default function reportSalesRoutes(server: FastifyInstance) {
  const sectorController = container.resolve(SectorController);
  const planController = container.resolve(PlanController);

  server.get('/sales/sector', {
    schema: listSectorSchema,
    handler: sectorController.listSector,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, salesViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/sales/plan/all', {
    schema: listPlanAllSchema,
    handler: planController.listPlanAll,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, salesViewPermissions),
      planStatus,
    ],
  });

  server.get('/sales/plan/sales', {
    schema: listPlanSalesSchema,
    handler: planController.listPlanSales,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, salesViewPermissions),
      planStatus,
    ],
  });

  server.get('/sales/plan/summary', {
    schema: listPlanSalesSummarySchema,
    handler: planController.listPlanSalesSummary,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, salesViewPermissions),
      planStatus,
    ],
  });
}
