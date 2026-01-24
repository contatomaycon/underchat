import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { reportSatisfactionViewPermissions } from '@/permissions/reportSatisfaction.permissions';
import ReportSatisfactionController from '@/controllers/reportSatisfaction';
import { listReportSatisfactionSchema } from '@core/schema/reportSatisfaction/listReportSatisfaction';
import { downloadReportSatisfactionPdfSchema } from '@core/schema/reportSatisfaction/downloadReportSatisfactionPdf';
import { planGuard } from '@/plugins/planGuard';
import { planStatus } from '@/plugins/planStatus';

export default function reportSatisfactionRoutes(server: FastifyInstance) {
  const reportSatisfactionController = container.resolve(
    ReportSatisfactionController
  );

  server.get('/report-satisfaction', {
    schema: listReportSatisfactionSchema,
    handler: reportSatisfactionController.listReportSatisfaction,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(
          request,
          reply,
          reportSatisfactionViewPermissions
        ),
      planGuard,
      planStatus,
    ],
  });

  server.get('/report-satisfaction/pdf', {
    schema: downloadReportSatisfactionPdfSchema,
    handler: reportSatisfactionController.downloadReportSatisfactionPdf,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(
          request,
          reply,
          reportSatisfactionViewPermissions
        ),
      planGuard,
      planStatus,
    ],
  });
}
