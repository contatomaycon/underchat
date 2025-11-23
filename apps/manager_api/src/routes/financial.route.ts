import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { financialViewPermissions } from '@/permissions';
import FinancialController from '@/controllers/financial';
import { listFinancialReportSchema } from '@core/schema/financial/listFinancialReport/schema';

export default function financialRoutes(server: FastifyInstance) {
  const financialController = container.resolve(FinancialController);

  server.get('/financial/report', {
    schema: listFinancialReportSchema,
    handler: financialController.listFinancialReport,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, financialViewPermissions),
    ],
  });
}
