import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { financialReportViewPermissions } from '@/permissions/financialReport.permissions';
import FinancialReportController from '@/controllers/financialReport';
import { listFinancialReportSchema } from '@core/schema/financialReport/listFinancialReport';

export default function financialReportRoutes(server: FastifyInstance) {
  const financialReportController = container.resolve(
    FinancialReportController
  );

  server.get('/financial-report', {
    schema: listFinancialReportSchema,
    handler: financialReportController.listFinancialReport,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, financialReportViewPermissions),
    ],
  });
}
