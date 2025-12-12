import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { reportAttendanceViewPermissions } from '@/permissions/reportAttendance.permissions';
import ReportAttendanceController from '@/controllers/reportAttendance';
import { listReportAttendanceSchema } from '@core/schema/reportAttendance/listReportAttendance';
import { planGuard } from '@/plugins/planGuard';
import { planStatus } from '@/plugins/planStatus';

export default function reportAttendanceRoutes(server: FastifyInstance) {
  const reportAttendanceController = container.resolve(
    ReportAttendanceController
  );

  server.get('/report-attendance', {
    schema: listReportAttendanceSchema,
    handler: reportAttendanceController.listReportAttendance,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, reportAttendanceViewPermissions),
      planGuard,
      planStatus,
    ],
  });

  server.get('/report-attendance/pdf', {
    schema: {
      querystring: listReportAttendanceSchema.querystring,
    },
    handler: reportAttendanceController.downloadReportAttendancePdf,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, reportAttendanceViewPermissions),
      planGuard,
      planStatus,
    ],
  });
}
